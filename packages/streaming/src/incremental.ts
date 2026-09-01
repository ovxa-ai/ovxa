/**
 * Incremental extraction of complete values out of a JSON document that is
 * still being written.
 *
 * A model writes a surface as one JSON object. Waiting for the closing brace
 * means the interface appears all at once, seconds after the first token. This
 * scanner instead hands back each element of the `root` array the moment its
 * braces balance, so a component can be validated and rendered while the model
 * is still describing the next one.
 *
 * It is a scanner, not a parser: it never guesses at incomplete values, and any
 * fragment it cannot `JSON.parse` is skipped rather than repaired. The
 * authoritative parse still happens once over the finished document.
 */

export type IncrementalHeader = {
  title?: string;
  description?: string;
  kind?: string;
};

export type IncrementalYield = {
  /** Elements of the `root` array that closed during this push, in order. */
  nodes: unknown[];
  /** Header fields that became complete during this push. */
  header: IncrementalHeader | null;
};

/** Matches a complete JSON string value for `key`, escapes included. */
function completeStringField(text: string, key: string): string | null {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const match = pattern.exec(text);
  if (!match || match[1] === undefined) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return null;
  }
}

const ROOT_ARRAY = /"root"\s*:\s*\[/;

export class IncrementalSurfaceParser {
  private buffer = "";
  /** Scan position inside the root array; -1 until the array opens. */
  private cursor = -1;
  private depth = 0;
  private elementStart = -1;
  private elementIsObject = false;
  private inString = false;
  private escaped = false;
  private rootClosed = false;
  private readonly seenHeader: IncrementalHeader = {};

  get text(): string {
    return this.buffer;
  }

  /** True once the `root` array has been fully consumed. */
  get complete(): boolean {
    return this.rootClosed;
  }

  push(chunk: string): IncrementalYield {
    this.buffer += chunk;
    return { nodes: this.scanRoot(), header: this.scanHeader() };
  }

  /**
   * Header fields are only reported once, and only when their string value has
   * closed — a half-written title must never reach the surface.
   */
  private scanHeader(): IncrementalHeader | null {
    // Anything after the root array belongs to elements, not the header.
    const limit = this.buffer.search(ROOT_ARRAY);
    const scope = limit === -1 ? this.buffer : this.buffer.slice(0, limit);
    const found: IncrementalHeader = {};
    let any = false;

    for (const key of ["title", "description", "kind"] as const) {
      if (this.seenHeader[key] !== undefined) continue;
      const value = completeStringField(scope, key);
      if (value === null) continue;
      this.seenHeader[key] = value;
      found[key] = value;
      any = true;
    }

    return any ? found : null;
  }

  private scanRoot(): unknown[] {
    if (this.rootClosed) return [];

    if (this.cursor === -1) {
      const match = ROOT_ARRAY.exec(this.buffer);
      if (!match) return [];
      this.cursor = match.index + match[0].length;
    }

    const found: unknown[] = [];

    for (; this.cursor < this.buffer.length; this.cursor += 1) {
      const char = this.buffer[this.cursor] as string;

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (char === "\\") this.escaped = true;
        else if (char === '"') this.inString = false;
        continue;
      }

      if (char === '"') {
        this.inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        if (this.depth === 0) {
          this.elementStart = this.cursor;
          this.elementIsObject = char === "{";
        }
        this.depth += 1;
        continue;
      }

      if (char === "}" || char === "]") {
        // A closer at depth zero is the root array's own bracket.
        if (this.depth === 0) {
          this.rootClosed = true;
          this.cursor += 1;
          break;
        }
        this.depth -= 1;
        if (this.depth === 0 && this.elementStart >= 0) {
          if (this.elementIsObject) {
            const fragment = this.buffer.slice(this.elementStart, this.cursor + 1);
            try {
              found.push(JSON.parse(fragment));
            } catch {
              // An element the scanner sliced but cannot parse is dropped; the
              // final whole-document parse is what decides correctness.
            }
          }
          this.elementStart = -1;
        }
      }
    }

    return found;
  }
}
