import { z } from "zod";

/** Any value that can cross the model/runtime boundary as data. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/**
 * A read-only reference into the surface state graph, e.g. `{ $bind:
 * "trip.flights" }`. Bindings are how a generated component receives data
 * without the model ever transcribing the data itself — the runtime resolves
 * them, so records cannot be hallucinated into props.
 */
export const bindingSchema = z
  .object({
    $bind: z
      .string()
      .min(1)
      .regex(
        /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/,
        "Binding must be a dotted state path",
      ),
    fallback: jsonValueSchema.optional(),
  })
  .strict();

export type Binding = z.infer<typeof bindingSchema>;

function looksLikeBinding(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "$bind" in value
  );
}

/**
 * A prop is either a binding or a literal. The literal branch must refuse
 * anything carrying `$bind`, otherwise a malformed binding silently falls
 * through the union and is rendered as opaque data instead of being rejected.
 */
export const bindableSchema = z.union([
  bindingSchema,
  jsonValueSchema.refine((value) => !looksLikeBinding(value), {
    message: "Malformed binding: $bind must be a dotted state path",
  }),
]);

export type Bindable = z.infer<typeof bindableSchema>;

export function isBinding(value: unknown): value is Binding {
  return (
    looksLikeBinding(value) &&
    typeof (value as { $bind: unknown }).$bind === "string"
  );
}

const comparisonOps = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"] as const;
const unaryOps = ["truthy", "falsy", "empty", "notEmpty"] as const;

export type Condition =
  | { op: (typeof comparisonOps)[number]; path: string; value: JsonValue }
  | { op: (typeof unaryOps)[number]; path: string }
  | { op: "and" | "or"; clauses: Condition[] }
  | { op: "not"; clause: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z
      .object({
        op: z.enum(comparisonOps),
        path: z.string().min(1),
        value: jsonValueSchema,
      })
      .strict(),
    z.object({ op: z.enum(unaryOps), path: z.string().min(1) }).strict(),
    z
      .object({
        op: z.enum(["and", "or"]),
        clauses: z.array(conditionSchema).min(1).max(16),
      })
      .strict(),
    z.object({ op: z.literal("not"), clause: conditionSchema }).strict(),
  ]),
);

/** Reads `a.b[0].c` out of a plain object graph without throwing. */
export function readPath(source: unknown, path: string): JsonValue | undefined {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment.length > 0);
  let cursor: unknown = source;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor as JsonValue | undefined;
}

function isEmpty(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function compare(
  op: (typeof comparisonOps)[number],
  left: JsonValue | undefined,
  right: JsonValue,
): boolean {
  switch (op) {
    case "eq":
      return JSON.stringify(left) === JSON.stringify(right);
    case "neq":
      return JSON.stringify(left) !== JSON.stringify(right);
    case "contains": {
      if (typeof left === "string") return left.includes(String(right));
      if (Array.isArray(left)) {
        return left.some((item) => JSON.stringify(item) === JSON.stringify(right));
      }
      return false;
    }
    default: {
      if (typeof left !== "number" || typeof right !== "number") return false;
      if (op === "gt") return left > right;
      if (op === "gte") return left >= right;
      if (op === "lt") return left < right;
      return left <= right;
    }
  }
}

/**
 * Conditions are evaluated by the runtime, never by the model, so conditional
 * rendering stays deterministic and cannot execute arbitrary logic.
 */
export function evaluateCondition(
  condition: Condition,
  state: Record<string, JsonValue>,
): boolean {
  switch (condition.op) {
    case "and":
      return condition.clauses.every((clause) => evaluateCondition(clause, state));
    case "or":
      return condition.clauses.some((clause) => evaluateCondition(clause, state));
    case "not":
      return !evaluateCondition(condition.clause, state);
    case "truthy":
      return Boolean(readPath(state, condition.path));
    case "falsy":
      return !readPath(state, condition.path);
    case "empty":
      return isEmpty(readPath(state, condition.path));
    case "notEmpty":
      return !isEmpty(readPath(state, condition.path));
    default:
      return compare(condition.op, readPath(state, condition.path), condition.value);
  }
}
