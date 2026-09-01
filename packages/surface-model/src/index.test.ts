import { describe, expect, it, vi } from "vitest";
import { compileSurface } from "@ovxa/compiler";
import type { LlmAdapter, LlmRequest, LlmResponse } from "@ovxa/llm";
import { createSurfaceActions, createSurfaceRegistry } from "@ovxa/surface-kit";
import {
  createLlmSurfaceModel,
  normalizeSurfaceDraft,
  type SurfaceModelAttempt,
} from "./index";

/**
 * The adapter is stubbed at the provider HTTP boundary and nowhere else. Every
 * assertion below runs the real compiler, the real registry and the real
 * schema, so a change that weakens validation fails here.
 */
function stubAdapter(responses: unknown[]): LlmAdapter & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let index = 0;
  return {
    provider: "openai",
    calls,
    async complete<T>(request: LlmRequest): Promise<LlmResponse<T>> {
      calls.push(request);
      const output = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (output instanceof Error) throw output;
      return {
        provider: "openai",
        model: "test-model",
        output: output as T,
        usage: { inputTokens: 100, outputTokens: 200 },
      };
    },
  };
}

const validSurface = {
  kind: "comparison",
  title: "Health plans for a family of four",
  description: "Compare three plans on cost and coverage, then choose one.",
  layout: { columns: 2, density: "comfortable", maxWidth: "wide" },
  state: {
    selectedId: null,
    headline: [
      { label: "Household", value: "4 people" },
      { label: "Annual budget", value: "$9,600" },
    ],
    plans: [
      {
        id: "essential",
        title: "Essential",
        price: "$412",
        cadence: "/mo",
        features: ["$6,000 deductible", "Narrow network"],
      },
      {
        id: "balanced",
        title: "Balanced",
        price: "$598",
        cadence: "/mo",
        badge: "Best fit",
        recommended: true,
        features: ["$2,500 deductible", "Broad network"],
      },
    ],
  },
  root: [
    {
      id: "headline",
      type: "MetricRow",
      props: { metrics: { $bind: "headline" } },
    },
    {
      id: "plans",
      type: "OptionGrid",
      props: { options: { $bind: "plans" }, selectedId: { $bind: "selectedId" } },
      actions: [{ id: "selectOption", label: "Choose this plan", variant: "primary" }],
    },
  ],
  actions: [],
};

const compile = (model: ReturnType<typeof createLlmSurfaceModel>, intent: string) =>
  compileSurface(
    { intent, state: {}, allowedActions: createSurfaceActions().ids() },
    {
      components: createSurfaceRegistry(),
      actions: createSurfaceActions(),
      model,
    },
  );

describe("llm surface model", () => {
  it("compiles a model-authored surface without falling back", async () => {
    const adapter = stubAdapter([validSurface]);
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
    });

    const result = await compile(model, "Help me choose a health plan for my family");

    expect(result.usedFallback).toBe(false);
    expect(result.model).toBe("test-model");
    expect(result.surface.kind).toBe("comparison");
    expect(result.surface.root.map((node) => node.type)).toEqual([
      "MetricRow",
      "OptionGrid",
    ]);
    expect(result.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("keeps the data the model authored so the surface renders something", async () => {
    const adapter = stubAdapter([validSurface]);
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
    });

    const result = await compile(model, "Help me choose a health plan for my family");

    // The regression this guards: state used to be overwritten with the
    // caller's (empty) state, so every generated surface rendered blank.
    expect(result.surface.state["plans"]).toHaveLength(2);
    expect(result.surface.state["selectedId"]).toBeNull();
  });

  it("lets host state win over anything the model invents for the same key", async () => {
    const adapter = stubAdapter([validSurface]);
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
    });

    const result = await compileSurface(
      {
        intent: "Help me choose a health plan for my family",
        state: { plans: [{ id: "real", title: "From the host" }] },
        allowedActions: createSurfaceActions().ids(),
      },
      {
        components: createSurfaceRegistry(),
        actions: createSurfaceActions(),
        model,
      },
    );

    expect(result.surface.state["plans"]).toEqual([
      { id: "real", title: "From the host" },
    ]);
    expect(result.surface.state["headline"]).toHaveLength(2);
  });

  it("strips components and actions that are not registered", async () => {
    const adapter = stubAdapter([
      {
        ...validSurface,
        root: [
          ...validSurface.root,
          { id: "rogue", type: "PaymentForm", props: { amount: 100 } },
          {
            id: "escalate",
            type: "Callout",
            props: { title: "Heads up", body: "Deadline is Friday." },
            actions: [{ id: "wireTransfer", label: "Send money" }],
          },
        ],
      },
    ]);
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
    });

    const result = await compile(model, "Help me choose a health plan for my family");
    const types = result.surface.root.map((node) => node.type);

    expect(types).not.toContain("PaymentForm");
    expect(types).toContain("Callout");
    const callout = result.surface.root.find((node) => node.id === "escalate");
    expect(callout?.actions ?? []).toHaveLength(0);
    expect(result.issues.some((issue) => issue.message.includes("PaymentForm"))).toBe(
      true,
    );
  });

  it("re-prompts once with the validation errors and accepts the repair", async () => {
    const broken = {
      ...validSurface,
      root: [{ id: "plans", type: "OptionGrid", props: { options: { $bind: "1bad path" } } }],
    };
    const adapter = stubAdapter([broken, validSurface]);
    const attempts: SurfaceModelAttempt[] = [];
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
      onAttempt: (attempt) => attempts.push(attempt),
    });

    const result = await compile(model, "Help me choose a health plan for my family");

    expect(adapter.calls).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["invalid", "ok"]);
    const repairPrompt = adapter.calls[1]?.messages.at(-1)?.content ?? "";
    expect(repairPrompt).toContain("did not pass validation");
    expect(repairPrompt).toContain("props.options");
    expect(result.usedFallback).toBe(false);
  });

  it("re-prompts for a control that renders but cannot be operated", async () => {
    const inert = {
      ...validSurface,
      root: [
        {
          id: "plans",
          type: "OptionGrid",
          props: { options: { $bind: "plans" }, selectedId: { $bind: "selectedId" } },
        },
      ],
    };
    const adapter = stubAdapter([inert, validSurface]);
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
    });

    const result = await compile(model, "Help me choose a health plan for my family");

    // Schema-valid but useless: the cards are clickable and nothing happens.
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1]?.messages.at(-1)?.content ?? "").toContain(
      "is a control with no actions",
    );
    const grid = result.surface.root.find((node) => node.type === "OptionGrid");
    expect(grid?.actions?.map((action) => action.id)).toEqual(["selectOption"]);
  });

  it("does not demand actions from a presentational component", async () => {
    const adapter = stubAdapter([
      {
        ...validSurface,
        kind: "dashboard",
        root: [
          { id: "headline", type: "MetricRow", props: { metrics: { $bind: "headline" } } },
        ],
      },
    ]);
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
    });

    await compile(model, "Show me this month's numbers");

    // MetricRow emits nothing, so it is complete without an action.
    expect(adapter.calls).toHaveLength(1);
  });

  it("falls back to the deterministic surface when the provider fails", async () => {
    const adapter = stubAdapter([new Error("429 rate limited")]);
    const attempts: SurfaceModelAttempt[] = [];
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
      onAttempt: (attempt) => attempts.push(attempt),
    });

    const result = await compile(model, "Help me choose a health plan for my family");

    expect(result.usedFallback).toBe(true);
    expect(result.model).toBe("deterministic");
    expect(attempts[0]).toMatchObject({ outcome: "failed" });
    expect(attempts[0]?.reason).toContain("429");
  });

  it("puts the component catalogue in the prompt so the model can only pick real ones", async () => {
    const adapter = stubAdapter([validSurface]);
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      proposePlan: false,
    });

    await compile(model, "Help me choose a health plan for my family");
    const prompt = adapter.calls[0]?.messages[0]?.content ?? "";

    expect(prompt).toContain("OptionGrid");
    expect(prompt).toContain("selectOption");
    expect(prompt).toContain("USER INTENT: Help me choose a health plan");
  });

  it("offers the model plan as one more ranked candidate", async () => {
    const plan = {
      surface: "comparison",
      title: "Plan comparison",
      rationale: "The user must weigh three plans before committing to one.",
      objectives: ["Compare cost", "Choose a plan"],
      componentIntents: ["compare", "select"],
      actions: ["selectOption"],
    };
    const adapter = stubAdapter([plan, validSurface]);
    const attempts: SurfaceModelAttempt[] = [];
    const model = createLlmSurfaceModel({
      adapter,
      model: "test-model",
      onAttempt: (attempt) => attempts.push(attempt),
    });

    const result = await compile(model, "Help me choose a health plan for my family");

    expect(attempts[0]?.stage).toBe("plan");
    expect(
      result.intelligence.ranked.some((entry) => entry.candidate.source === "model"),
    ).toBe(true);
  });

  it("survives a plan call that fails, because the engine proposed its own", async () => {
    const adapter = stubAdapter([new Error("timeout"), validSurface]);
    const model = createLlmSurfaceModel({ adapter, model: "test-model" });

    const result = await compile(model, "Help me choose a health plan for my family");

    expect(result.intelligence.ranked.length).toBeGreaterThan(1);
    expect(result.usedFallback).toBe(false);
  });
});

describe("normalizeSurfaceDraft", () => {
  it("unwraps the envelope models add out of habit", () => {
    const draft = normalizeSurfaceDraft({ surface: validSurface });
    expect(draft?.["kind"]).toBe("comparison");
    expect((draft?.["root"] as unknown[]).length).toBe(2);
  });

  it("repairs ids that break the id charset and de-duplicates collisions", () => {
    const draft = normalizeSurfaceDraft({
      kind: "list",
      root: [
        { id: "my card!", type: "MetricRow", props: {} },
        { id: "my card!", type: "MetricRow", props: {} },
      ],
    });
    const ids = (draft?.["root"] as Array<{ id: string }>).map((node) => node.id);
    expect(ids).toEqual(["my-card", "my-card-2"]);
  });

  it("drops explicit nulls that a strict schema would reject", () => {
    const draft = normalizeSurfaceDraft({
      kind: "detail",
      root: [{ id: "a", type: "MetricRow", props: {}, children: null, a11y: null }],
    });
    const node = (draft?.["root"] as Array<Record<string, unknown>>)[0];
    expect(node).not.toHaveProperty("children");
    expect(node).not.toHaveProperty("a11y");
  });

  it("discards identity the runtime owns", () => {
    const draft = normalizeSurfaceDraft({
      id: "attacker-chosen",
      intent: "something else",
      schemaVersion: "1.0",
      kind: "detail",
      root: [],
    });
    expect(draft).not.toHaveProperty("id");
    expect(draft).not.toHaveProperty("intent");
    expect(draft).not.toHaveProperty("schemaVersion");
  });

  it("returns null for a response that is not an object", () => {
    expect(normalizeSurfaceDraft("sorry, I cannot help with that")).toBeNull();
    expect(normalizeSurfaceDraft(null)).toBeNull();
  });

  it("lifts data the model inlined into props out into state", () => {
    const rows = [{ name: "Razer Blade 15", price: 2499 }];
    const draft = normalizeSurfaceDraft({
      kind: "comparison",
      state: {},
      root: [
        {
          id: "table",
          type: "CompareTable",
          props: { caption: "Laptops", rows },
        },
      ],
    });

    const node = (draft?.["root"] as Array<Record<string, unknown>>)[0];
    const props = node?.["props"] as Record<string, unknown>;
    const state = draft?.["state"] as Record<string, unknown>;

    // A literal prop is a snapshot: the runtime resolves bindings, so a
    // component holding literals stops responding to its own actions.
    expect(props["rows"]).toEqual({ $bind: "table_rows" });
    expect(state["table_rows"]).toEqual(rows);
    // Scalars are left alone.
    expect(props["caption"]).toBe("Laptops");
  });

  it("reuses the state key when the model already wrote the same data there", () => {
    const laptops = [{ id: "a", name: "Razer Blade 15" }];
    const draft = normalizeSurfaceDraft({
      kind: "comparison",
      state: { laptops },
      root: [{ id: "table", type: "CompareTable", props: { rows: laptops } }],
    });

    const props = (draft?.["root"] as Array<Record<string, unknown>>)[0]?.[
      "props"
    ] as Record<string, unknown>;
    expect(props["rows"]).toEqual({ $bind: "laptops" });
    expect(Object.keys(draft?.["state"] as object)).toEqual(["laptops"]);
  });

  it("produces a state key a binding path can actually address", () => {
    const draft = normalizeSurfaceDraft({
      kind: "list",
      state: {},
      root: [{ id: "my-card:1", type: "MetricRow", props: { metrics: [{ a: 1 }] } }],
    });

    const key = Object.keys(draft?.["state"] as object)[0] ?? "";
    expect(key).toMatch(/^[A-Za-z_$][\w$]*$/);
  });

  it("leaves an existing binding untouched", () => {
    const draft = normalizeSurfaceDraft({
      kind: "list",
      state: { metrics: [{ label: "MRR", value: "$1" }] },
      root: [
        { id: "m", type: "MetricRow", props: { metrics: { $bind: "metrics" } } },
      ],
    });

    const props = (draft?.["root"] as Array<Record<string, unknown>>)[0]?.[
      "props"
    ] as Record<string, unknown>;
    expect(props["metrics"]).toEqual({ $bind: "metrics" });
  });
});

describe("deterministic path", () => {
  it("still compiles a surface when no model is configured", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const result = await compileSurface(
      {
        intent: "Show me why revenue dropped this month",
        state: { metrics: [{ label: "MRR", value: "$41,200" }] },
        allowedActions: createSurfaceActions().ids(),
      },
      { components: createSurfaceRegistry(), actions: createSurfaceActions() },
    );

    expect(result.usedFallback).toBe(true);
    expect(result.surface.root.length).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
