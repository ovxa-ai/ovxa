import { z } from "zod";
import type { SurfaceKind } from "@ovxa/schema";
import type { ActionRegistry } from "./actions";
import type { ComponentRegistry } from "./registry";
import type { ComponentIntent } from "./definition";

export type CatalogEntry = {
  name: string;
  description: string;
  intents: readonly string[];
  props: Record<string, string>;
  requiredProps: string[];
  actions: readonly string[];
  /**
   * Interactions this component emits back to the host. A component that emits
   * events but is given no actions is inert on screen: it looks operable and
   * does nothing. That makes this the signal for telling a control apart from a
   * presentational component.
   */
  events: readonly string[];
  slots: readonly string[];
  acceptsChildren: boolean;
  constraints: readonly string[];
};

export type Catalog = {
  components: CatalogEntry[];
  actions: Array<{ id: string; description: string; risk: string; confirm: boolean }>;
};

/** Best-effort one-line type description for a prop, for the model prompt. */
function describeType(schema: z.ZodType<unknown>): string {
  const def = (schema as { def?: { type?: string } }).def;
  const type = def?.type ?? "unknown";
  switch (type) {
    case "array":
      return "array";
    case "object":
      return "object";
    case "enum": {
      const values = (schema as unknown as { options?: unknown[] }).options;
      return Array.isArray(values) ? `enum(${values.join("|")})` : "enum";
    }
    case "optional":
    case "nullable": {
      const inner = (schema as unknown as { unwrap?: () => z.ZodType<unknown> }).unwrap;
      return typeof inner === "function" ? `${describeType(inner.call(schema))}?` : type;
    }
    case "default": {
      const inner = (schema as unknown as { unwrap?: () => z.ZodType<unknown> }).unwrap;
      return typeof inner === "function" ? `${describeType(inner.call(schema))}?` : type;
    }
    default:
      return type;
  }
}

function describeProps(schema: z.ZodType<unknown>): {
  props: Record<string, string>;
  required: string[];
} {
  const shape = (schema as { shape?: Record<string, z.ZodType<unknown>> }).shape;
  if (!shape) return { props: {}, required: [] };
  const props: Record<string, string> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    props[key] = describeType(value);
    if (!value.safeParse(undefined).success) required.push(key);
  }
  return { props, required };
}

/**
 * The catalogue the model is allowed to see. It is deliberately narrowed by
 * surface kind and intent first: a smaller, relevant menu produces better
 * component choices than dumping every registered component into the prompt.
 */
export function buildCatalog(
  components: ComponentRegistry,
  actions: ActionRegistry,
  options: { surface: SurfaceKind; intents?: readonly ComponentIntent[]; limit?: number },
): Catalog {
  const candidates = components
    .candidatesFor({
      surface: options.surface,
      ...(options.intents ? { intents: options.intents } : {}),
    })
    .slice(0, options.limit ?? 40);

  return {
    components: candidates.map(({ definition }) => {
      const { props, required } = describeProps(definition.props);
      return {
        name: definition.name,
        description: definition.description,
        intents: definition.intents,
        props,
        requiredProps: required,
        actions: definition.actions,
        events: definition.events,
        slots: definition.capacity.slots,
        acceptsChildren: definition.capacity.maxChildren > 0,
        constraints: definition.constraints,
      };
    }),
    actions: actions.list().map((action) => ({
      id: action.id,
      description: action.description,
      risk: action.risk,
      confirm: action.confirm,
    })),
  };
}
