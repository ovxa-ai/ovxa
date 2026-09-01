import { walkComponents, type Surface, type SurfaceKind } from "@ovxa/schema";
import type { ComponentIntent } from "@ovxa/registry";
import type { ContextUnderstanding, TaskKind } from "./context";
import type { UiCandidate } from "./candidates";
import type { PatternMemory } from "./memory";

/**
 * Dimensions the Quality Engine scores. Task completion is the north star;
 * the rest exist to explain *why* a candidate is more or less likely to
 * finish the job.
 */
export const qualityDimensions = [
  "taskCompletion",
  "interactionCount",
  "clarity",
  "hierarchy",
  "componentFit",
  "cognitiveLoad",
  "accessibility",
  "consistency",
  "latency",
  "cost",
  "historyFit",
] as const;
export type QualityDimension = (typeof qualityDimensions)[number];

export type DimensionScore = {
  dimension: QualityDimension;
  /** Closed unit interval. Higher is better on every dimension. */
  score: number;
  rationale: string;
};

/** A veto always carries its reason, so an unexplained rejection cannot exist. */
export type CandidateEvaluation = {
  candidateId: string;
  scores: DimensionScore[];
  total: number;
} & ({ vetoed: true; vetoReason: string } | { vetoed: false });

export type EvaluationInput = {
  understanding: ContextUnderstanding;
  candidate: UiCandidate;
  /** Registered component names eligible for this surface, if known. */
  catalogSize?: number;
  memory?: PatternMemory;
};

const WEIGHTS: Record<QualityDimension, number> = {
  taskCompletion: 0.3,
  interactionCount: 0.12,
  clarity: 0.08,
  hierarchy: 0.08,
  componentFit: 0.12,
  cognitiveLoad: 0.08,
  accessibility: 0.08,
  consistency: 0.05,
  latency: 0.03,
  cost: 0.02,
  historyFit: 0.04,
};

const TASK_AFFINITY: Record<TaskKind, Partial<Record<SurfaceKind, number>>> = {
  choose: { comparison: 1, list: 0.55, form: 0.45, workflow: 0.3, detail: 0.18, dashboard: 0.12 },
  configure: { form: 1, workflow: 0.7, confirmation: 0.5, detail: 0.2 },
  investigate: { dashboard: 1, detail: 0.75, list: 0.5, comparison: 0.25 },
  monitor: { dashboard: 1, detail: 0.45, list: 0.3 },
  approve: { confirmation: 1, detail: 0.55, form: 0.35 },
  collect: { form: 1, workflow: 0.65, detail: 0.15 },
  browse: { list: 1, comparison: 0.45, dashboard: 0.25, detail: 0.2 },
  arrange: { workflow: 1, form: 0.65, comparison: 0.4, detail: 0.2 },
  explain: { detail: 1, dashboard: 0.55, list: 0.3 },
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Normalised by the weights actually present, so a partial evaluation (a
 * compiled surface scores fewer dimensions than a plan) stays comparable to a
 * full one instead of being penalised for the dimensions it cannot measure.
 */
function weightedTotal(scores: readonly DimensionScore[]): number {
  let weighted = 0;
  let weightSum = 0;
  for (const entry of scores) {
    weighted += entry.score * WEIGHTS[entry.dimension];
    weightSum += WEIGHTS[entry.dimension];
  }
  return weightSum === 0 ? 0 : clamp01(weighted / weightSum);
}

function affinity(taskKind: TaskKind, surface: SurfaceKind): number {
  return TASK_AFFINITY[taskKind][surface] ?? 0.08;
}

function completingActions(understanding: ContextUnderstanding): boolean {
  if (understanding.permittedActions.length === 0) return true;
  const needed: Record<TaskKind, RegExp> = {
    choose: /select|choose|pick|confirm/,
    configure: /submit|save|create|book|apply/,
    investigate: /.+/,
    monitor: /.+/,
    approve: /approve|confirm|authori|reject/,
    collect: /submit|save|update/,
    browse: /select|open|filter/,
    arrange: /submit|continue|book|confirm/,
    explain: /.+/,
  };
  const pattern = needed[understanding.taskKind];
  return understanding.permittedActions.some((id) => pattern.test(id));
}

function scoreTaskCompletion(input: EvaluationInput): DimensionScore {
  const { understanding, candidate } = input;
  const fit = affinity(understanding.taskKind, candidate.plan.surface);
  const chatLike =
    candidate.source === "baseline" && candidate.plan.surface === "detail";
  const dumpLike =
    candidate.source === "baseline" && candidate.plan.surface === "list";
  let score = fit;
  let rationale = `${candidate.plan.surface} is a ${(fit * 100).toFixed(0)}% fit for a ${understanding.taskKind} task.`;
  if (chatLike && understanding.taskKind !== "explain") {
    score = Math.min(score, 0.22);
    rationale =
      "A chat reply cannot complete a task that needs comparison, choice or configuration.";
  }
  if (dumpLike && understanding.taskKind === "choose") {
    score = Math.min(score, 0.48);
    rationale =
      "A static list shows options but does not help the user decide or commit.";
  }
  if (!completingActions(understanding) && understanding.taskKind !== "explain") {
    score = Math.min(score, 0.35);
    rationale = "No permitted action can actually complete this task.";
  }
  return { dimension: "taskCompletion", score: clamp01(score), rationale };
}

function scoreInteractions(input: EvaluationInput): DimensionScore {
  const n = input.candidate.predictedInteractions;
  const cap = input.understanding.constraints.maxInteractions;
  const score = clamp01(1 - (n - 1) / 9);
  const over = cap !== undefined && n > cap;
  return {
    dimension: "interactionCount",
    score: over ? score * 0.5 : score,
    rationale: over
      ? `Predicted ${n} interactions exceeds the budget of ${cap}.`
      : `Predicted ${n} interaction${n === 1 ? "" : "s"} to complete the task.`,
  };
}

function scoreClarity(input: EvaluationInput): DimensionScore {
  const { plan, source } = input.candidate;
  const focused = plan.componentIntents.length <= 3;
  const chat = source === "baseline" && plan.surface === "detail";
  const score = chat ? 0.35 : focused ? 0.86 : 0.62;
  return {
    dimension: "clarity",
    score,
    rationale: chat
      ? "Prose buries the decision inside a paragraph."
      : focused
        ? "A single surface kind with a short intent list."
        : "Too many simultaneous intents on one surface.",
  };
}

function scoreHierarchy(input: EvaluationInput): DimensionScore {
  const preferred = input.understanding.preferredKinds[0];
  const match = preferred === input.candidate.plan.surface;
  return {
    dimension: "hierarchy",
    score: match ? 0.88 : 0.55,
    rationale: match
      ? "Primary structure matches the task's natural hierarchy."
      : "Structure is valid but not the most direct hierarchy for this task.",
  };
}

function scoreComponentFit(input: EvaluationInput): DimensionScore {
  const wanted = new Set<ComponentIntent>(
    input.candidate.plan.componentIntents,
  );
  const catalog = input.catalogSize ?? 1;
  const empty = catalog === 0;
  const score = empty ? 0.1 : clamp01(0.5 + wanted.size * 0.12);
  return {
    dimension: "componentFit",
    score,
    rationale: empty
      ? "No registered component can render this surface kind."
      : `${catalog} catalogue entries can serve ${[...wanted].join(", ") || "this"} intent.`,
  };
}

function scoreCognitiveLoad(input: EvaluationInput): DimensionScore {
  const kind = input.candidate.plan.surface;
  const load: Record<SurfaceKind, number> = {
    comparison: 0.82,
    confirmation: 0.9,
    form: 0.78,
    result: 0.8,
    dashboard: 0.58,
    list: 0.62,
    workflow: 0.7,
    detail: 0.5,
    empty: 0.2,
  };
  const chat = input.candidate.source === "baseline" && kind === "detail";
  return {
    dimension: "cognitiveLoad",
    score: chat ? 0.28 : load[kind],
    rationale: chat
      ? "The user must reconstruct the decision from prose."
      : `${kind} keeps the number of simultaneous decisions bounded.`,
  };
}

function scoreAccessibility(input: EvaluationInput): DimensionScore {
  const kind = input.candidate.plan.surface;
  const structured = kind !== "detail" && kind !== "empty";
  return {
    dimension: "accessibility",
    score: structured ? 0.8 : 0.45,
    rationale: structured
      ? "Structured components can declare labels, landmarks and keyboard paths."
      : "A prose surface has no guaranteed component-level accessibility contract.",
  };
}

function scoreConsistency(input: EvaluationInput): DimensionScore {
  const { candidate, understanding } = input;
  if (candidate.source === "baseline") {
    return {
      dimension: "consistency",
      score: 0.4,
      rationale: "Baseline strategies ignore the host design system.",
    };
  }
  const flow = understanding.app?.matchedFlows.find(
    (entry) => entry.suggestedKind === candidate.plan.surface,
  );
  if (candidate.source === "product" || flow) {
    return {
      dimension: "consistency",
      score: 0.94,
      rationale: flow
        ? `Follows the learned "${flow.name}" flow already in the product.`
        : "Proposed from a learned product flow.",
    };
  }
  return {
    dimension: "consistency",
    score: 0.84,
    rationale: "Composed only from registered, design-system components.",
  };
}

function scoreLatency(input: EvaluationInput): DimensionScore {
  const budget = input.understanding.constraints.latencyBudgetMs;
  const cheap = input.candidate.source !== "model";
  const score = cheap ? 0.9 : budget !== undefined && budget < 400 ? 0.45 : 0.7;
  return {
    dimension: "latency",
    score,
    rationale: cheap
      ? "Deterministic candidate — no extra model round-trip."
      : "Model-authored candidate; cost scales with compile-top-k.",
  };
}

function scoreCost(input: EvaluationInput): DimensionScore {
  const score = input.candidate.source === "model" ? 0.45 : 0.92;
  return {
    dimension: "cost",
    score,
    rationale:
      input.candidate.source === "model"
        ? "Requires a generation call."
        : "Proposed without inference.",
  };
}

function scoreHistory(input: EvaluationInput): DimensionScore {
  const prior = input.memory?.prior({
    taskKind: input.understanding.taskKind,
    surfaceKind: input.candidate.plan.surface,
  });
  const preferred = input.understanding.history?.preferredKinds?.includes(
    input.candidate.plan.surface,
  );
  if (!prior && !preferred) {
    return {
      dimension: "historyFit",
      score: 0.5,
      rationale: "No permitted history for this pattern yet.",
    };
  }
  const score = clamp01(
    (prior?.completionRate ?? 0.5) * 0.7 + (preferred ? 0.3 : 0.15),
  );
  return {
    dimension: "historyFit",
    score,
    rationale: prior
      ? `Historical completion ${(prior.completionRate * 100).toFixed(0)}% over ${prior.trials} trials.`
      : "User has completed this surface kind before.",
  };
}

function maybeVeto(input: EvaluationInput): string | undefined {
  if ((input.catalogSize ?? 1) === 0) {
    return `No registered component can render a ${input.candidate.plan.surface} surface.`;
  }
  return undefined;
}

export function evaluateCandidate(input: EvaluationInput): CandidateEvaluation {
  const scores = [
    scoreTaskCompletion(input),
    scoreInteractions(input),
    scoreClarity(input),
    scoreHierarchy(input),
    scoreComponentFit(input),
    scoreCognitiveLoad(input),
    scoreAccessibility(input),
    scoreConsistency(input),
    scoreLatency(input),
    scoreCost(input),
    scoreHistory(input),
  ];
  const vetoReason = maybeVeto(input);
  const base = {
    candidateId: input.candidate.id,
    scores,
    total: weightedTotal(scores),
  };
  return vetoReason === undefined
    ? { ...base, vetoed: false }
    : { ...base, vetoed: true, vetoReason };
}

/**
 * Second-pass score on a compiled surface. Used when latency allows compiling
 * more than one candidate, or to attach a post-compile quality reading.
 */
export function evaluateSurface(
  surface: Surface,
  understanding: ContextUnderstanding,
  memory?: PatternMemory,
): CandidateEvaluation {
  let labeled = 0;
  let nodes = 0;
  walkComponents(surface.root, (node) => {
    nodes += 1;
    if (node.a11y?.label) labeled += 1;
  });
  const actions = surface.actions.length;
  const empty = surface.root.length === 0;
  const fit = affinity(understanding.taskKind, surface.kind);
  const interactionPenalty = clamp01(1 - Math.max(0, nodes - 4) / 12);
  const a11y = nodes === 0 ? 0.2 : clamp01(0.5 + labeled / Math.max(nodes, 1) / 2);
  const scores: DimensionScore[] = [
    {
      dimension: "taskCompletion",
      score: empty ? 0.05 : fit,
      rationale: empty
        ? "Compiled surface has nothing to render."
        : `Compiled ${surface.kind} surface for a ${understanding.taskKind} task.`,
    },
    {
      dimension: "interactionCount",
      score: clamp01(0.4 + actions * 0.15),
      rationale: `${actions} surface-level action${actions === 1 ? "" : "s"} exposed.`,
    },
    {
      dimension: "clarity",
      score: surface.title.length > 8 ? 0.8 : 0.5,
      rationale: surface.description
        ? "Title and description frame the decision."
        : "Title only; no supporting description.",
    },
    {
      dimension: "hierarchy",
      score: interactionPenalty,
      rationale: `${nodes} component${nodes === 1 ? "" : "s"} in the tree.`,
    },
    {
      dimension: "accessibility",
      score: a11y,
      rationale: `${labeled} of ${nodes} nodes declare an accessible label.`,
    },
  ];

  const prior = memory?.prior({
    taskKind: understanding.taskKind,
    surfaceKind: surface.kind,
  });
  if (prior) {
    scores.push({
      dimension: "historyFit",
      score: prior.completionRate,
      rationale: `Prior completion ${(prior.completionRate * 100).toFixed(0)}%.`,
    });
  }

  const base = {
    candidateId: `surface_${surface.id}`,
    scores,
    total: weightedTotal(scores),
  };
  return empty
    ? { ...base, vetoed: true, vetoReason: "Compiled surface is empty." }
    : { ...base, vetoed: false };
}
