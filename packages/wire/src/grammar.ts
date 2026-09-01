/**
 * OVXA Wire: the model-facing encoding of a surface.
 *
 * The UI Schema is the internal representation and stays JSON. Wire is only the
 * shape a model writes, and it exists for two reasons.
 *
 * Tokens. JSON spends most of its budget on syntax the model has to reproduce
 * exactly — braces, quotes, colons, commas — and on repeating every key name.
 * Wire is line-oriented and positional: one component per block, `key value`
 * per prop, no punctuation that carries no meaning.
 *
 * Streaming. A JSON document is only parseable once its braces balance, so
 * progressive rendering needs a scanner that tracks depth and string escapes.
 * In Wire a newline is a complete unit, which makes incremental parsing exact
 * rather than best-effort.
 *
 * The format is deliberately not expressive. There is no way to write a
 * function, a URL scheme, or a nested structure the schema does not already
 * describe, because the model is choosing an interface, not authoring a program.
 *
 *   surface dashboard 3 wide
 *   title Q2 revenue against Q1
 *   note Enterprise renewals drove the decline
 *
 *   StatCard mrr
 *     label MRR
 *     value $1.24M
 *     delta @revenueDelta
 *     trend @mrrTrend
 *
 *   LineChart revenue
 *     aria Monthly revenue, twelve months
 *     series @revenueSeries
 *     fill true
 *     act drillDown Investigate enterprise
 *
 *   action exportReport Export report
 */

export const WIRE_VERSION = "ovxa-wire/1" as const;

/** Values a prop line can carry once decoded. */
export type WireValue =
  | string
  | number
  | boolean
  | null
  | { $bind: string }
  | unknown[]
  | Record<string, unknown>;

export type WireLineKind =
  | "surface"
  | "title"
  | "note"
  | "component"
  | "prop"
  | "action"
  | "componentAction"
  | "blank"
  | "unknown";

export type WireLine =
  | { kind: "surface"; indent: 0; kindName: string; columns?: number; maxWidth?: string; density?: string }
  | { kind: "title"; indent: number; text: string }
  | { kind: "note"; indent: number; text: string }
  | { kind: "component"; indent: number; type: string; id: string }
  | { kind: "prop"; indent: number; key: string; value: WireValue }
  /** Opens a tabular prop: `rows |account|plan|arr`. */
  | { kind: "table"; indent: number; key: string; columns: string[] }
  /** One record of the open table: `|Northwind|Enterprise|48000`. */
  | { kind: "tableRow"; indent: number; cells: string[] }
  | { kind: "action"; indent: number; actionId: string; label: string }
  | { kind: "componentAction"; indent: number; actionId: string; label: string }
  | { kind: "blank"; indent: number }
  | { kind: "unknown"; indent: number; text: string };

/** A prop whose key is PascalCase would be ambiguous with a child component. */
const COMPONENT_TYPE = /^[A-Z][A-Za-z0-9]*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const BINDING_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;

const DENSITIES = new Set(["comfortable", "compact"]);
const WIDTHS = new Set(["narrow", "regular", "wide", "full"]);

/** Keys that configure the node itself rather than its props. */
export const RESERVED_PROP_KEYS = new Set(["aria", "when", "phase", "slot", "key"]);

function indentOf(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") count += 1;
  return count;
}

/**
 * Decodes one prop value.
 *
 * `@path` is a binding — the single most important token saving in the format,
 * because it means the model references host data by name instead of copying it.
 * A value that starts with a JSON opener is parsed as JSON so structured
 * literals remain possible; everything else is the rest of the line verbatim,
 * which is what keeps ordinary strings free of quoting.
 */
export function decodeValue(raw: string): WireValue {
  const text = raw.trim();
  if (text.length === 0) return "";

  if (text.startsWith("@")) {
    const path = text.slice(1);
    // A malformed path becomes a literal rather than an invalid binding, so the
    // compiler rejects one prop instead of the whole document.
    return BINDING_PATH.test(path) ? { $bind: path } : text;
  }

  // A quoted value is how the encoder escapes a string that would otherwise
  // decode as a number, a boolean or a binding.
  if (text.startsWith("[") || text.startsWith("{") || text.startsWith('"')) {
    try {
      return JSON.parse(text) as WireValue;
    } catch {
      return text;
    }
  }

  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;

  // Only a value that is entirely numeric becomes a number: "3 accounts" and
  // "$1.2M" must stay strings.
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);

  return text;
}

/**
 * Splits a `|a|b|c` row into its cells.
 *
 * The leading pipe is a marker rather than a separator, so it is dropped before
 * splitting; a trailing pipe is not, because an empty final cell is meaningful.
 */
export function splitRow(text: string): string[] {
  return text.replace(/^\|/, "").split("|").map((cell) => cell.trim());
}

/** Splits a line into its leading word and the untouched remainder. */
function splitHead(text: string): { head: string; rest: string } {
  const trimmed = text.trimEnd();
  const boundary = trimmed.indexOf(" ");
  if (boundary === -1) return { head: trimmed, rest: "" };
  return {
    head: trimmed.slice(0, boundary),
    rest: trimmed.slice(boundary + 1).trim(),
  };
}

export function parseWireLine(line: string): WireLine {
  const indent = indentOf(line);
  const body = line.slice(indent).trimEnd();

  if (body.length === 0 || body.startsWith("#")) return { kind: "blank", indent };

  /**
   * A row of the table opened by the last tabular prop. Records are the bulk of
   * most generated surfaces, and this is the cheapest honest way to write one:
   * no braces, no quotes, and each column name written once for the whole set
   * rather than once per record.
   */
  if (body.startsWith("|")) {
    return { kind: "tableRow", indent, cells: splitRow(body) };
  }

  const { head, rest } = splitHead(body);

  /**
   * Surface metadata is only a keyword at the left margin. Indented, `title` and
   * `note` are ordinary props — several registered components have a `title`, and
   * a keyword that silently swallowed them would be a trap rather than a syntax.
   */
  const atMargin = indent === 0;

  if (atMargin && head === "surface") {
    const [kindName, ...modifiers] = rest.split(/\s+/).filter((part) => part.length > 0);
    const parsed: Extract<WireLine, { kind: "surface" }> = {
      kind: "surface",
      indent: 0,
      kindName: kindName ?? "detail",
    };
    for (const modifier of modifiers) {
      if (/^[1-4]$/.test(modifier)) parsed.columns = Number(modifier);
      else if (WIDTHS.has(modifier)) parsed.maxWidth = modifier;
      else if (DENSITIES.has(modifier)) parsed.density = modifier;
    }
    return parsed;
  }

  if (atMargin && head === "title") return { kind: "title", indent, text: rest };
  if (atMargin && head === "note") return { kind: "note", indent, text: rest };

  if ((atMargin && head === "action") || head === "act") {
    const { head: actionId, rest: label } = splitHead(rest);
    return {
      kind: head === "act" ? "componentAction" : "action",
      indent,
      actionId,
      label: label.length > 0 ? label : actionId,
    };
  }

  if (COMPONENT_TYPE.test(head)) {
    const id = rest.split(/\s+/)[0] ?? "";
    return {
      kind: "component",
      indent,
      type: head,
      // An omitted id is filled in by the decoder, which can see the whole
      // document and so can guarantee uniqueness.
      id: IDENTIFIER.test(id) ? id : "",
    };
  }

  if (IDENTIFIER.test(head)) {
    if (rest.startsWith("|")) {
      return { kind: "table", indent, key: head, columns: splitRow(rest) };
    }
    return { kind: "prop", indent, key: head, value: decodeValue(rest) };
  }

  return { kind: "unknown", indent, text: body };
}
