import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildCatalog,
  createActionRegistry,
  createRegistry,
  defineAction,
  defineComponent,
} from "./index";

const planGrid = defineComponent({
  name: "PlanGrid",
  description: "Side-by-side pricing plans with a feature matrix.",
  intents: ["compare", "select"],
  surfaces: ["comparison"],
  props: z.object({
    plans: z.array(z.object({ name: z.string() })),
    period: z.enum(["monthly", "annual"]).optional(),
  }),
  actions: ["selectPlan"],
  states: { loading: true, empty: true, error: true },
  a11y: { keyboardOperable: true },
  capacity: { maxChildren: 4 },
});

const chart = defineComponent({
  name: "TrendChart",
  description: "A time series for a single metric.",
  intents: ["visualize", "monitor"],
  surfaces: ["dashboard"],
  props: z.object({ series: z.array(z.number()) }),
  a11y: { requiresLabel: true },
});

function registry() {
  return createRegistry().register(planGrid).register(chart);
}

describe("component registry", () => {
  it("refuses duplicate registration", () => {
    expect(() => registry().register(planGrid)).toThrow(/already registered/);
  });

  it("ranks candidates by surface and intent, excluding incompatible ones", () => {
    const candidates = registry().candidatesFor({
      surface: "comparison",
      intents: ["compare"],
    });
    expect(candidates.map((candidate) => candidate.definition.name)).toEqual([
      "PlanGrid",
    ]);
    expect(candidates[0]?.reasons.join(" ")).toContain("matches intent compare");
  });

  it("rejects an unregistered component type", () => {
    const result = registry().validateNode({
      id: "a",
      type: "TotallyMadeUp",
      props: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toContain("not registered");
  });

  it("reports a missing required prop", () => {
    const result = registry().validateNode({ id: "a", type: "PlanGrid", props: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toContain("plans");
    }
  });

  it("accepts a required prop supplied as a binding", () => {
    const result = registry().validateNode({
      id: "a",
      type: "PlanGrid",
      props: { plans: { $bind: "catalog.plans" } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a literal prop of the wrong type", () => {
    const result = registry().validateNode({
      id: "a",
      type: "PlanGrid",
      props: { plans: "everything", period: "weekly" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an action the component does not expose", () => {
    const result = registry().validateNode({
      id: "a",
      type: "PlanGrid",
      props: { plans: [] },
      actions: [
        {
          id: "deleteAccount",
          label: "Delete",
          input: {},
          variant: "destructive",
          risk: "high",
          status: "idle",
          optimistic: [],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain("does not expose action");
    }
  });

  it("requires a label for components that are not self-describing", () => {
    const result = registry().validateNode({
      id: "c",
      type: "TrendChart",
      props: { series: [1, 2] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("a11y.label");
  });

  it("rejects more children than the component accepts", () => {
    const result = registry().validateNode({
      id: "a",
      type: "TrendChart",
      props: { series: [] },
      a11y: { label: "Revenue" },
      children: [{ id: "x", type: "TrendChart", props: { series: [] } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain("at most 0 children");
    }
  });
});

describe("action registry", () => {
  const selectPlan = defineAction({
    id: "selectPlan",
    description: "Choose a subscription plan.",
    input: z.object({ plan: z.string() }),
    handler: (input) => ({ statePatch: { selected: input.plan } }),
  });

  it("defaults high-risk actions to requiring confirmation", () => {
    const wipe = defineAction({
      id: "wipe",
      description: "Delete everything.",
      input: z.object({}),
      risk: "high",
      handler: () => ({}),
    });
    expect(wipe.confirm).toBe(true);
  });

  it("dispatches a valid invocation", async () => {
    const actions = createActionRegistry().register(selectPlan);
    const result = await actions.dispatch(
      {
        surfaceId: "s1",
        actionId: "selectPlan",
        input: { plan: "Scale" },
        source: "generated-ui",
        at: new Date().toISOString(),
      },
      { surfaceId: "s1", componentId: undefined, state: {} },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome.statePatch).toEqual({ selected: "Scale" });
  });

  it("refuses an unregistered action", async () => {
    const actions = createActionRegistry();
    const result = await actions.dispatch(
      {
        surfaceId: "s1",
        actionId: "rm -rf",
        input: {},
        source: "generated-ui",
        at: new Date().toISOString(),
      },
      { surfaceId: "s1", componentId: undefined, state: {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not registered");
  });

  it("refuses malformed input before the handler runs", async () => {
    const handler = vi.fn(() => ({}));
    const actions = createActionRegistry().register(
      defineAction({
        id: "typed",
        description: "Needs a number.",
        input: z.object({ amount: z.number() }),
        handler,
      }),
    );
    const result = await actions.dispatch(
      {
        surfaceId: "s1",
        actionId: "typed",
        input: { amount: "not a number" },
        source: "generated-ui",
        at: new Date().toISOString(),
      },
      { surfaceId: "s1", componentId: undefined, state: {} },
    );
    expect(result.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not leak handler internals to the caller", async () => {
    const actions = createActionRegistry().register(
      defineAction({
        id: "boom",
        description: "Throws.",
        input: z.object({}),
        handler: () => {
          throw new Error("postgres://user:pw@10.0.0.1/db timed out");
        },
      }),
    );
    const result = await actions.dispatch(
      {
        surfaceId: "s1",
        actionId: "boom",
        input: {},
        source: "generated-ui",
        at: new Date().toISOString(),
      },
      { surfaceId: "s1", componentId: undefined, state: {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("postgres");
      expect(result.reason).toBe('Action "boom" failed');
    }
  });
});

describe("catalog", () => {
  it("describes only surface-compatible components with their prop types", () => {
    const catalog = buildCatalog(registry(), createActionRegistry(), {
      surface: "comparison",
    });
    expect(catalog.components.map((entry) => entry.name)).toEqual(["PlanGrid"]);
    expect(catalog.components[0]?.requiredProps).toEqual(["plans"]);
    expect(catalog.components[0]?.props["period"]).toContain("enum");
  });
});
