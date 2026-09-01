import { z } from "zod";
import { actionSchema } from "./action";
import { bindableSchema, conditionSchema, type Condition } from "./primitives";
import type { SurfaceAction } from "./action";
import type { Bindable } from "./primitives";

export const breakpoints = ["sm", "md", "lg"] as const;
export type Breakpoint = (typeof breakpoints)[number];

/**
 * Every component declares its own async story. A generated surface streams in
 * over time, so "no data yet" and "this failed" are first-class node states
 * rather than something the renderer has to infer.
 */
export const componentPhases = [
  "ready",
  "loading",
  "empty",
  "error",
] as const;
export type ComponentPhase = (typeof componentPhases)[number];

export const accessibilitySchema = z
  .object({
    label: z.string().max(200).optional(),
    description: z.string().max(400).optional(),
    /** Promotes the node to a landmark so generated pages stay navigable. */
    landmark: z
      .enum(["main", "navigation", "complementary", "region", "search"])
      .optional(),
    live: z.enum(["off", "polite", "assertive"]).optional(),
  })
  .strict();

export type Accessibility = z.infer<typeof accessibilitySchema>;

export const responsiveSchema = z
  .object({
    span: z.record(z.enum(breakpoints), z.number().int().min(1).max(12)).optional(),
    hideAt: z.array(z.enum(breakpoints)).max(3).optional(),
  })
  .strict();

export type Responsive = z.infer<typeof responsiveSchema>;

/**
 * Optional members carry an explicit `| undefined` so the inferred Zod output
 * stays assignable under `exactOptionalPropertyTypes`.
 */
export type ComponentNode = {
  id: string;
  type: string;
  props: Record<string, Bindable>;
  children?: ComponentNode[] | undefined;
  slot?: string | undefined;
  visibleWhen?: Condition | undefined;
  actions?: SurfaceAction[] | undefined;
  phase?: ComponentPhase | undefined;
  error?: string | undefined;
  a11y?: Accessibility | undefined;
  responsive?: Responsive | undefined;
  /** Stable key for reconciliation when a node moves between parents. */
  key?: string | undefined;
};

export const componentNodeSchema: z.ZodType<ComponentNode> = z.lazy(() =>
  z
    .object({
      id: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[A-Za-z0-9_:-]+$/, "Component id must be URL and DOM safe"),
      type: z.string().min(1).max(80),
      props: z.record(z.string(), bindableSchema).default({}),
      children: z.array(componentNodeSchema).max(200).optional(),
      slot: z.string().max(40).optional(),
      visibleWhen: conditionSchema.optional(),
      actions: z.array(actionSchema).max(24).optional(),
      phase: z.enum(componentPhases).optional(),
      error: z.string().max(400).optional(),
      a11y: accessibilitySchema.optional(),
      responsive: responsiveSchema.optional(),
      key: z.string().max(80).optional(),
    })
    .strict(),
);

/** Depth-first walk over a node tree, parents before children. */
export function walkComponents(
  nodes: ComponentNode[],
  visit: (node: ComponentNode, parent: ComponentNode | null) => void,
  parent: ComponentNode | null = null,
): void {
  for (const node of nodes) {
    visit(node, parent);
    if (node.children) walkComponents(node.children, visit, node);
  }
}

export function findComponent(
  nodes: ComponentNode[],
  id: string,
): ComponentNode | null {
  let found: ComponentNode | null = null;
  walkComponents(nodes, (node) => {
    if (!found && node.id === id) found = node;
  });
  return found;
}

export function collectComponentIds(nodes: ComponentNode[]): string[] {
  const ids: string[] = [];
  walkComponents(nodes, (node) => ids.push(node.id));
  return ids;
}
