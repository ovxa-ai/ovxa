import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createActionRegistry,
  createRegistry,
  defineAction,
  defineComponent,
} from "@ovxa/registry";
import { SCHEMA_VERSION } from "@ovxa/schema";
import { learnApp } from "@ovxa/intelligence";
import { compileSurface, type SurfaceModel } from "./index";

const planGrid = defineComponent({
  name: "PlanGrid",
  description: "Side-by-side plans.",
  intents: ["compare", "select"],
  surfaces: ["comparison"],
  props: z.object({ plans: z.array(z.unknown()) }),
  actions: ["selectPlan"],
});

const kpi = defineComponent({
  name: "KpiRow",
  description: "Headline numbers.",
  intents: ["summarize", "monitor"],
  surfaces: ["dashboard"],
  props: z.object({ metrics: z.array(z.unknown()) }),
});

function fixtures() {
  const components = createRegistry().register(planGrid).register(kpi);
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

/**
 * A registry broad enough that several candidate surface kinds survive the
 * catalogue veto, so top-K compilation has something to compare.
 */
function wideFixtures() {
  const { components, actions } = fixtures();
  components
    .register(
      defineComponent({
        name: "OptionList",
        description: "A scannable list of options.",
        intents: ["enumerate", "select"],
        surfaces: ["list"],
        props: z.object({ plans: z.array(z.unknown()) }),
      }),
    )
    .register(
      defineComponent({
        name: "PlanForm",
        description: "Collects a choice.",
        intents: ["collect-input", "confirm"],
        surfaces: ["form"],
        props: z.object({ plans: z.array(z.unknown()) }),
      }),
    );
  return { components, actions };
}

const context = {
  intent: "Compare these three enterprise plans and let me choose one",
  state: { plans: [{ name: "Pro" }, { name: "Scale" }] },
  allowedActions: ["selectPlan"],
};

function modelReturning(value: unknown): SurfaceModel {
  return {
    name: "test-model",
    generateSurface: vi.fn(async () => value),
  };
}

function validSurface(root: unknown[]) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "comparison",
    title: "Choose your plan",
    layout: { columns: 3, density: "comfortable", maxWidth: "wide" },
    root,
    actions: [],
    status: "ready",
  };
}

describe("compileSurface", () => {
  it("compiles a valid model surface and keeps its components", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(context, {
      components,
      actions,
      model: modelReturning(
        validSurface([
          { id: "grid", type: "PlanGrid", props: { plans: { $bind: "plans" } } },
        ]),
      ),
    });
    expect(result.usedFallback).toBe(false);
    expect(result.surface.root.map((node) => node.type)).toEqual(["PlanGrid"]);
    expect(result.model).toBe("test-model");
  });

  it("overrides model-supplied identity and intent", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(context, {
      components,
      actions,
      newId: () => "srf_fixed",
      model: modelReturning({
        ...validSurface([
          { id: "grid", type: "PlanGrid", props: { plans: { $bind: "plans" } } },
        ]),
        id: "srf_attacker_controlled",
        intent: "something else entirely",
      }),
    });
    expect(result.surface.id).toBe("srf_fixed");
    expect(result.surface.intent).toBe(context.intent);
  });

  it("strips an unregistered component the model invented", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(context, {
      components,
      actions,
      model: modelReturning(
        validSurface([
          { id: "grid", type: "PlanGrid", props: { plans: { $bind: "plans" } } },
          { id: "evil", type: "ScriptRunner", props: { src: "http://x/y.js" } },
        ]),
      ),
    });
    expect(result.surface.root.map((node) => node.id)).toEqual(["grid"]);
    expect(result.issues.some((issue) => issue.message.includes("not registered"))).toBe(
      true,
    );
  });

  it("strips an action the host did not permit", async () => {
    const { components, actions } = fixtures();
    actions.register(
      defineAction({
        id: "deleteWorkspace",
        description: "Dangerous.",
        input: z.object({}),
        risk: "high",
        handler: () => ({}),
      }),
    );
    const result = await compileSurface(context, {
      components,
      actions,
      model: modelReturning({
        ...validSurface([
          { id: "grid", type: "PlanGrid", props: { plans: { $bind: "plans" } } },
        ]),
        actions: [
          {
            id: "deleteWorkspace",
            label: "Delete",
            input: {},
            variant: "destructive",
            risk: "high",
          },
        ],
      }),
    });
    expect(result.surface.actions).toHaveLength(0);
    expect(
      result.issues.some((issue) => issue.message.includes("not permitted")),
    ).toBe(true);
  });

  it("falls back to a working surface when the model returns nonsense", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(context, {
      components,
      actions,
      model: modelReturning({ nope: true }),
    });
    expect(result.usedFallback).toBe(true);
    expect(result.surface.root).toHaveLength(1);
    expect(result.surface.root[0]?.type).toBe("PlanGrid");
    expect(result.surface.root[0]?.props["plans"]).toEqual({ $bind: "plans" });
  });

  it("falls back when the model throws", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(context, {
      components,
      actions,
      model: {
        name: "flaky",
        generateSurface: async () => {
          throw new Error("provider 503");
        },
      },
    });
    expect(result.usedFallback).toBe(true);
    expect(result.surface.status).toBe("ready");
  });

  /**
   * The case behind the worst-looking failure mode: no model output and no host
   * data. Rendering the best-matching component anyway produced a card that said
   * "no data available", which reads as a broken product rather than an answer.
   */
  it("returns an explicitly empty surface when nothing can bind", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(
      { intent: "airplanes", state: {}, allowedActions: [] },
      { components, actions },
    );

    expect(result.usedFallback).toBe(true);
    expect(result.surface.kind).toBe("empty");
    expect(result.surface.root).toHaveLength(0);
    // The reason has to be actionable, not an apology.
    expect(result.surface.description).toContain("no data behind this request");
  });

  it("explains an empty surface differently when no component could ever fit", async () => {
    const result = await compileSurface(
      { intent: "airplanes", state: { plans: [] }, allowedActions: [] },
      { components: createRegistry(), actions: createActionRegistry() },
    );
    expect(result.surface.kind).toBe("empty");
    expect(result.surface.description).toContain("No registered component");
  });

  it("compiles without any model at all", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(context, { components, actions });
    expect(result.model).toBe("deterministic");
    expect(result.surface.root[0]?.type).toBe("PlanGrid");
  });

  it("chooses a dashboard component for an analysis intent", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(
      {
        intent: "Show me why revenue dropped this month",
        state: { metrics: [{ label: "MRR" }] },
        allowedActions: [],
      },
      { components, actions },
    );
    expect(result.plan.surface).toBe("dashboard");
    expect(result.surface.root[0]?.type).toBe("KpiRow");
  });

  it("records a trace for every stage it ran", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(context, {
      components,
      actions,
      model: modelReturning(
        validSurface([
          { id: "grid", type: "PlanGrid", props: { plans: { $bind: "plans" } } },
        ]),
      ),
    });
    expect(result.trace.map((entry) => entry.stage)).toEqual([
      "understand",
      "propose",
      "evaluate",
      "select",
      "catalog",
      "generate",
      "validate",
      "ground",
    ]);
    expect(result.intelligence.selectedId.length).toBeGreaterThan(0);
    expect(result.intelligence.ranked.length).toBeGreaterThan(1);
  });

  it("selects a comparison plan for a choose-the-right-plan intent", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(
      {
        intent: "Help me choose the right health insurance plan for my family",
        state: { plans: [{ name: "Essential" }] },
        allowedActions: ["selectPlan"],
      },
      { components, actions },
    );
    expect(result.plan.surface).toBe("comparison");
    expect(result.intelligence.understanding.taskKind).toBe("choose");
    const winner = result.intelligence.ranked[0];
    expect(winner?.candidate.plan.surface).toBe("comparison");
    expect(winner?.evaluation.vetoed).toBe(false);
  });

  it("compiles several candidates and keeps the one that did not fall back", async () => {
    const { components, actions } = wideFixtures();
    const result = await compileSurface(context, {
      components,
      actions,
      // Only produces a surface for a comparison plan; every other candidate
      // is forced down the fallback path.
      model: {
        name: "picky",
        generateSurface: async (_context, plan) =>
          plan.surface === "comparison"
            ? validSurface([
                { id: "grid", type: "PlanGrid", props: { plans: { $bind: "plans" } } },
              ])
            : null,
      },
      intelligence: { compileTopK: 3 },
    });
    expect(result.attempts.length).toBeGreaterThan(1);
    expect(result.usedFallback).toBe(false);
    expect(result.surface.kind).toBe("comparison");
    expect(result.attempts[0]?.usedFallback).toBe(false);
    expect(result.attempts.some((attempt) => attempt.usedFallback)).toBe(true);
  });

  it("gives every compiled attempt a distinct surface id", async () => {
    const { components, actions } = wideFixtures();
    const result = await compileSurface(context, {
      components,
      actions,
      newId: () => "srf_fixed",
      intelligence: { compileTopK: 3 },
    });
    const ids = result.attempts.map((attempt) => attempt.surface.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("compiles exactly one candidate by default", async () => {
    const { components, actions } = fixtures();
    const result = await compileSurface(context, { components, actions });
    expect(result.attempts).toHaveLength(1);
  });

  it("never returns a surface that fails schema validation", async () => {
    const { components, actions } = fixtures();
    for (const bad of [null, "text", 42, [], { root: "no" }]) {
      const result = await compileSurface(context, {
        components,
        actions,
        model: modelReturning(bad),
      });
      expect(result.surface.schemaVersion).toBe(SCHEMA_VERSION);
      expect(result.surface.status).toBe("ready");
    }
  });

  it("carries learned app style onto the compiled surface", async () => {
    const { components, actions } = fixtures();
    const app = learnApp({
      intent: context.intent,
      visual: {
        ...learnApp({ intent: context.intent }).visual,
        density: "compact",
      },
    });
    const result = await compileSurface(
      { ...context, app },
      { components, actions },
    );
    expect(result.intelligence.understanding.app?.visual.density).toBe("compact");
    expect(result.surface.layout.density).toBe("compact");
  });

  it("does not impose OVXA density when the host visual was not captured", async () => {
    const { components, actions } = fixtures();
    const app = learnApp({ intent: context.intent });
    const result = await compileSurface(
      { ...context, app },
      { components, actions },
    );
    expect(app.visualSource).toBe("fallback");
    expect(result.surface.layout.density).not.toBe("compact");
  });
});
