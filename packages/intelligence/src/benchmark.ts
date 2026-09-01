import type { ContextUnderstanding } from "./context";
import {
  candidateFromPlan,
  type PlanDraft,
  type UiCandidate,
} from "./candidates";
import { evaluateCandidate, type CandidateEvaluation } from "./evaluate";
import { selectBest, type RankedCandidate } from "./select";
import type { PatternMemory } from "./memory";
import type { InterfaceBaseline } from "./outcome";

export type StrategySet = {
  chat: PlanDraft;
  static: PlanDraft;
  ovxa: PlanDraft;
};

export type StrategyComparison = {
  understanding: ContextUnderstanding;
  ranked: RankedCandidate[];
  winner: InterfaceBaseline;
  rationale: string;
};

function asCandidate(
  plan: PlanDraft,
  baseline: InterfaceBaseline,
  index: number,
): UiCandidate {
  const source = baseline === "ovxa" ? "deterministic" : "baseline";
  const candidate = candidateFromPlan(plan, source, index);
  return { ...candidate, id: `baseline_${baseline}` };
}

/**
 * The company benchmark, expressed as a ranking. Given the same intent,
 * chat, a predetermined static screen, and an OVXA plan compete. OVXA is
 * winning when its plan is selected.
 */
export function compareInterfaceStrategies(
  understanding: ContextUnderstanding,
  strategies: StrategySet,
  memory?: PatternMemory,
): StrategyComparison {
  const candidates = [
    asCandidate(strategies.chat, "chat", 1),
    asCandidate(strategies.static, "static", 2),
    asCandidate(strategies.ovxa, "ovxa", 3),
  ];
  const evaluations: CandidateEvaluation[] = candidates.map((candidate) =>
    evaluateCandidate({ understanding, candidate, ...(memory ? { memory } : {}) }),
  );
  const selection = selectBest(candidates, evaluations);
  const winnerId = selection.winner.candidate.id;
  const winner: InterfaceBaseline =
    winnerId === "baseline_chat"
      ? "chat"
      : winnerId === "baseline_static"
        ? "static"
        : "ovxa";
  return {
    understanding,
    ranked: selection.ranked,
    winner,
    rationale: selection.rationale,
  };
}

export function defaultChatPlan(intent: string): PlanDraft {
  return {
    surface: "detail",
    title: intent,
    rationale: "Answer in prose and wait for the next message.",
    objectives: [intent],
    componentIntents: ["explain"],
    actions: [],
  };
}

export function defaultStaticPlan(intent: string): PlanDraft {
  return {
    surface: "list",
    title: intent,
    rationale: "Show every record the application already has.",
    objectives: [intent],
    componentIntents: ["enumerate"],
    actions: [],
  };
}
