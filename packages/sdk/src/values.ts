/**
 * Coercion helpers for resolved props. Bound values can still be the wrong
 * shape at render time; these never throw.
 */
export const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export const arr = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
