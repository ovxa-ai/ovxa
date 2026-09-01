import { z } from "zod";
import { actionSchema, actionStatuses, type SurfaceAction } from "./action";
import { componentNodeSchema, componentPhases, type ComponentNode } from "./component";
import {
  bindableSchema,
  conditionSchema,
  jsonValueSchema,
  type JsonValue,
} from "./primitives";
import { layoutSchema, surfaceKinds, surfaceStatuses, type Surface } from "./surface";

/**
 * The patch vocabulary. A generated interface is mutated by addressing nodes,
 * never by regenerating the tree: that is what preserves user selections, form
 * values, scroll position and focus across model turns.
 */
export const surfacePatchOperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("surface.patch"),
      title: z.string().min(1).max(140).optional(),
      description: z.string().max(400).optional(),
      kind: z.enum(surfaceKinds).optional(),
      layout: layoutSchema.partial().optional(),
      status: z.enum(surfaceStatuses).optional(),
      /**
       * Replaces the surface-level action set. A streaming surface only learns
       * its actions once generation finishes, so this has to be patchable
       * rather than fixed at creation.
       */
      actions: z.array(actionSchema).max(24).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("component.add"),
      parentId: z.string().min(1).nullable(),
      index: z.number().int().min(0).optional(),
      node: componentNodeSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("component.patch"),
      id: z.string().min(1),
      /** Shallow-merged into existing props so untouched bindings survive. */
      props: z.record(z.string(), bindableSchema).optional(),
      phase: z.enum(componentPhases).optional(),
      error: z.string().max(400).nullable().optional(),
      visibleWhen: conditionSchema.nullable().optional(),
      actions: z.array(actionSchema).max(24).optional(),
    })
    .strict(),
  z.object({ op: z.literal("component.remove"), id: z.string().min(1) }).strict(),
  z
    .object({
      op: z.literal("component.replace"),
      id: z.string().min(1),
      node: componentNodeSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("component.move"),
      id: z.string().min(1),
      parentId: z.string().min(1).nullable(),
      index: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      op: z.literal("component.focus"),
      id: z.string().min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("state.patch"),
      path: z.string().min(1),
      value: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("action.status"),
      actionId: z.string().min(1),
      status: z.enum(actionStatuses),
      detail: z.string().max(400).optional(),
    })
    .strict(),
]);

export type SurfacePatchOperation = z.infer<typeof surfacePatchOperationSchema>;

export const surfacePatchSchema = z
  .object({
    surfaceId: z.string().min(1),
    operations: z.array(surfacePatchOperationSchema).min(1).max(200),
  })
  .strict();

export type SurfacePatch = z.infer<typeof surfacePatchSchema>;

export type RejectedOperation = {
  operation: SurfacePatchOperation;
  reason: string;
};

export type PatchResult = {
  surface: Surface;
  applied: number;
  rejected: RejectedOperation[];
  effects: PatchEffect[];
};

export type PatchEffect = {
  type: "focus";
  componentId: string;
};

function writePath(
  state: Record<string, JsonValue>,
  path: string,
  value: JsonValue,
): Record<string, JsonValue> {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return state;
  const next = { ...state };
  let cursor: Record<string, JsonValue> = next;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] as string;
    const existing = cursor[segment];
    const child: JsonValue =
      typeof existing === "object" && existing !== null && !Array.isArray(existing)
        ? { ...existing }
        : {};
    cursor[segment] = child;
    cursor = child as Record<string, JsonValue>;
  }
  cursor[segments[segments.length - 1] as string] = value;
  return next;
}

function removeNode(nodes: ComponentNode[], id: string): ComponentNode | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index] as ComponentNode;
    if (node.id === id) {
      nodes.splice(index, 1);
      return node;
    }
    if (node.children) {
      const removed = removeNode(node.children, id);
      if (removed) return removed;
    }
  }
  return null;
}

function insertNode(
  root: ComponentNode[],
  parentId: string | null,
  index: number | undefined,
  node: ComponentNode,
): boolean {
  if (parentId === null) {
    root.splice(index ?? root.length, 0, node);
    return true;
  }
  let inserted = false;
  const visit = (nodes: ComponentNode[]): void => {
    for (const candidate of nodes) {
      if (inserted) return;
      if (candidate.id === parentId) {
        const children = candidate.children ?? [];
        children.splice(index ?? children.length, 0, node);
        candidate.children = children;
        inserted = true;
        return;
      }
      if (candidate.children) visit(candidate.children);
    }
  };
  visit(root);
  return inserted;
}

function mutateNode(
  nodes: ComponentNode[],
  id: string,
  mutate: (node: ComponentNode) => void,
): boolean {
  for (const node of nodes) {
    if (node.id === id) {
      mutate(node);
      return true;
    }
    if (node.children && mutateNode(node.children, id, mutate)) return true;
  }
  return false;
}

function findNode(
  nodes: ComponentNode[],
  id: string,
): ComponentNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const nested = findNode(node.children, id);
      if (nested) return nested;
    }
  }
  return undefined;
}

function replaceNode(
  nodes: ComponentNode[],
  id: string,
  replacement: ComponentNode,
): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index] as ComponentNode;
    if (node.id === id) {
      nodes[index] = replacement;
      return true;
    }
    if (node.children && replaceNode(node.children, id, replacement)) {
      return true;
    }
  }
  return false;
}

function idsIn(node: ComponentNode): string[] {
  return [node.id, ...(node.children ?? []).flatMap(idsIn)];
}

/**
 * Applies a patch operation by operation. Invalid operations are rejected
 * individually rather than failing the whole patch, so a partially bad model
 * response degrades to a slightly stale surface instead of a blank screen.
 */
export function applySurfacePatch(
  surface: Surface,
  patch: SurfacePatch,
): PatchResult {
  if (patch.surfaceId !== surface.id) {
    return {
      surface,
      applied: 0,
      effects: [],
      rejected: patch.operations.map((operation) => ({
        operation,
        reason: `Patch targets surface "${patch.surfaceId}", not "${surface.id}"`,
      })),
    };
  }

  const next: Surface = structuredClone(surface);
  const rejected: RejectedOperation[] = [];
  const effects: PatchEffect[] = [];
  let applied = 0;
  const existingIds = new Set(next.root.flatMap(idsIn));

  for (const operation of patch.operations) {
    switch (operation.op) {
      case "surface.patch": {
        if (operation.title !== undefined) next.title = operation.title;
        if (operation.description !== undefined) {
          next.description = operation.description;
        }
        if (operation.kind !== undefined) next.kind = operation.kind;
        if (operation.status !== undefined) next.status = operation.status;
        if (operation.actions !== undefined) next.actions = operation.actions;
        if (operation.layout !== undefined) {
          // A partial layout omits keys as `undefined`; spreading those would
          // erase the current value instead of leaving it alone.
          const defined = Object.fromEntries(
            Object.entries(operation.layout).filter(
              ([, value]) => value !== undefined,
            ),
          );
          next.layout = { ...next.layout, ...defined };
        }
        applied += 1;
        break;
      }
      case "component.add": {
        const incoming = idsIn(operation.node);
        const clash = incoming.find((id) => existingIds.has(id));
        if (clash) {
          rejected.push({
            operation,
            reason: `Component id "${clash}" already exists on this surface`,
          });
          break;
        }
        if (!insertNode(next.root, operation.parentId, operation.index, operation.node)) {
          rejected.push({
            operation,
            reason: `Parent component "${operation.parentId ?? "root"}" was not found`,
          });
          break;
        }
        for (const id of incoming) existingIds.add(id);
        applied += 1;
        break;
      }
      case "component.patch": {
        const ok = mutateNode(next.root, operation.id, (node) => {
          if (operation.props) node.props = { ...node.props, ...operation.props };
          if (operation.phase !== undefined) node.phase = operation.phase;
          if (operation.actions !== undefined) node.actions = operation.actions;
          if (operation.error !== undefined) {
            if (operation.error === null) delete node.error;
            else node.error = operation.error;
          }
          if (operation.visibleWhen !== undefined) {
            if (operation.visibleWhen === null) delete node.visibleWhen;
            else node.visibleWhen = operation.visibleWhen;
          }
        });
        if (!ok) {
          rejected.push({
            operation,
            reason: `Component "${operation.id}" was not found`,
          });
          break;
        }
        applied += 1;
        break;
      }
      case "component.remove": {
        const removed = removeNode(next.root, operation.id);
        if (!removed) {
          rejected.push({
            operation,
            reason: `Component "${operation.id}" was not found`,
          });
          break;
        }
        for (const id of idsIn(removed)) existingIds.delete(id);
        applied += 1;
        break;
      }
      case "component.replace": {
        const current = findNode(next.root, operation.id);
        if (!current) {
          rejected.push({
            operation,
            reason: `Component "${operation.id}" was not found`,
          });
          break;
        }
        const replacedIds = new Set(idsIn(current));
        const incoming = idsIn(operation.node);
        const duplicate = incoming.find(
          (id, index) => incoming.indexOf(id) !== index,
        );
        const clash = incoming.find(
          (id) => existingIds.has(id) && !replacedIds.has(id),
        );
        if (duplicate || clash) {
          rejected.push({
            operation,
            reason: `Component id "${duplicate ?? clash}" already exists on this surface`,
          });
          break;
        }
        replaceNode(next.root, operation.id, operation.node);
        for (const id of replacedIds) existingIds.delete(id);
        for (const id of incoming) existingIds.add(id);
        applied += 1;
        break;
      }
      case "component.move": {
        if (operation.parentId === operation.id) {
          rejected.push({ operation, reason: "A component cannot parent itself" });
          break;
        }
        const detached = removeNode(next.root, operation.id);
        if (!detached) {
          rejected.push({
            operation,
            reason: `Component "${operation.id}" was not found`,
          });
          break;
        }
        // Moving a node under its own descendant would detach the subtree.
        const descendants = new Set(idsIn(detached));
        if (operation.parentId !== null && descendants.has(operation.parentId)) {
          insertNode(next.root, null, undefined, detached);
          rejected.push({
            operation,
            reason: "A component cannot move inside its own subtree",
          });
          break;
        }
        if (!insertNode(next.root, operation.parentId, operation.index, detached)) {
          insertNode(next.root, null, undefined, detached);
          rejected.push({
            operation,
            reason: `Parent component "${operation.parentId ?? "root"}" was not found`,
          });
          break;
        }
        applied += 1;
        break;
      }
      case "component.focus": {
        if (!existingIds.has(operation.id)) {
          rejected.push({
            operation,
            reason: `Component "${operation.id}" was not found`,
          });
          break;
        }
        effects.push({ type: "focus", componentId: operation.id });
        applied += 1;
        break;
      }
      case "state.patch": {
        next.state = writePath(next.state, operation.path, operation.value);
        applied += 1;
        break;
      }
      case "action.status": {
        let found = false;
        const update = (action: SurfaceAction) => {
          if (action.id !== operation.actionId) return;
          found = true;
          action.status = operation.status;
          if (operation.detail !== undefined) action.statusDetail = operation.detail;
        };
        next.actions.forEach(update);
        const visitAll = (nodes: ComponentNode[]): void => {
          for (const node of nodes) {
            node.actions?.forEach(update);
            if (node.children) visitAll(node.children);
          }
        };
        visitAll(next.root);
        if (!found) {
          rejected.push({
            operation,
            reason: `Action "${operation.actionId}" is not present on this surface`,
          });
          break;
        }
        applied += 1;
        break;
      }
    }
  }

  next.updatedAt = new Date().toISOString();
  return { surface: next, applied, rejected, effects };
}
