import { describe, expect, it } from "vitest";
import { parseSurface, SCHEMA_VERSION, type Surface } from "@ovxa/schema";
import {
  SurfaceEventEmitter,
  SurfaceStreamReducer,
  decodeSurfaceEvent,
  encodeSurfaceEvent,
} from "./index";

const now = "2026-08-30T12:00:00.000Z";

const shell: Surface = parseSurface({
  schemaVersion: SCHEMA_VERSION,
  id: "srf_1",
  intent: "Show me why revenue dropped",
  kind: "dashboard",
  title: "Revenue investigation",
  layout: { columns: 2, density: "comfortable", maxWidth: "wide" },
  state: {},
  root: [],
  actions: [],
  status: "streaming",
  createdAt: now,
  updatedAt: now,
});

function node(id: string) {
  return { id, type: "Kpi", props: { label: id } };
}

describe("surface stream", () => {
  it("builds a surface progressively from ordered events", () => {
    const reducer = new SurfaceStreamReducer();
    reducer.apply({ type: "surface.start", surface: shell, seq: 0 });
    expect(reducer.current?.root).toHaveLength(0);

    reducer.apply({
      type: "component.add",
      surfaceId: "srf_1",
      parentId: null,
      node: node("kpi"),
      seq: 1,
    });
    reducer.apply({
      type: "state.patch",
      surfaceId: "srf_1",
      path: "revenue.total",
      value: 91200,
      seq: 2,
    });
    reducer.apply({ type: "surface.complete", surfaceId: "srf_1", seq: 3 });

    expect(reducer.current?.root.map((item) => item.id)).toEqual(["kpi"]);
    expect(reducer.current?.state).toEqual({ revenue: { total: 91200 } });
    expect(reducer.current?.status).toBe("ready");
    expect(reducer.isComplete).toBe(true);
  });

  it("buffers out-of-order events until the gap is filled", () => {
    const reducer = new SurfaceStreamReducer();
    reducer.apply({ type: "surface.start", surface: shell, seq: 0 });
    reducer.apply({
      type: "component.add",
      surfaceId: "srf_1",
      parentId: null,
      node: node("second"),
      seq: 2,
    });
    expect(reducer.current?.root).toHaveLength(0);

    reducer.apply({
      type: "component.add",
      surfaceId: "srf_1",
      parentId: null,
      node: node("first"),
      seq: 1,
    });
    expect(reducer.current?.root.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("ignores a replayed event instead of applying it twice", () => {
    const reducer = new SurfaceStreamReducer();
    reducer.apply({ type: "surface.start", surface: shell, seq: 0 });
    const add = {
      type: "component.add" as const,
      surfaceId: "srf_1",
      parentId: null,
      node: node("kpi"),
      seq: 1,
    };
    reducer.apply(add);
    reducer.apply(add);
    expect(reducer.current?.root).toHaveLength(1);
  });

  it("discards malformed events without losing the surface", () => {
    const reducer = new SurfaceStreamReducer();
    reducer.apply({ type: "surface.start", surface: shell, seq: 0 });
    reducer.apply({ type: "component.explode", surfaceId: "srf_1", seq: 1 });
    expect(reducer.current).not.toBeNull();
    expect(reducer.issues.join(" ")).toContain("did not match the protocol");
  });

  it("keeps rendered components when generation fails recoverably", () => {
    const reducer = new SurfaceStreamReducer();
    reducer.apply({ type: "surface.start", surface: shell, seq: 0 });
    reducer.apply({
      type: "component.add",
      surfaceId: "srf_1",
      parentId: null,
      node: node("kpi"),
      seq: 1,
    });
    reducer.apply({
      type: "surface.error",
      surfaceId: "srf_1",
      message: "Model stream interrupted",
      recoverable: true,
      seq: 2,
    });
    expect(reducer.current?.root).toHaveLength(1);
    expect(reducer.current?.status).toBe("streaming");
    expect(reducer.isComplete).toBe(false);
  });

  it("marks the surface failed on an unrecoverable error", () => {
    const reducer = new SurfaceStreamReducer();
    reducer.apply({ type: "surface.start", surface: shell, seq: 0 });
    reducer.apply({
      type: "surface.error",
      surfaceId: "srf_1",
      message: "No provider available",
      recoverable: false,
      seq: 1,
    });
    expect(reducer.current?.status).toBe("failed");
    expect(reducer.isComplete).toBe(true);
  });

  it("tracks action lifecycle onto the surface", () => {
    const withAction = parseSurface({
      ...shell,
      root: [node("kpi")],
      actions: [
        { id: "retry", label: "Retry", input: {}, variant: "secondary", risk: "low" },
      ],
    });
    const reducer = new SurfaceStreamReducer();
    reducer.apply({ type: "surface.start", surface: withAction, seq: 0 });
    reducer.apply({
      type: "action.start",
      surfaceId: "srf_1",
      actionId: "retry",
      seq: 1,
    });
    expect(reducer.current?.actions[0]?.status).toBe("running");
    reducer.apply({
      type: "action.error",
      surfaceId: "srf_1",
      actionId: "retry",
      message: "Upstream timed out",
      seq: 2,
    });
    expect(reducer.current?.actions[0]?.status).toBe("error");
    expect(reducer.current?.actions[0]?.statusDetail).toBe("Upstream timed out");
  });

  it("round-trips events through the wire codec", () => {
    const encoded = encodeSurfaceEvent({
      type: "surface.status",
      surfaceId: "srf_1",
      status: "ready",
      seq: 4,
    });
    expect(decodeSurfaceEvent(encoded)).toEqual({
      type: "surface.status",
      surfaceId: "srf_1",
      status: "ready",
      seq: 4,
    });
    expect(decodeSurfaceEvent("{not json")).toBeNull();
  });

  it("numbers events monotonically from the emitter", () => {
    const emitter = new SurfaceEventEmitter();
    const seen: number[] = [];
    emitter.subscribe((event) => seen.push(event.seq));
    emitter.emit({ type: "surface.start", surface: shell });
    emitter.emit({ type: "surface.complete", surfaceId: "srf_1" });
    expect(seen).toEqual([0, 1]);
  });
});
