import { isBinding, type ComponentNode, type Surface } from "@ovxa/schema";
import { RESERVED_PROP_KEYS } from "./grammar";

/**
 * Surface → Wire.
 *
 * Needed for three things: worked examples in the system prompt, the token
 * benchmark, and round-trip tests that prove the format loses nothing the schema
 * can express.
 */

function encodeValue(value: unknown): string {
  if (isBinding(value)) return `@${value.$bind}`;
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    // A string that would decode as something else has to be quoted back into
    // being a string, so the round trip is lossless.
    const ambiguous =
      value.startsWith("@") ||
      value.startsWith("[") ||
      value.startsWith("{") ||
      value === "true" ||
      value === "false" ||
      value === "null" ||
      /^-?\d+(?:\.\d+)?$/.test(value) ||
      value.includes("\n");
    return ambiguous ? JSON.stringify(value) : value;
  }
  return JSON.stringify(value);
}

/**
 * A cell must survive the split, so a value containing the separator or a
 * newline disqualifies the whole array from tabular form.
 */
function cellSafe(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "number" || typeof value === "boolean") return true;
  return typeof value === "string" && !value.includes("|") && !value.includes("\n");
}

/**
 * Records that can be written as a table: at least two of them, all objects,
 * all flat, and agreeing on their columns. Anything less uniform stays JSON,
 * because a table with a ragged shape is worse than no table.
 */
function tableColumns(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;

  const columns: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    for (const [key, cell] of Object.entries(entry)) {
      if (!cellSafe(cell)) return null;
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns.length > 0 ? columns : null;
}

function encodeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function encodeNode(node: ComponentNode, depth: number, lines: string[]): void {
  const pad = "  ".repeat(depth);
  lines.push(`${pad}${node.type} ${node.id}`.trimEnd());

  const inner = `${pad}  `;
  if (node.a11y?.label) lines.push(`${inner}aria ${node.a11y.label}`);
  if (node.phase && node.phase !== "ready") lines.push(`${inner}phase ${node.phase}`);
  if (node.slot) lines.push(`${inner}slot ${node.slot}`);

  for (const [key, value] of Object.entries(node.props)) {
    if (RESERVED_PROP_KEYS.has(key)) continue;

    const columns = tableColumns(value);
    if (columns && Array.isArray(value)) {
      lines.push(`${inner}${key} |${columns.join("|")}`);
      for (const entry of value as Array<Record<string, unknown>>) {
        lines.push(`${inner}|${columns.map((column) => encodeCell(entry[column])).join("|")}`);
      }
      continue;
    }

    lines.push(`${inner}${key} ${encodeValue(value)}`);
  }

  for (const action of node.actions ?? []) {
    lines.push(`${inner}act ${action.id} ${action.label}`);
  }

  for (const child of node.children ?? []) {
    encodeNode(child, depth + 1, lines);
  }
}

export function encodeSurfaceToWire(surface: Surface): string {
  const lines: string[] = [];

  const modifiers = [
    String(surface.layout.columns),
    surface.layout.maxWidth,
    ...(surface.layout.density === "compact" ? ["compact"] : []),
  ];
  lines.push(`surface ${surface.kind} ${modifiers.join(" ")}`);
  lines.push(`title ${surface.title}`);
  if (surface.description) lines.push(`note ${surface.description}`);

  for (const node of surface.root) {
    lines.push("");
    encodeNode(node, 0, lines);
  }

  for (const action of surface.actions) {
    lines.push("");
    lines.push(`action ${action.id} ${action.label}`);
  }

  return `${lines.join("\n")}\n`;
}
