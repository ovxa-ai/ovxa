import {
  applySurfacePatch,
  type Surface,
  type SurfacePatchOperation,
} from "@ovxa/schema";
import { isTerminalEvent, safeParseSurfaceEvent, type SurfaceEvent } from "./events";

/**
 * `Omit` over a union collapses it to the shared keys, which would let any
 * event carry any payload. Distributing keeps each variant intact.
 */
type Unsequenced<T> = T extends unknown ? Omit<T, "seq"> : never;

export type SurfaceEventInput = Unsequenced<SurfaceEvent>;

/** Assigns sequence numbers so a consumer can detect gaps and reorder. */
export class SurfaceEventEmitter {
  private seq = 0;
  private readonly listeners = new Set<(event: SurfaceEvent) => void>();

  subscribe(listener: (event: SurfaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: SurfaceEventInput): SurfaceEvent {
    const complete = { ...event, seq: this.seq } as SurfaceEvent;
    this.seq += 1;
    for (const listener of this.listeners) listener(complete);
    return complete;
  }

  get emitted(): number {
    return this.seq;
  }
}

export type ApplyOutcome = {
  surface: Surface | null;
  /** Operations the surface refused, kept for the inspector rather than thrown. */
  rejected: string[];
  done: boolean;
};

/**
 * Folds a stream of events into a surface. Out-of-order and duplicate events
 * are dropped rather than applied, because a patch applied twice would corrupt
 * component ordering.
 */
export class SurfaceStreamReducer {
  private surface: Surface | null = null;
  private expected = 0;
  private readonly pending = new Map<number, SurfaceEvent>();
  private done = false;
  private readonly rejected: string[] = [];

  get current(): Surface | null {
    return this.surface;
  }

  get isComplete(): boolean {
    return this.done;
  }

  get issues(): readonly string[] {
    return this.rejected;
  }

  apply(raw: unknown): ApplyOutcome {
    const event = safeParseSurfaceEvent(raw);
    if (!event) {
      this.rejected.push("Discarded an event that did not match the protocol");
      return { surface: this.surface, rejected: [...this.rejected], done: this.done };
    }
    if (event.seq < this.expected) {
      return { surface: this.surface, rejected: [...this.rejected], done: this.done };
    }
    this.pending.set(event.seq, event);
    while (this.pending.has(this.expected)) {
      const next = this.pending.get(this.expected) as SurfaceEvent;
      this.pending.delete(this.expected);
      this.expected += 1;
      this.reduce(next);
    }
    return { surface: this.surface, rejected: [...this.rejected], done: this.done };
  }

  private patch(operations: SurfacePatchOperation[]): void {
    if (!this.surface) return;
    const result = applySurfacePatch(this.surface, {
      surfaceId: this.surface.id,
      operations,
    });
    this.surface = result.surface;
    for (const rejection of result.rejected) {
      this.rejected.push(`${rejection.operation.op}: ${rejection.reason}`);
    }
  }

  private reduce(event: SurfaceEvent): void {
    switch (event.type) {
      case "surface.start":
        this.surface = event.surface;
        break;
      case "surface.patch":
        this.patch(event.operations);
        break;
      case "component.add":
        this.patch([
          {
            op: "component.add",
            parentId: event.parentId,
            ...(event.index === undefined ? {} : { index: event.index }),
            node: event.node,
          },
        ]);
        break;
      case "state.patch":
        this.patch([{ op: "state.patch", path: event.path, value: event.value }]);
        break;
      case "surface.status":
        this.patch([{ op: "surface.patch", status: event.status }]);
        break;
      case "action.start":
        this.patch([
          { op: "action.status", actionId: event.actionId, status: "running" },
        ]);
        break;
      case "action.complete":
        this.patch([
          {
            op: "action.status",
            actionId: event.actionId,
            status: "complete",
            ...(event.message === undefined ? {} : { detail: event.message }),
          },
        ]);
        break;
      case "action.error":
        this.patch([
          {
            op: "action.status",
            actionId: event.actionId,
            status: "error",
            detail: event.message,
          },
        ]);
        break;
      case "surface.error":
        this.rejected.push(event.message);
        if (!event.recoverable) this.patch([{ op: "surface.patch", status: "failed" }]);
        break;
      case "surface.complete":
        this.patch([{ op: "surface.patch", status: "ready" }]);
        break;
    }
    if (isTerminalEvent(event)) this.done = true;
  }
}

/** Newline-delimited JSON, so the same events ride SSE, WebSocket or a file. */
export function encodeSurfaceEvent(event: SurfaceEvent): string {
  return JSON.stringify(event);
}

export function decodeSurfaceEvent(line: string): SurfaceEvent | null {
  try {
    return safeParseSurfaceEvent(JSON.parse(line));
  } catch {
    return null;
  }
}
