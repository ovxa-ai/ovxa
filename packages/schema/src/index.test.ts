import { describe, expect, it } from "vitest";
import {
  applySurfacePatch,
  collectBoundPaths,
  evaluateCondition,
  parseSurface,
  readPath,
  resolveSurface,
  safeParseSurface,
  SCHEMA_VERSION,
  type Surface,
} from "./index";

const now = "2026-08-30T12:00:00.000Z";

function baseSurface(overrides: Partial<Surface> = {}): Surface {
  return parseSurface({
    schemaVersion: SCHEMA_VERSION,
    id: "srf_1",
    intent: "Compare enterprise plans",
    kind: "comparison",
    title: "Choose your plan",
    layout: { columns: 3, density: "comfortable", maxWidth: "wide" },
    state: {
      billing: "monthly",
      plans: [{ name: "Pro" }, { name: "Scale" }],
      selected: null,
    },
    root: [
      {
        id: "grid",
        type: "PlanGrid",
        props: { plans: { $bind: "plans" }, period: { $bind: "billing" } },
        children: [
          {
            id: "recommendation",
            type: "Callout",
            props: { text: "Scale fits your usage" },
            visibleWhen: { op: "notEmpty", path: "plans" },
          },
        ],
      },
    ],
    actions: [
      {
        id: "selectPlan",
        label: "Choose plan",
        input: { plan: { $bind: "selected" } },
        variant: "primary",
        risk: "low",
      },
    ],
    status: "ready",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe("surface schema", () => {
  it("parses a valid surface and applies defaults", () => {
    const surface = baseSurface();
    expect(surface.kind).toBe("comparison");
    expect(surface.actions[0]?.status).toBe("idle");
    expect(surface.root[0]?.props["period"]).toEqual({ $bind: "billing" });
  });

  it("rejects duplicate component ids", () => {
    const result = safeParseSurface({
      ...baseSurface(),
      root: [
        { id: "dupe", type: "Card", props: {} },
        { id: "dupe", type: "Card", props: {} },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("Duplicate component ids");
    }
  });

  it("rejects unknown keys rather than silently dropping them", () => {
    const result = safeParseSurface({
      ...baseSurface(),
      root: [{ id: "x", type: "Card", props: {}, onClick: "alert(1)" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a binding that is not a state path", () => {
    const result = safeParseSurface({
      ...baseSurface(),
      root: [{ id: "x", type: "Card", props: { a: { $bind: "../../etc/passwd" } } }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("bindings and conditions", () => {
  it("reads nested and indexed paths", () => {
    const state = { trip: { flights: [{ code: "BA117" }] } };
    expect(readPath(state, "trip.flights[0].code")).toBe("BA117");
    expect(readPath(state, "trip.missing.deep")).toBeUndefined();
  });

  it("resolves bindings into props and prunes hidden nodes", () => {
    const surface = baseSurface();
    const resolved = resolveSurface(surface);
    expect(resolved[0]?.props["period"]).toBe("monthly");
    expect(resolved[0]?.children).toHaveLength(1);

    const emptied = applySurfacePatch(surface, {
      surfaceId: "srf_1",
      operations: [{ op: "state.patch", path: "plans", value: [] }],
    }).surface;
    expect(resolveSurface(emptied)[0]?.children).toHaveLength(0);
  });

  it("falls back when a binding resolves to nothing", () => {
    const surface = parseSurface({
      ...baseSurface(),
      root: [
        {
          id: "x",
          type: "Card",
          props: { label: { $bind: "missing.value", fallback: "—" } },
        },
      ],
    });
    expect(resolveSurface(surface)[0]?.props["label"]).toBe("—");
  });

  it("evaluates composite conditions", () => {
    const state = { count: 5, name: "acme" };
    expect(
      evaluateCondition(
        {
          op: "and",
          clauses: [
            { op: "gte", path: "count", value: 3 },
            { op: "contains", path: "name", value: "acm" },
          ],
        },
        state,
      ),
    ).toBe(true);
    expect(
      evaluateCondition({ op: "not", clause: { op: "truthy", path: "name" } }, state),
    ).toBe(false);
  });

  it("collects every bound path for change detection", () => {
    expect(collectBoundPaths(baseSurface())).toEqual([
      "billing",
      "plans",
      "selected",
    ]);
  });
});

describe("patching", () => {
  it("preserves untouched props when patching a component", () => {
    const surface = baseSurface();
    const { surface: next, applied } = applySurfacePatch(surface, {
      surfaceId: "srf_1",
      operations: [
        { op: "component.patch", id: "grid", props: { period: "annual" } },
      ],
    });
    expect(applied).toBe(1);
    expect(next.root[0]?.props["period"]).toBe("annual");
    expect(next.root[0]?.props["plans"]).toEqual({ $bind: "plans" });
  });

  it("adds and removes nodes without disturbing siblings", () => {
    const surface = baseSurface();
    const added = applySurfacePatch(surface, {
      surfaceId: "srf_1",
      operations: [
        {
          op: "component.add",
          parentId: "grid",
          index: 0,
          node: { id: "toggle", type: "BillingToggle", props: {} },
        },
      ],
    }).surface;
    expect(added.root[0]?.children?.map((child) => child.id)).toEqual([
      "toggle",
      "recommendation",
    ]);

    const removed = applySurfacePatch(added, {
      surfaceId: "srf_1",
      operations: [{ op: "component.remove", id: "toggle" }],
    }).surface;
    expect(removed.root[0]?.children?.map((child) => child.id)).toEqual([
      "recommendation",
    ]);
  });

  it("rejects a bad operation without discarding the rest of the patch", () => {
    const surface = baseSurface();
    const result = applySurfacePatch(surface, {
      surfaceId: "srf_1",
      operations: [
        { op: "component.patch", id: "ghost", props: { a: 1 } },
        { op: "surface.patch", title: "Updated" },
      ],
    });
    expect(result.applied).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.surface.title).toBe("Updated");
  });

  it("refuses a duplicate id on add", () => {
    const result = applySurfacePatch(baseSurface(), {
      surfaceId: "srf_1",
      operations: [
        {
          op: "component.add",
          parentId: null,
          node: { id: "grid", type: "Card", props: {} },
        },
      ],
    });
    expect(result.applied).toBe(0);
    expect(result.rejected[0]?.reason).toContain("already exists");
  });

  it("refuses to move a node inside its own subtree", () => {
    const result = applySurfacePatch(baseSurface(), {
      surfaceId: "srf_1",
      operations: [
        { op: "component.move", id: "grid", parentId: "recommendation", index: 0 },
      ],
    });
    expect(result.applied).toBe(0);
    expect(result.rejected[0]?.reason).toContain("own subtree");
    expect(result.surface.root.map((node) => node.id)).toEqual(["grid"]);
  });

  it("rejects a patch aimed at a different surface", () => {
    const result = applySurfacePatch(baseSurface(), {
      surfaceId: "srf_other",
      operations: [{ op: "surface.patch", title: "Nope" }],
    });
    expect(result.applied).toBe(0);
    expect(result.surface.title).toBe("Choose your plan");
  });

  it("updates action status wherever the action lives", () => {
    const result = applySurfacePatch(baseSurface(), {
      surfaceId: "srf_1",
      operations: [
        { op: "action.status", actionId: "selectPlan", status: "running" },
      ],
    });
    expect(result.surface.actions[0]?.status).toBe("running");
  });

  it("replaces one subtree while preserving surface state", () => {
    const result = applySurfacePatch(baseSurface(), {
      surfaceId: "srf_1",
      operations: [
        {
          op: "component.replace",
          id: "grid",
          node: {
            id: "comparison",
            type: "Comparison",
            props: { selected: { $bind: "selected" } },
          },
        },
      ],
    });

    expect(result.applied).toBe(1);
    expect(result.surface.root.map((node) => node.id)).toEqual(["comparison"]);
    expect(result.surface.state).toEqual(baseSurface().state);
  });

  it("emits a focus effect only for an existing component", () => {
    const result = applySurfacePatch(baseSurface(), {
      surfaceId: "srf_1",
      operations: [
        { op: "component.focus", id: "recommendation" },
        { op: "component.focus", id: "missing" },
      ],
    });

    expect(result.applied).toBe(1);
    expect(result.effects).toEqual([
      { type: "focus", componentId: "recommendation" },
    ]);
    expect(result.rejected[0]?.reason).toContain("was not found");
  });

  it("writes nested state paths", () => {
    const result = applySurfacePatch(baseSurface(), {
      surfaceId: "srf_1",
      operations: [
        { op: "state.patch", path: "filters.minSeats", value: 25 },
      ],
    });
    expect(readPath(result.surface.state, "filters.minSeats")).toBe(25);
  });
});
