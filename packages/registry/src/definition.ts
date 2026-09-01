import { z } from "zod";
import type { ActionRisk, SurfaceKind } from "@ovxa/schema";

/**
 * What a component is *for*. The compiler narrows candidates on these tags
 * before a model ever sees the catalogue, so component choice is a search over
 * semantics rather than a guess at names.
 */
export const componentIntents = [
  "compare",
  "select",
  "summarize",
  "visualize",
  "enumerate",
  "collect-input",
  "confirm",
  "explain",
  "navigate",
  "monitor",
  "annotate",
] as const;
export type ComponentIntent = (typeof componentIntents)[number];

export type ComponentStateSupport = {
  /** Renders its own skeleton while data streams in. */
  loading: boolean;
  /** Renders a useful empty state instead of collapsing to nothing. */
  empty: boolean;
  /** Renders an inline error without taking down the surface. */
  error: boolean;
};

export type ComponentAccessibility = {
  keyboardOperable: boolean;
  /** Needs an author-supplied label because its content is not self-describing. */
  requiresLabel: boolean;
  landmark?: "region" | "navigation" | "complementary" | "search" | "main";
  /**
   * The component's content changes after it renders — progress, status, a
   * streaming result — so a screen reader has to be told. Declared once here
   * rather than left to the model to remember on every node.
   */
  live?: "polite" | "assertive";
};

export type ComponentCapacity = {
  slots: string[];
  minChildren: number;
  maxChildren: number;
};

export type ComponentExample = {
  intent: string;
  props: Record<string, unknown>;
};

export interface ComponentDefinition<TProps = unknown> {
  name: string;
  /** One sentence a model can reason over: what this shows and when to use it. */
  description: string;
  intents: readonly ComponentIntent[];
  /** Surface kinds this component is appropriate for. Empty means any. */
  surfaces: readonly SurfaceKind[];
  props: z.ZodType<TProps>;
  /** Semantic actions this component may invoke, by registered action id. */
  actions: readonly string[];
  /** Interactions it emits back to the host, e.g. `select`, `change`. */
  events: readonly string[];
  variants: readonly string[];
  capacity: ComponentCapacity;
  states: ComponentStateSupport;
  a11y: ComponentAccessibility;
  risk: ActionRisk;
  examples: readonly ComponentExample[];
  /** Free-form notes the compiler passes to the model verbatim. */
  constraints: readonly string[];
}

export type ComponentInput<TProps> = {
  name: string;
  description: string;
  props: z.ZodType<TProps>;
  intents?: readonly ComponentIntent[];
  surfaces?: readonly SurfaceKind[];
  actions?: readonly string[];
  events?: readonly string[];
  variants?: readonly string[];
  capacity?: Partial<ComponentCapacity>;
  states?: Partial<ComponentStateSupport>;
  a11y?: Partial<ComponentAccessibility>;
  risk?: ActionRisk;
  examples?: readonly ComponentExample[];
  constraints?: readonly string[];
};

export function defineComponent<TProps>(
  input: ComponentInput<TProps>,
): ComponentDefinition<TProps> {
  const { landmark, live, ...a11yRest } = input.a11y ?? {};
  return {
    name: input.name,
    description: input.description,
    props: input.props,
    intents: input.intents ?? [],
    surfaces: input.surfaces ?? [],
    actions: input.actions ?? [],
    events: input.events ?? [],
    variants: input.variants ?? [],
    capacity: {
      slots: input.capacity?.slots ?? [],
      minChildren: input.capacity?.minChildren ?? 0,
      maxChildren: input.capacity?.maxChildren ?? 0,
    },
    states: {
      loading: input.states?.loading ?? false,
      empty: input.states?.empty ?? false,
      error: input.states?.error ?? false,
    },
    a11y: {
      keyboardOperable: a11yRest.keyboardOperable ?? false,
      requiresLabel: a11yRest.requiresLabel ?? false,
      ...(landmark ? { landmark } : {}),
      ...(live ? { live } : {}),
    },
    risk: input.risk ?? "read",
    examples: input.examples ?? [],
    constraints: input.constraints ?? [],
  };
}
