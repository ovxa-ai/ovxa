import {
  isBinding,
  walkComponents,
  type ComponentNode,
  type Surface,
  type SurfaceAction,
} from "@ovxa/schema";
import type { ActionRegistry, ComponentRegistry } from "@ovxa/registry";

export type GroundingIssue = {
  severity: "error" | "warning";
  path: string;
  message: string;
};

export type GroundingResult = {
  /** The surface with unusable parts removed. Never null. */
  surface: Surface;
  issues: GroundingIssue[];
  repaired: boolean;
};

function actionIsAllowed(
  action: SurfaceAction,
  actions: ActionRegistry,
  allowed: ReadonlySet<string>,
): string | null {
  if (!actions.has(action.id)) return `Action "${action.id}" is not registered`;
  if (allowed.size > 0 && !allowed.has(action.id)) {
    return `Action "${action.id}" is not permitted for this request`;
  }
  return null;
}

/**
 * The fail-closed pass. Anything the model invented — an unregistered
 * component, a prop that does not typecheck, an action the host never exposed
 * — is stripped here, before the surface can reach a renderer.
 *
 * Stripping rather than rejecting is deliberate: a surface missing one card is
 * still useful, whereas a thrown error is a blank screen.
 */
export function groundSurface(
  surface: Surface,
  components: ComponentRegistry,
  actions: ActionRegistry,
  options: { allowedActions?: readonly string[] } = {},
): GroundingResult {
  const issues: GroundingIssue[] = [];
  const allowed = new Set(options.allowedActions ?? []);

  const filterActions = (
    list: SurfaceAction[] | undefined,
    path: string,
  ): SurfaceAction[] | undefined => {
    if (!list) return undefined;
    const kept = list.filter((action) => {
      const reason = actionIsAllowed(action, actions, allowed);
      if (reason) {
        issues.push({ severity: "error", path: `${path}.${action.id}`, message: reason });
        return false;
      }
      return true;
    });
    return kept;
  };

  const prune = (nodes: ComponentNode[], path: string): ComponentNode[] =>
    nodes.flatMap((node, index) => {
      const nodePath = `${path}[${index}]`;
      const validation = components.validateNode(node);
      if (!validation.ok) {
        for (const issue of validation.issues) {
          issues.push({
            severity: "error",
            path: `${nodePath}.${issue.path}`,
            message: issue.message,
          });
        }
        return [];
      }
      const kept: ComponentNode = { ...node };
      const nodeActions = filterActions(node.actions, `${nodePath}.actions`);
      if (nodeActions === undefined) delete kept.actions;
      else kept.actions = nodeActions;
      if (node.children) kept.children = prune(node.children, `${nodePath}.children`);
      return [kept];
    });

  const root = prune(surface.root, "root");
  const surfaceActions = filterActions(surface.actions, "actions") ?? [];

  // A binding that points nowhere renders as a hole; warn so the inspector can
  // show it, but keep the component since it may fill in as state streams.
  walkComponents(root, (node) => {
    for (const [key, value] of Object.entries(node.props)) {
      if (!isBinding(value)) continue;
      const root = value.$bind.split(".")[0] ?? value.$bind;
      if (!(root in surface.state)) {
        issues.push({
          severity: "warning",
          path: `${node.id}.${key}`,
          message: `Binding "${value.$bind}" has no matching state root`,
        });
      }
    }
  });

  const repaired =
    root.length !== surface.root.length ||
    surfaceActions.length !== surface.actions.length ||
    issues.some((issue) => issue.severity === "error");

  return {
    surface: { ...surface, root, actions: surfaceActions },
    issues,
    repaired,
  };
}
