import {
  decodeValue,
  parseWireLine,
  RESERVED_PROP_KEYS,
  type WireLine,
  type WireValue,
} from "./grammar";

/**
 * Wire → a surface draft.
 *
 * The output is a plain object, not a `Surface`: this decoder's job is to
 * recover structure, and the compiler's job is to decide whether that structure
 * is allowed. Nothing here consults the registry, validates a prop or repairs a
 * node, so a hostile document cannot get further than being badly shaped.
 */

export type WireNode = {
  id: string;
  type: string;
  props: Record<string, WireValue>;
  children?: WireNode[];
  actions?: Array<{ id: string; label: string }>;
  a11y?: { label: string };
  phase?: string;
  slot?: string;
};

export type WireSurfaceDraft = {
  kind: string;
  title: string;
  description?: string;
  layout: { columns: number; density: string; maxWidth: string };
  root: WireNode[];
  actions: Array<{ id: string; label: string }>;
};

export type DecodeResult = {
  draft: WireSurfaceDraft;
  /** Lines the grammar could not place. Reported, never guessed at. */
  skipped: string[];
};

type Frame = { indent: number; node: WireNode };

/**
 * Derives a stable id for a component the model did not name.
 *
 * Ids address nodes for patching, so they have to be unique and they have to be
 * the same on a re-run of the same document — a random id would make every
 * reconcile look like a full replacement.
 */
function idFor(type: string, taken: ReadonlySet<string>): string {
  const base = type.replace(/[^A-Za-z0-9]/g, "").toLowerCase() || "node";
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

function applyReserved(node: WireNode, key: string, value: WireValue): void {
  if (key === "aria") {
    if (typeof value === "string" && value.length > 0) node.a11y = { label: value };
    return;
  }
  if (key === "phase" && typeof value === "string") {
    node.phase = value;
    return;
  }
  if (key === "slot" && typeof value === "string") {
    node.slot = value;
  }
}

export function decodeWire(text: string): DecodeResult {
  const draft: WireSurfaceDraft = {
    kind: "detail",
    title: "",
    layout: { columns: 2, density: "comfortable", maxWidth: "regular" },
    root: [],
    actions: [],
  };
  const skipped: string[] = [];
  const taken = new Set<string>();
  /** Open components, outermost first. Indentation opens and closes frames. */
  const stack: Frame[] = [];
  /** The tabular prop currently accepting rows, if any. */
  let table: { node: WireNode; key: string; columns: string[] } | null = null;

  const closeTo = (indent: number): void => {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top || top.indent < indent) break;
      stack.pop();
    }
  };

  for (const raw of text.split("\n")) {
    const line: WireLine = parseWireLine(raw);

    // Any line that is not a row closes the open table.
    if (line.kind !== "tableRow" && line.kind !== "blank") table = null;

    switch (line.kind) {
      case "blank":
        break;

      case "table": {
        const current = stack[stack.length - 1];
        if (!current) {
          skipped.push(raw.trim());
          break;
        }
        current.node.props[line.key] = [];
        table = { node: current.node, key: line.key, columns: line.columns };
        break;
      }

      case "tableRow": {
        if (!table) {
          skipped.push(raw.trim());
          break;
        }
        const record: Record<string, WireValue> = {};
        table.columns.forEach((column, index) => {
          const cell = line.cells[index];
          // A column with no cell is absent rather than empty, so an optional
          // field stays optional instead of becoming "".
          if (cell === undefined || cell.length === 0) return;
          record[column] = decodeValue(cell);
        });
        const rows = table.node.props[table.key];
        if (Array.isArray(rows)) rows.push(record);
        break;
      }

      case "surface": {
        draft.kind = line.kindName;
        if (line.columns !== undefined) draft.layout.columns = line.columns;
        if (line.maxWidth !== undefined) draft.layout.maxWidth = line.maxWidth;
        if (line.density !== undefined) draft.layout.density = line.density;
        break;
      }

      case "title":
        draft.title = line.text;
        break;

      case "note":
        draft.description = line.text;
        break;

      case "component": {
        closeTo(line.indent);
        const parent = stack[stack.length - 1];
        const id = line.id.length > 0 && !taken.has(line.id) ? line.id : idFor(line.type, taken);
        taken.add(id);
        const node: WireNode = { id, type: line.type, props: {} };
        if (parent) {
          parent.node.children = [...(parent.node.children ?? []), node];
        } else {
          draft.root.push(node);
        }
        stack.push({ indent: line.indent, node });
        break;
      }

      case "prop": {
        const current = stack[stack.length - 1];
        if (!current) {
          skipped.push(raw.trim());
          break;
        }
        if (RESERVED_PROP_KEYS.has(line.key)) {
          applyReserved(current.node, line.key, line.value);
          break;
        }
        current.node.props[line.key] = line.value;
        break;
      }

      case "componentAction": {
        const current = stack[stack.length - 1];
        if (!current) {
          skipped.push(raw.trim());
          break;
        }
        current.node.actions = [
          ...(current.node.actions ?? []),
          { id: line.actionId, label: line.label },
        ];
        break;
      }

      case "action":
        draft.actions.push({ id: line.actionId, label: line.label });
        break;

      case "unknown":
        skipped.push(line.text);
        break;
    }
  }

  return { draft, skipped };
}

/**
 * Incremental decoding for streaming.
 *
 * A newline is a complete unit, so a component is finished the moment a line at
 * or below its indentation arrives. That makes progressive rendering exact:
 * unlike a partially-written JSON object, a Wire block is never ambiguous about
 * whether it is done.
 */
export type WireHeader = { kind?: string; title?: string; description?: string };

export class WireStreamDecoder {
  /**
   * Every chunk received so far. Wire is re-decoded from the whole text rather
   * than line by line because indentation only means something relative to the
   * surrounding document, and because decoding the whole text is what keeps
   * generated ids stable across pushes.
   */
  private text = "";
  private released = 0;
  private reported = { kind: false, title: false, description: false };

  /**
   * Feeds a chunk and returns whatever is now provably complete.
   *
   * A root component is released only once a following root-level line proves it
   * finished, so props are never rendered while more are still arriving.
   */
  push(chunk: string): { nodes: WireNode[]; header: WireHeader | null } {
    this.text += chunk;
    const boundary = this.text.lastIndexOf("\n");
    // A half-written line has no meaning; wait for its newline.
    if (boundary === -1) return { nodes: [], header: null };

    const { draft } = decodeWire(this.text.slice(0, boundary + 1));
    const header = this.headerFrom(draft);

    const complete = Math.max(0, draft.root.length - 1);
    const nodes = draft.root.slice(this.released, complete);
    this.released = Math.max(this.released, complete);

    return { nodes, header };
  }

  /** The last root node and the finished draft. Call once, at the end. */
  flush(): { nodes: WireNode[]; draft: WireSurfaceDraft; skipped: string[] } {
    const result = decodeWire(this.text);
    const nodes = result.draft.root.slice(this.released);
    this.released = result.draft.root.length;
    return { nodes, draft: result.draft, skipped: result.skipped };
  }

  /** Header fields are reported once each, and only when complete. */
  private headerFrom(draft: WireSurfaceDraft): WireHeader | null {
    const header: WireHeader = {};
    let any = false;
    if (!this.reported.title && draft.title.length > 0) {
      header.title = draft.title;
      this.reported.title = true;
      any = true;
    }
    if (!this.reported.description && draft.description !== undefined) {
      header.description = draft.description;
      this.reported.description = true;
      any = true;
    }
    if (!this.reported.kind && draft.kind !== "detail") {
      header.kind = draft.kind;
      this.reported.kind = true;
      any = true;
    }
    return any ? header : null;
  }
}
