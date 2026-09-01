import {
  evaluateCondition,
  isBinding,
  readPath,
  type Bindable,
  type JsonValue,
} from "./primitives";
import { type ComponentNode } from "./component";
import type { Surface } from "./surface";

/**
 * A node with every binding replaced by live state and every hidden branch
 * pruned. Renderers consume this, not the raw schema, so no renderer ever has
 * to understand bindings or conditions.
 */
export type ResolvedNode = {
  id: string;
  type: string;
  props: Record<string, JsonValue>;
  children: ResolvedNode[];
  actions: ComponentNode["actions"];
  phase: NonNullable<ComponentNode["phase"]>;
  error: string | undefined;
  a11y: ComponentNode["a11y"];
  responsive: ComponentNode["responsive"];
  key: string;
};

export function resolveBindable(
  value: Bindable,
  state: Record<string, JsonValue>,
): JsonValue {
  if (isBinding(value)) {
    const resolved = readPath(state, value.$bind);
    if (resolved !== undefined) return resolved;
    return value.fallback ?? null;
  }
  return value;
}

function resolveNode(
  node: ComponentNode,
  state: Record<string, JsonValue>,
): ResolvedNode | null {
  if (node.visibleWhen && !evaluateCondition(node.visibleWhen, state)) return null;

  const props: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(node.props)) {
    props[key] = resolveBindable(value, state);
  }

  const children = (node.children ?? [])
    .map((child) => resolveNode(child, state))
    .filter((child): child is ResolvedNode => child !== null);

  return {
    id: node.id,
    type: node.type,
    props,
    children,
    actions: node.actions,
    phase: node.phase ?? "ready",
    error: node.error,
    a11y: node.a11y,
    responsive: node.responsive,
    key: node.key ?? node.id,
  };
}

export function resolveSurface(surface: Surface): ResolvedNode[] {
  return surface.root
    .map((node) => resolveNode(node, surface.state))
    .filter((node): node is ResolvedNode => node !== null);
}

/**
 * Every state path a surface reads. The runtime uses this to decide whether a
 * state change can be re-rendered deterministically or actually needs the
 * model — the difference between a 5 ms update and a 900 ms one.
 */
export function collectBoundPaths(surface: Surface): string[] {
  const paths = new Set<string>();
  const visit = (nodes: ComponentNode[]): void => {
    for (const node of nodes) {
      for (const value of Object.values(node.props)) {
        if (isBinding(value)) paths.add(value.$bind);
      }
      for (const action of node.actions ?? []) {
        for (const value of Object.values(action.input)) {
          if (isBinding(value)) paths.add(value.$bind);
        }
      }
      if (node.children) visit(node.children);
    }
  };
  visit(surface.root);
  for (const action of surface.actions) {
    for (const value of Object.values(action.input)) {
      if (isBinding(value)) paths.add(value.$bind);
    }
  }
  return [...paths].sort();
}
