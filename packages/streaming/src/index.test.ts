import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createActionRegistry,
  createRegistry,
  defineAction,
  defineComponent,
} from "@ovxa/registry";
import { SCHEMA_VERSION, type Surface } from "@ovxa/schema";
import { SurfaceStreamReducer, type SurfaceEvent } from "@ovxa/protocol";
import type { SurfaceModel } from "@ovxa/compiler";
import {
  IncrementalSurfaceParser,
  SseDecoder,
  collectStream,
  encodeSseEvent,
  streamSurface,
} from "./index";

function fixtures() {
  const components = createRegistry()
    .register(
      defineComponent({
        name: "PlanGrid",
        description: "Side-by-side plans.",
        intents: ["compare", "select"],
        surfaces: ["comparison"],
        props: z.object({ plans: z.array(z.unknown()) }),
        actions: ["selectPlan"],
      }),
    )
    .register(
      defineComponent({
        name: "Callout",
        description: "One recommendation.",
        intents: ["explain"],
        surfaces: [],
        props: z.object({ title: z.string(), body: z.string() }),
      }),
    );
  const actions = createActionRegistry().register(
    defineAction({
      id: "selectPlan",
      description: "Pick a plan.",
      input: z.object({ plan: z.string() }),
      handler: () => ({}),
    }),
  );
  return { components, actions };
}

const context = {
  intent: "Compare these three enterprise plans and let me choose one",
  state: { plans: [{ name: "Pro" }, { name: "Scale" }] },
  allowedActions: ["selectPlan"],
};

function surfaceDocument(root: unknown[], extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "comparison",
    title: "Choose your plan",
    description: "Two plans, one decision.",
    layout: { columns: 3, density: "comfortable", maxWidth: "wide" },
    root,
    actions: [],
    status: "ready",
    ...extra,
  };
}

const planGridNode = {
  id: "grid",
  type: "PlanGrid",
  props: { plans: { $bind: "plans" } },
};

const calloutNode = {
  id: "advice",
  type: "Callout",
  props: { title: "Pick Scale", body: "It fits your seat count." },
};

/**
 * Emits a document in fixed-size slices, the way a provider delivers tokens.
 * Small slices are deliberate: they land mid-token and mid-string, which is
 * where an incremental scanner breaks if it is wrong.
 */
function streamingModel(document: unknown, sliceSize = 7): SurfaceModel {
  const text = JSON.stringify(document);
  return {
    name: "streaming-model",
    generateSurface: async () => document,
    async *streamSurface() {
      for (let index = 0; index < text.length; index += sliceSize) {
        yield text.slice(index, index + sliceSize);
      }
    },
  };
}

describe("IncrementalSurfaceParser", () => {
  it("yields each root element as its braces balance", () => {
    const parser = new IncrementalSurfaceParser();
    const text = JSON.stringify(surfaceDocument([planGridNode, calloutNode]));
    const nodes: unknown[] = [];
    for (let index = 0; index < text.length; index += 3) {
      nodes.push(...parser.push(text.slice(index, index + 3)).nodes);
    }
    expect(nodes).toEqual([planGridNode, calloutNode]);
    expect(parser.complete).toBe(true);
  });

  it("does not mistake braces inside strings for structure", () => {
    const parser = new IncrementalSurfaceParser();
    const node = {
      id: "advice",
      type: "Callout",
      props: { title: "}{ \" ]", body: "a \\ b" },
    };
    const { nodes } = parser.push(JSON.stringify(surfaceDocument([node])));
    expect(nodes).toEqual([node]);
  });

  it("reports header fields only once their string has closed", () => {
    const parser = new IncrementalSurfaceParser();
    const first = parser.push('{"title":"Choose your pl');
    expect(first.header).toBeNull();
    const second = parser.push('an","kind":"comparison",');
    expect(second.header).toEqual({ title: "Choose your plan", kind: "comparison" });
    // Already reported: it must not be emitted a second time.
    expect(parser.push('"root":[]').header).toBeNull();
  });

  it("keeps earlier elements when the document is cut off mid-node", () => {
    const parser = new IncrementalSurfaceParser();
    const text = JSON.stringify(surfaceDocument([planGridNode, calloutNode]));
    const truncated = text.slice(0, text.indexOf('"advice"') + 4);
    const { nodes } = parser.push(truncated);
    expect(nodes).toEqual([planGridNode]);
    expect(parser.complete).toBe(false);
  });
});

describe("streamSurface", () => {
  it("emits a laid-out shell before any component exists", async () => {
    const { components, actions } = fixtures();
    const stream = streamSurface(context, {
      components,
      actions,
      model: streamingModel(surfaceDocument([planGridNode, calloutNode])),
    });

    const first = await stream.next();
    expect(first.done).toBe(false);
    const event = first.value as SurfaceEvent;
    expect(event.type).toBe("surface.start");
    if (event.type !== "surface.start") throw new Error("expected surface.start");
    expect(event.surface.root).toHaveLength(0);
    expect(event.surface.kind).toBe("comparison");
    expect(event.surface.status).toBe("streaming");
    expect(event.surface.title.length).toBeGreaterThan(0);
    await stream.return(undefined as never);
  });

  it("adds each component as the model writes it, not at the end", async () => {
    const { components, actions } = fixtures();
    const { events, result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: streamingModel(surfaceDocument([planGridNode, calloutNode])),
      }),
    );

    const added = events.flatMap((event) =>
      event.type === "component.add" ? [event.node.id] : [],
    );
    expect(added).toEqual(["grid", "advice"]);
    expect(result.streamedComponents).toBe(2);

    // Every add must precede the reconcile patch that settles the surface.
    const addIndexes = events.flatMap((event, index) =>
      event.type === "component.add" ? [index] : [],
    );
    const complete = events.findIndex((event) => event.type === "surface.complete");
    expect(Math.max(...addIndexes)).toBeLessThan(complete);
  });

  it("replaying the events reproduces the surface the server holds", async () => {
    const { components, actions } = fixtures();
    const { events, result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: streamingModel(surfaceDocument([planGridNode, calloutNode])),
      }),
    );

    const reducer = new SurfaceStreamReducer();
    for (const event of events) reducer.apply(event);

    const replayed = reducer.current as Surface;
    expect(reducer.isComplete).toBe(true);
    expect(replayed.root.map((node) => node.id)).toEqual(
      result.surface.root.map((node) => node.id),
    );
    expect(replayed.title).toBe(result.surface.title);
    expect(replayed.kind).toBe(result.surface.kind);
    expect(replayed.state).toEqual(result.surface.state);
    expect(replayed.status).toBe("ready");
  });

  it("never lets an unregistered component reach the stream", async () => {
    const { components, actions } = fixtures();
    const { events, result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: streamingModel(
          surfaceDocument([
            planGridNode,
            { id: "evil", type: "ScriptRunner", props: { src: "http://x/y.js" } },
          ]),
        ),
      }),
    );

    const streamedTypes = events.flatMap((event) =>
      event.type === "component.add" ? [event.node.type] : [],
    );
    expect(streamedTypes).toEqual(["PlanGrid"]);
    expect(result.surface.root.map((node) => node.id)).toEqual(["grid"]);
  });

  it("keeps the components it already streamed when the document is cut off", async () => {
    const { components, actions } = fixtures();
    const text = JSON.stringify(surfaceDocument([planGridNode, calloutNode]));
    const truncated = text.slice(0, text.indexOf('"advice"'));

    const { events, result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: {
          name: "interrupted",
          generateSurface: async () => null,
          async *streamSurface() {
            yield truncated;
            throw new Error("connection reset");
          },
        },
      }),
    );

    expect(result.usedFallback).toBe(false);
    expect(result.surface.root.map((node) => node.id)).toEqual(["grid"]);
    expect(result.degradedReason).not.toBeNull();

    const failures = events.filter((event) => event.type === "surface.error");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ recoverable: true });

    // A recoverable failure must still leave a usable, complete surface.
    const reducer = new SurfaceStreamReducer();
    for (const event of events) reducer.apply(event);
    expect((reducer.current as Surface).status).toBe("ready");
  });

  it("salvages the valid components when the document fails schema validation", async () => {
    const { components, actions } = fixtures();
    const { result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: {
          name: "duplicate-ids",
          // A duplicate id fails the whole document: reconciliation addresses
          // nodes by id, so an ambiguous one cannot be allowed through. Models
          // do produce these, and losing every component over it would be a
          // much worse outcome than losing the duplicate.
          generateSurface: async () =>
            surfaceDocument([
              planGridNode,
              calloutNode,
              { ...calloutNode, props: { title: "Copy", body: "Duplicate id" } },
            ]),
        },
      }),
    );

    expect(result.usedFallback).toBe(false);
    expect(result.surface.root.map((node) => node.id)).toEqual(["grid", "advice"]);
    expect(
      result.issues.some((issue) => issue.message.includes("Dropped 1 component")),
    ).toBe(true);
  });

  it("drops a component whose props do not match its registered schema", async () => {
    const { components, actions } = fixtures();
    const { result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: {
          name: "bad-props",
          generateSurface: async () =>
            surfaceDocument([
              planGridNode,
              { id: "broken", type: "Callout", props: { title: 42, body: [] } },
            ]),
        },
      }),
    );
    expect(result.surface.root.map((node) => node.id)).toEqual(["grid"]);
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(true);
  });

  it("ignores a status the model was never entitled to set", async () => {
    const { components, actions } = fixtures();
    const { result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: {
          name: "bad-status",
          generateSurface: async () =>
            surfaceDocument([planGridNode], { status: "totally-made-up" }),
        },
      }),
    );
    expect(result.usedFallback).toBe(false);
    expect(result.surface.status).toBe("ready");
    expect(result.surface.root).toHaveLength(1);
  });

  it("falls back to a deterministic surface when nothing usable streamed", async () => {
    const { components, actions } = fixtures();
    const { result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: {
          name: "broken",
          generateSurface: async () => null,
          async *streamSurface() {
            yield "not json at all";
          },
        },
      }),
    );
    expect(result.usedFallback).toBe(true);
    expect(result.model).toBe("deterministic");
    expect(result.surface.root[0]?.type).toBe("PlanGrid");
  });

  it("streams from a model that has no token streaming at all", async () => {
    const { components, actions } = fixtures();
    const { events, result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: {
          name: "batch-only",
          generateSurface: async () => surfaceDocument([planGridNode, calloutNode]),
        },
      }),
    );
    expect(result.streamedComponents).toBe(0);
    expect(result.surface.root).toHaveLength(2);
    // The shell still arrives first, so the client lays out during generation.
    expect(events[0]?.type).toBe("surface.start");

    const reducer = new SurfaceStreamReducer();
    for (const event of events) reducer.apply(event);
    expect((reducer.current as Surface).root.map((node) => node.id)).toEqual([
      "grid",
      "advice",
    ]);
  });

  it("streams with no model configured at all", async () => {
    const { components, actions } = fixtures();
    const { events, result } = await collectStream(
      streamSurface(context, { components, actions }),
    );
    expect(result.usedFallback).toBe(true);
    const reducer = new SurfaceStreamReducer();
    for (const event of events) reducer.apply(event);
    expect((reducer.current as Surface).root.length).toBeGreaterThan(0);
  });

  it("shows a component whose data has not arrived as loading, then settles it", async () => {
    const { components, actions } = fixtures();
    // The host supplies no state, so the model authors it — the grid's binding
    // cannot resolve at the moment it streams in.
    const { events, result } = await collectStream(
      streamSurface(
        { intent: context.intent, state: {}, allowedActions: ["selectPlan"] },
        {
          components,
          actions,
          model: streamingModel(
            surfaceDocument([planGridNode], { state: { plans: [{ name: "Pro" }] } }),
          ),
        },
      ),
    );

    const added = events.find((event) => event.type === "component.add");
    expect(added).toMatchObject({ node: { phase: "loading" } });
    expect(result.surface.state["plans"]).toEqual([{ name: "Pro" }]);

    const reducer = new SurfaceStreamReducer();
    for (const event of events) reducer.apply(event);
    expect((reducer.current as Surface).root[0]?.phase).toBe("ready");
  });

  it("measures how long the user waited for layout and for content", async () => {
    const { components, actions } = fixtures();
    const { result } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: streamingModel(surfaceDocument([planGridNode, calloutNode])),
      }),
    );
    expect(result.timeToShellMs).toBeGreaterThanOrEqual(0);
    expect(result.timeToFirstComponentMs).not.toBeNull();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(result.timeToShellMs);
    expect(result.trace.map((entry) => entry.stage)).toContain("generate");
  });

  it("assigns gapless sequence numbers so a client can detect loss", async () => {
    const { components, actions } = fixtures();
    const { events } = await collectStream(
      streamSurface(context, {
        components,
        actions,
        model: streamingModel(surfaceDocument([planGridNode, calloutNode])),
      }),
    );
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_event, index) => index),
    );
  });
});

describe("SSE transport", () => {
  it("survives frames split across arbitrary chunk boundaries", () => {
    const events: SurfaceEvent[] = [
      { type: "surface.complete", surfaceId: "srf_1", seq: 0 },
      { type: "surface.status", surfaceId: "srf_1", status: "ready", seq: 1 },
    ];
    const wire = events.map(encodeSseEvent).join("");

    const decoder = new SseDecoder();
    const frames: string[] = [];
    for (let index = 0; index < wire.length; index += 5) {
      frames.push(...decoder.push(wire.slice(index, index + 5)));
    }
    expect(frames.map((frame) => JSON.parse(frame))).toEqual(events);
  });

  it("ignores heartbeat comments", () => {
    const decoder = new SseDecoder();
    expect(decoder.push(": heartbeat\n\n")).toEqual([]);
  });
});
