import {
  applySurfacePatch,
  collectBoundPaths,
  resolveSurface,
  type ActionInvocation,
  type JsonValue,
  type ResolvedNode,
  type Surface,
  type SurfaceAction,
  type SurfacePatch,
  type SurfacePatchOperation,
} from "@ovxa/schema";
import type { ActionRegistry } from "@ovxa/registry";
import { SurfaceEventEmitter, type SurfaceEvent } from "@ovxa/protocol";

export type RuntimeListener = (snapshot: RuntimeSnapshot) => void;

export type RuntimeSnapshot = {
  surface: Surface;
  tree: ResolvedNode[];
  /** Operations the surface refused, surfaced to DevTools rather than thrown. */
  issues: readonly string[];
  focusRequest: {
    componentId: string;
    sequence: number;
  } | null;
};

export type InteractionResult =
  | { status: "applied"; message: string | undefined }
  | { status: "recompile"; intent: string }
  | { status: "rejected"; reason: string }
  | { status: "needs-confirmation"; action: SurfaceAction };

function findAction(surface: Surface, actionId: string): SurfaceAction | undefined {
  const search = (actions: SurfaceAction[] | undefined): SurfaceAction | undefined =>
    actions?.find((action) => action.id === actionId);
  const direct = search(surface.actions);
  if (direct) return direct;
  const stack = [...surface.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const match = search(node.actions);
    if (match) return match;
    if (node.children) stack.push(...node.children);
  }
  return undefined;
}

/**
 * Holds one live surface and closes the interaction loop: a user acts, the
 * host's registered handler runs, and the resulting state change patches the
 * surface in place. Only an explicit `recompile` outcome goes back to a model,
 * so the common case costs no inference at all.
 */
export class SurfaceRuntime {
  private surface: Surface;
  private issues: string[] = [];
  private focusRequest: RuntimeSnapshot["focusRequest"] = null;
  private focusSequence = 0;
  private readonly listeners = new Set<RuntimeListener>();
  private readonly emitter = new SurfaceEventEmitter();

  constructor(
    surface: Surface,
    private readonly actions: ActionRegistry,
  ) {
    this.surface = surface;
  }

  get snapshot(): RuntimeSnapshot {
    return {
      surface: this.surface,
      tree: resolveSurface(this.surface),
      issues: [...this.issues],
      focusRequest: this.focusRequest,
    };
  }

  /** Every state path the current surface reads. */
  get boundPaths(): string[] {
    return collectBoundPaths(this.surface);
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onEvent(listener: (event: SurfaceEvent) => void): () => void {
    return this.emitter.subscribe(listener);
  }

  replace(surface: Surface): void {
    this.surface = surface;
    this.issues = [];
    this.focusRequest = null;
    this.publish();
  }

  patch(operations: SurfacePatchOperation[]): RuntimeSnapshot {
    const patch: SurfacePatch = { surfaceId: this.surface.id, operations };
    const result = applySurfacePatch(this.surface, patch);
    this.surface = result.surface;
    const requestedFocus = result.effects.at(-1);
    if (requestedFocus?.type === "focus") {
      this.focusSequence += 1;
      this.focusRequest = {
        componentId: requestedFocus.componentId,
        sequence: this.focusSequence,
      };
    }
    for (const rejection of result.rejected) {
      this.issues.push(`${rejection.operation.op}: ${rejection.reason}`);
    }
    this.publish();
    return this.snapshot;
  }

  /**
   * True when a state change can be re-rendered without the model, i.e. the
   * path is already bound by some component. This is the check that keeps
   * routine updates in the millisecond range.
   */
  canRenderLocally(path: string): boolean {
    return this.boundPaths.some(
      (bound) => bound === path || bound.startsWith(`${path}.`) || path.startsWith(`${bound}.`),
    );
  }

  setState(path: string, value: JsonValue): RuntimeSnapshot {
    return this.patch([{ op: "state.patch", path, value }]);
  }

  /**
   * Runs a user interaction. Optimistic patches are applied before the handler
   * and rolled back if it fails, so the interface stays responsive without
   * lying about the outcome when something goes wrong.
   */
  async interact(
    invocation: Omit<ActionInvocation, "surfaceId" | "source" | "at"> & {
      confirmed?: boolean;
    },
  ): Promise<InteractionResult> {
    const action = findAction(this.surface, invocation.actionId);
    if (!action) {
      return {
        status: "rejected",
        reason: `Action "${invocation.actionId}" is not on this surface`,
      };
    }
    if (action.confirm && !invocation.confirmed) {
      this.patch([
        { op: "action.status", actionId: action.id, status: "confirming" },
      ]);
      return { status: "needs-confirmation", action };
    }

    const before = this.surface;
    this.emitter.emit({
      type: "action.start",
      surfaceId: this.surface.id,
      actionId: action.id,
    });
    this.patch([{ op: "action.status", actionId: action.id, status: "running" }]);

    if (action.optimistic.length > 0) {
      this.patch(
        action.optimistic.map((entry) => ({
          op: "state.patch" as const,
          path: entry.path,
          value: (typeof entry.value === "object" &&
          entry.value !== null &&
          "$bind" in entry.value
            ? null
            : entry.value) as JsonValue,
        })),
      );
    }

    const result = await this.actions.dispatch(
      {
        surfaceId: this.surface.id,
        ...(invocation.componentId ? { componentId: invocation.componentId } : {}),
        actionId: invocation.actionId,
        input: invocation.input,
        source: "generated-ui",
        at: new Date().toISOString(),
      },
      {
        surfaceId: this.surface.id,
        componentId: invocation.componentId,
        state: this.surface.state,
      },
    );

    if (!result.ok) {
      // Roll the optimistic write back rather than leaving a state lie behind.
      this.surface = before;
      this.patch([
        {
          op: "action.status",
          actionId: action.id,
          status: "error",
          detail: result.reason,
        },
      ]);
      this.emitter.emit({
        type: "action.error",
        surfaceId: this.surface.id,
        actionId: action.id,
        message: result.reason,
      });
      return { status: "rejected", reason: result.reason };
    }

    const operations: SurfacePatchOperation[] = Object.entries(
      result.outcome.statePatch ?? {},
    ).map(([path, value]) => ({ op: "state.patch", path, value }));
    operations.push({
      op: "action.status",
      actionId: action.id,
      status: "complete",
      ...(result.outcome.message ? { detail: result.outcome.message } : {}),
    });
    this.patch(operations);

    this.emitter.emit({
      type: "action.complete",
      surfaceId: this.surface.id,
      actionId: action.id,
      ...(result.outcome.message ? { message: result.outcome.message } : {}),
    });

    if (result.outcome.recompile) {
      return { status: "recompile", intent: result.outcome.recompile.intent };
    }
    return { status: "applied", message: result.outcome.message };
  }

  private publish(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function createSurfaceRuntime(
  surface: Surface,
  actions: ActionRegistry,
): SurfaceRuntime {
  return new SurfaceRuntime(surface, actions);
}
