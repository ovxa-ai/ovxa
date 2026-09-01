import { describe, expect, it } from "vitest";
import {
  PatternMemory,
  classifyTask,
  compareInterfaceStrategies,
  defaultChatPlan,
  defaultStaticPlan,
  evaluateCandidate,
  learnApp,
  proposeCandidates,
  selectBest,
  understandContext,
  type TaskOutcome,
} from "./index";

const chooseIntent = "Help me choose the right health insurance plan for my family";

function chooseContext() {
  return understandContext({
    intent: chooseIntent,
    state: { plans: [], matrix: [] },
    allowedActions: ["selectOption", "setFilter"],
  });
}

describe("context understanding", () => {
  it("treats 'choose the right plan' as a choice, not a workflow", () => {
    expect(classifyTask(chooseIntent).taskKind).toBe("choose");
    expect(classifyTask(chooseIntent).preferredKinds[0]).toBe("comparison");
  });

  it("treats 'plan a trip' as arrange / workflow", () => {
    expect(classifyTask("Plan a 5-day trip to Tokyo under $4,000").taskKind).toBe(
      "arrange",
    );
  });

  it("treats a revenue drop as investigate", () => {
    expect(classifyTask("Show me why revenue dropped this month").taskKind).toBe(
      "investigate",
    );
  });

  it("prefers a learned product flow's surface over generic classification", () => {
    const app = learnApp({
      intent: "Walk the customer through account recovery",
      product: {
        name: "Acme Cloud",
        pages: [{ name: "recovery" }],
        entities: [{ name: "customer" }],
        workflows: [
          {
            id: "workflow:account-recovery",
            name: "Account recovery",
            capabilityIds: ["customer.inspect"],
          },
        ],
        capabilities: [
          {
            name: "customer.inspect",
            action: "inspect",
            entity: "customer",
          },
        ],
      },
    });
    const understanding = understandContext({
      intent: "Walk the customer through account recovery",
      state: {},
      allowedActions: ["confirm"],
      app,
    });
    expect(understanding.preferredKinds[0]).toBe("workflow");
    expect(understanding.app?.matchedFlows[0]?.name).toBe("Account recovery");
  });

  it("routes each kind of task language to the right primary surface", () => {
    const primary = (intent: string): string =>
      classifyTask(intent).preferredKinds[0] ?? "";
    expect(primary("Compare these plans")).toBe("comparison");
    expect(primary("Show me why revenue dropped")).toBe("dashboard");
    expect(primary("Book a flight to London")).toBe("form");
    expect(primary("Approve this refund")).toBe("confirmation");
  });

  it("separates investigating a trend from investigating one record", () => {
    // Both are the same task; only the information hierarchy differs.
    const trend = classifyTask("Show me why revenue dropped");
    const record = classifyTask("Investigate this suspicious payment");
    expect(trend.taskKind).toBe("investigate");
    expect(record.taskKind).toBe("investigate");
    expect(trend.preferredKinds[0]).toBe("dashboard");
    expect(record.preferredKinds[0]).toBe("detail");
  });
});

describe("candidate evaluation", () => {
  it("ranks a comparison above chat and a static list for a choose task", () => {
    const understanding = chooseContext();
    const comparison = compareInterfaceStrategies(understanding, {
      chat: defaultChatPlan(chooseIntent),
      static: defaultStaticPlan(chooseIntent),
      ovxa: {
        surface: "comparison",
        title: chooseIntent,
        rationale: "Side-by-side plans with a single select action.",
        objectives: [chooseIntent],
        componentIntents: ["compare", "select"],
        actions: ["selectOption"],
      },
    });
    expect(comparison.winner).toBe("ovxa");
    const surfaces = comparison.ranked.map((entry) => entry.candidate.plan.surface);
    expect(surfaces[0]).toBe("comparison");
  });

  it("vetoes a candidate with an empty catalogue", () => {
    const understanding = chooseContext();
    const [candidate] = proposeCandidates(understanding, { count: 1, includeBaselines: false });
    if (!candidate) throw new Error("expected a candidate");
    const evaluation = evaluateCandidate({
      understanding,
      candidate,
      catalogSize: 0,
    });
    expect(evaluation.vetoed).toBe(true);
  });

  it("selects the non-vetoed candidate even when totals are close", () => {
    const understanding = chooseContext();
    const candidates = proposeCandidates(understanding, { count: 3 });
    const evaluations = candidates.map((candidate, index) =>
      evaluateCandidate({
        understanding,
        candidate,
        catalogSize: index === 0 ? 0 : 4,
      }),
    );
    const selection = selectBest(candidates, evaluations);
    expect(selection.winner.evaluation.vetoed).toBe(false);
    expect(selection.winner.candidate.plan.surface).not.toBe(
      candidates[0]?.plan.surface ?? "",
    );
  });
});

describe("pattern memory", () => {
  it("raises historyFit after completed outcomes on a pattern", () => {
    const memory = new PatternMemory();
    const understanding = chooseContext();
    const candidates = proposeCandidates(understanding, {
      count: 2,
      includeBaselines: false,
    });
    const comparison = candidates.find((c) => c.plan.surface === "comparison");
    const other = candidates.find((c) => c.plan.surface !== "comparison");
    if (!comparison || !other) throw new Error("need two candidates");

    const outcome = (result: TaskOutcome["result"], surface: typeof comparison.plan.surface): TaskOutcome => ({
      surfaceId: "srf_1",
      intent: chooseIntent,
      taskKind: "choose",
      surfaceKind: surface,
      result,
      interactionCount: result === "completed" ? 2 : 7,
      timeMs: result === "completed" ? 12_000 : 90_000,
      corrections: 0,
      converted: result === "completed",
    });

    for (let i = 0; i < 8; i += 1) {
      memory.record(outcome("completed", "comparison"));
      memory.record(outcome("abandoned", other.plan.surface));
    }

    const withMemory = evaluateCandidate({
      understanding,
      candidate: comparison,
      memory,
    });
    const without = evaluateCandidate({
      understanding,
      candidate: comparison,
    });
    const history = withMemory.scores.find((s) => s.dimension === "historyFit");
    const baseline = without.scores.find((s) => s.dimension === "historyFit");
    expect(history?.score ?? 0).toBeGreaterThan(baseline?.score ?? 0);
    expect(memory.prior({ taskKind: "choose", surfaceKind: "comparison" })?.completionRate).toBe(
      1,
    );
  });

  it("lists recorded patterns best-completing first", () => {
    const memory = new PatternMemory();
    const base = {
      surfaceId: "srf_1",
      intent: chooseIntent,
      taskKind: "choose",
      corrections: 0,
    } as const;
    memory.record({
      ...base,
      surfaceKind: "comparison",
      result: "completed",
      interactionCount: 2,
      timeMs: 9_000,
    });
    memory.record({
      ...base,
      surfaceKind: "detail",
      result: "abandoned",
      interactionCount: 9,
      timeMs: 80_000,
    });

    const entries = memory.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.key.surfaceKind).toBe("comparison");
    expect(entries[0]?.prior.completionRate).toBe(1);
    expect(entries[1]?.prior.completionRate).toBe(0);
  });
});
