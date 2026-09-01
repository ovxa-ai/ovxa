import { z } from "zod";
import { isBinding, type ComponentNode, type SurfaceKind } from "@ovxa/schema";
import type { ComponentDefinition, ComponentIntent } from "./definition";

export type PropIssue = {
  componentId: string;
  path: string;
  message: string;
};

export type NodeValidation =
  | { ok: true }
  | { ok: false; issues: PropIssue[] };

/** Ranked candidate returned by `candidatesFor`. */
export type ComponentCandidate = {
  definition: ComponentDefinition;
  score: number;
  reasons: string[];
};

function requiredKeys(schema: z.ZodType<unknown>): string[] {
  const shape = (schema as { shape?: Record<string, z.ZodType<unknown>> }).shape;
  if (!shape) return [];
  return Object.entries(shape)
    .filter(([, value]) => !value.safeParse(undefined).success)
    .map(([key]) => key);
}

/**
 * The set of components a generated surface is allowed to use. Registration is
 * an allowlist: a node whose `type` is not registered never reaches the
 * renderer, which is the primary containment boundary for model output.
 */
export class ComponentRegistry {
  private readonly components = new Map<string, ComponentDefinition>();

  register<TProps>(definition: ComponentDefinition<TProps>): this {
    if (this.components.has(definition.name)) {
      throw new Error(`Component "${definition.name}" is already registered`);
    }
    this.components.set(definition.name, definition as ComponentDefinition);
    return this;
  }

  registerAll(definitions: readonly ComponentDefinition<never>[]): this {
    for (const definition of definitions) this.register(definition);
    return this;
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  get(name: string): ComponentDefinition | undefined {
    return this.components.get(name);
  }

  list(): ComponentDefinition[] {
    return [...this.components.values()];
  }

  names(): string[] {
    return [...this.components.keys()].sort();
  }

  /**
   * Deterministic narrowing before the model chooses. Surface compatibility is
   * a hard filter; intent overlap only ranks, so a well-described component
   * still surfaces for an intent nobody tagged.
   */
  candidatesFor(options: {
    surface: SurfaceKind;
    intents?: readonly ComponentIntent[];
  }): ComponentCandidate[] {
    const wanted = new Set(options.intents ?? []);
    return this.list()
      .filter(
        (definition) =>
          definition.surfaces.length === 0 ||
          definition.surfaces.includes(options.surface),
      )
      .map((definition) => {
        const reasons: string[] = [];
        let score = 1;
        if (definition.surfaces.includes(options.surface)) {
          score += 2;
          reasons.push(`declared for ${options.surface} surfaces`);
        }
        const overlap = definition.intents.filter((intent) => wanted.has(intent));
        if (overlap.length > 0) {
          score += overlap.length * 3;
          reasons.push(`matches intent ${overlap.join(", ")}`);
        }
        if (definition.states.loading && definition.states.empty) {
          score += 1;
          reasons.push("handles loading and empty states");
        }
        return { definition, score, reasons };
      })
      .sort((a, b) =>
        b.score === a.score
          ? a.definition.name.localeCompare(b.definition.name)
          : b.score - a.score,
      );
  }

  /**
   * Validates a node's props against the registered schema. Bound props are
   * checked for presence but not for type — their value only exists once the
   * runtime resolves state, so they are re-checked at resolve time.
   */
  validateNode(node: ComponentNode): NodeValidation {
    const definition = this.components.get(node.type);
    if (!definition) {
      return {
        ok: false,
        issues: [
          {
            componentId: node.id,
            path: "type",
            message: `Component "${node.type}" is not registered`,
          },
        ],
      };
    }

    const issues: PropIssue[] = [];
    const boundKeys = Object.entries(node.props)
      .filter(([, value]) => isBinding(value))
      .map(([key]) => key);
    const literal = Object.fromEntries(
      Object.entries(node.props).filter(([key]) => !boundKeys.includes(key)),
    );

    const objectSchema = definition.props as unknown as {
      partial?: () => z.ZodType<unknown>;
    };
    const lenient =
      typeof objectSchema.partial === "function"
        ? objectSchema.partial()
        : definition.props;
    const parsed = lenient.safeParse(literal);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          componentId: node.id,
          path: issue.path.join(".") || "props",
          message: issue.message,
        });
      }
    }

    for (const key of requiredKeys(definition.props)) {
      if (!(key in node.props)) {
        issues.push({
          componentId: node.id,
          path: key,
          message: `Required prop "${key}" is missing on <${node.type}>`,
        });
      }
    }

    const childCount = node.children?.length ?? 0;
    if (childCount > definition.capacity.maxChildren) {
      issues.push({
        componentId: node.id,
        path: "children",
        message: `<${node.type}> accepts at most ${definition.capacity.maxChildren} children, received ${childCount}`,
      });
    }
    if (childCount < definition.capacity.minChildren) {
      issues.push({
        componentId: node.id,
        path: "children",
        message: `<${node.type}> requires at least ${definition.capacity.minChildren} children`,
      });
    }

    if (definition.a11y.requiresLabel && !node.a11y?.label) {
      issues.push({
        componentId: node.id,
        path: "a11y.label",
        message: `<${node.type}> is not self-describing and needs an accessible label`,
      });
    }

    for (const action of node.actions ?? []) {
      if (
        definition.actions.length > 0 &&
        !definition.actions.includes(action.id)
      ) {
        issues.push({
          componentId: node.id,
          path: `actions.${action.id}`,
          message: `<${node.type}> does not expose action "${action.id}"`,
        });
      }
    }

    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }
}

export function createRegistry(): ComponentRegistry {
  return new ComponentRegistry();
}
