import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createActionRegistry, defineAction } from "@ovxa/registry";
import { parseSurface, SCHEMA_VERSION, type Surface } from "@ovxa/schema";
import { createSurfaceRuntime } from "./index";

const now = "2026-08-30T12:00:00.000Z";

function surface(): Surface {
  return parseSurface({
    schemaVersion: SCHEMA_VERSION,
    id: "srf_1",
    intent: "Choose a cabin",
    kind: "comparison",
    title: "Choose a cabin",
    layout: { columns: 2, density: "comfortable", maxWidth: "regular" },
    state: { cabin: null, seats: 1 },
    root: [
      {
        id: "cabins",
        type: "CabinPicker",
        props: { selected: { $bind: "cabin" } },
        actions: [
          {
            id: "selectCabin",
            label: "Select",
            input: { cabin: "business" },
            variant: "primary",
            risk: "low",
            optimistic: [{ path: "cabin", value: "business" }],
          },
        ],
      },
    ],
    actions: [
      {
        id: "purchase",
        label: "Buy",
        input: {},
        variant: "primary",
        risk: "high",
        confirm: { title: "Confirm", body: "This charges your card." },
      },
    ],
    status: "ready",
    createdAt: now,
    updatedAt: now,
  });
}

function registry(handler = vi.fn(() => ({ statePatch: { cabin: "business" } }))) {
  return {
    handler,
    actions: createActionRegistry()
      .register(
        defineAction({
          id: "selectCabin",
          description: "Choose a cabin class.",
          input: z.object({ cabin: z.string() }),
          handler,
        }),
      )
      .register(
        defineAction({
          id: "purchase",
          description: "Charge the card.",
          input: z.object({}),
          risk: "high",
          handler: () => ({ message: "Charged" }),
        }),
      ),
  };
}

describe("surface runtime", () => {
  it("resolves bindings into a render tree", () => {
    const runtime = createSurfaceRuntime(surface(), registry().actions);
    expect(runtime.snapshot.tree[0]?.props["selected"]).toBeNull();
    runtime.setState("cabin", "economy");
    expect(runtime.snapshot.tree[0]?.props["selected"]).toBe("economy");
  });

  it("routes a user interaction back through the registered handler", async () => {
    const { actions, handler } = registry();
    const runtime = createSurfaceRuntime(surface(), actions);
    const result = await runtime.interact({
      actionId: "selectCabin",
      componentId: "cabins",
      input: { cabin: "business" },
    });
    expect(result.status).toBe("applied");
    expect(handler).toHaveBeenCalledWith(
      { cabin: "business" },
      expect.objectContaining({ surfaceId: "srf_1", componentId: "cabins" }),
    );
    expect(runtime.snapshot.surface.state["cabin"]).toBe("business");
  });

  it("rolls the optimistic update back when the handler fails", async () => {
    const actions = createActionRegistry().register(
      defineAction({
        id: "selectCabin",
        description: "Choose a cabin class.",
        input: z.object({ cabin: z.string() }),
        handler: () => {
          throw new Error("seat map unavailable");
        },
      }),
    );
    const runtime = createSurfaceRuntime(surface(), actions);
    const result = await runtime.interact({
      actionId: "selectCabin",
      input: { cabin: "business" },
    });
    expect(result.status).toBe("rejected");
    expect(runtime.snapshot.surface.state["cabin"]).toBeNull();
  });

  it("pauses a confirming action until the user commits", async () => {
    const { actions } = registry();
    const runtime = createSurfaceRuntime(surface(), actions);
    const first = await runtime.interact({ actionId: "purchase", input: {} });
    expect(first.status).toBe("needs-confirmation");
    expect(runtime.snapshot.surface.actions[0]?.status).toBe("confirming");

    const second = await runtime.interact({
      actionId: "purchase",
      input: {},
      confirmed: true,
    });
    expect(second.status).toBe("applied");
    expect(runtime.snapshot.surface.actions[0]?.status).toBe("complete");
  });

  it("refuses an action that is not on the surface", async () => {
    const { actions } = registry();
    const runtime = createSurfaceRuntime(surface(), actions);
    const result = await runtime.interact({ actionId: "dropTables", input: {} });
    expect(result.status).toBe("rejected");
  });

  it("asks for a recompile only when the handler requests one", async () => {
    const actions = createActionRegistry().register(
      defineAction({
        id: "selectCabin",
        description: "Choose a cabin class.",
        input: z.object({ cabin: z.string() }),
        handler: () => ({ recompile: { intent: "Now pick seats" } }),
      }),
    );
    const runtime = createSurfaceRuntime(surface(), actions);
    const result = await runtime.interact({
      actionId: "selectCabin",
      input: { cabin: "business" },
    });
    expect(result).toEqual({ status: "recompile", intent: "Now pick seats" });
  });

  it("knows which state changes can skip the model", () => {
    const runtime = createSurfaceRuntime(surface(), registry().actions);
    expect(runtime.canRenderLocally("cabin")).toBe(true);
    expect(runtime.canRenderLocally("unrelated.thing")).toBe(false);
  });

  it("notifies subscribers on every change", () => {
    const runtime = createSurfaceRuntime(surface(), registry().actions);
    const seen: number[] = [];
    runtime.subscribe((snapshot) => seen.push(snapshot.tree.length));
    runtime.setState("cabin", "first");
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves local state through replacement and publishes focus requests", () => {
    const runtime = createSurfaceRuntime(surface(), registry().actions);
    runtime.setState("cabin", "economy");
    const snapshot = runtime.patch([
      {
        op: "component.replace",
        id: "cabins",
        node: {
          id: "comparison",
          type: "CabinComparison",
          props: { selected: { $bind: "cabin" } },
        },
      },
      { op: "component.focus", id: "comparison" },
    ]);

    expect(snapshot.surface.state["cabin"]).toBe("economy");
    expect(snapshot.tree[0]).toMatchObject({
      id: "comparison",
      props: { selected: "economy" },
    });
    expect(snapshot.focusRequest).toEqual({
      componentId: "comparison",
      sequence: 1,
    });
  });

  it("emits protocol events for the action lifecycle", async () => {
    const { actions } = registry();
    const runtime = createSurfaceRuntime(surface(), actions);
    const types: string[] = [];
    runtime.onEvent((event) => types.push(event.type));
    await runtime.interact({ actionId: "selectCabin", input: { cabin: "business" } });
    expect(types).toEqual(["action.start", "action.complete"]);
  });
});
