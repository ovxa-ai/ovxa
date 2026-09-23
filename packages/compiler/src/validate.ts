import {
  isBinding,
  walkComponents,
  type ComponentNode,
  type Surface,
  type SurfaceAction,
} from "@ovxa/schema";
import type { ActionRegistry, ComponentRegistry } from "@ovxa/registry";

const ACTION_LABEL: Record<string, string> = {
  confirm: "Continue",
  submit: "Continue",
  dismiss: "Not now",
  approve: "Approve",
  reject: "Reject",
  drillDown: "Open",
  selectOption: "Select",
  setField: "Update",
  setFilter: "Filter",
  openSource: "Open source",
  retryTool: "Retry",
  changePeriod: "Change period",
  exportData: "Export",
};

function catalogAction(id: string, actions: ActionRegistry): SurfaceAction {
  const definition = actions.get(id);
  const primary = id === "confirm" || id === "submit" || id === "approve";
  return {
    id,
    label: ACTION_LABEL[id] ?? id,
    input: {},
    variant: primary ? "primary" : id === "reject" ? "destructive" : "secondary",
    risk: definition?.risk ?? "low",
    status: "idle",
    optimistic: [],
  };
}

/**
 * A generated node is clickable only if the action is on the node. Models often
 * omit that, so each component gets the actions its definition already declared.
 * Actions the model did supply are left alone.
 */
function stateList(state: Surface["state"], key: string): boolean {
  const value = state[key];
  return Array.isArray(value) && value.length > 0;
}

function bound(state: Surface["state"], key: string): { $bind: string } | null {
  const value = state[key];
  if (typeof value === "string" && value.trim().length === 0) return null;
  if (value === undefined || value === null) return null;
  return { $bind: key };
}

/**
 * A decision already lives in state: title, then the records that support it.
 *
 * Models vary the tree. The screen should not. One headline, the numbers, the
 * list or the form, and the same two decisions.
 */
export function composeBoundSurface(
  surface: Surface,
  actions: ActionRegistry,
  allowedActions: readonly string[] = [],
): Surface {
  const title = surface.state["title"];
  if (typeof title !== "string" || title.trim().length === 0) return surface;

  const allow = (id: string): boolean =>
    actions.has(id) && (allowedActions.length === 0 || allowedActions.includes(id));

  const decision = (ids: string[]): SurfaceAction[] =>
    ids.filter(allow).map((id) => catalogAction(id, actions));

  const calloutProps: Record<string, { $bind: string }> = {};
  for (const key of ["title", "body", "tone"] as const) {
    const prop = bound(surface.state, key);
    if (prop) calloutProps[key] = prop;
  }

  const hasOptions = stateList(surface.state, "options");
  const hasForm = stateList(surface.state, "fields");
  const hasAnomalies = stateList(surface.state, "anomalies");
  // A recorded outcome is the end of the loop. Another Continue would ask for the same screen.
  const settled =
    surface.state["tone"] === "success" && !hasOptions && !hasForm && !hasAnomalies;
  const formIsDecision = hasForm && !hasOptions;
  const root: ComponentNode[] = [
    {
      id: "decision",
      type: "Callout",
      props: calloutProps,
      actions: formIsDecision || settled ? [] : decision(["confirm", "dismiss"]),
    },
  ];

  if (stateList(surface.state, "metrics")) {
    root.push({
      id: "metrics",
      type: "MetricRow",
      props: { metrics: { $bind: "metrics" } },
    });
  }
  // One support for the decision: the choice, else the form, else the list.
  if (hasOptions) {
    const props: Record<string, { $bind: string }> = { options: { $bind: "options" } };
    if (bound(surface.state, "selectedId")) props["selectedId"] = { $bind: "selectedId" };
    root.push({
      id: "options",
      type: "OptionGrid",
      props,
      actions: decision(["selectOption"]),
    });
  } else if (hasForm) {
    root.push({
      id: "fields",
      type: "FieldSet",
      props: { fields: { $bind: "fields" } },
    });
  } else if (hasAnomalies) {
    root.push({
      id: "anomalies",
      type: "AnomalyList",
      props: { anomalies: { $bind: "anomalies" } },
      actions: decision(["drillDown"]),
    });
  }

  const placed = new Set(root.map((node) => node.type));
  for (const node of surface.root) {
    if (placed.has(node.type)) continue;
    if (node.type === "Section" || node.type === "JsonViewer" || node.type === "Callout") continue;
    root.push(node);
  }

  return {
    ...surface,
    title: title.trim().slice(0, 140),
    ...(typeof surface.state["body"] === "string"
      ? { description: surface.state["body"].slice(0, 400) }
      : {}),
    layout: { ...surface.layout, columns: 1 },
    root,
  };
}

export function ensureComponentActions(
  surface: Surface,
  components: ComponentRegistry,
  actions: ActionRegistry,
  allowedActions: readonly string[] = [],
): Surface {
  const allowed = new Set(allowedActions);
  const decorate = (nodes: ComponentNode[]): ComponentNode[] =>
    nodes.map((node) => {
      const declared = components.get(node.type)?.actions ?? [];
      const existing = node.actions ?? [];
      const next =
        existing.length > 0
          ? existing
          : declared
              .filter((id) => actions.has(id) && (allowed.size === 0 || allowed.has(id)))
              .map((id) => catalogAction(id, actions));
      return {
        ...node,
        ...(next.length > 0 ? { actions: next } : {}),
        ...(node.children ? { children: decorate(node.children) } : {}),
      };
    });
  return { ...surface, root: decorate(surface.root) };
}

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
