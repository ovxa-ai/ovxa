import type { SurfaceKind } from "@ovxa/schema";
import type { ComponentIntent } from "@ovxa/registry";
import type { ContextUnderstanding } from "./context";

/**
 * A proposed interface, before any markup exists. Candidates compete; only
 * the winner is compiled. The source tells the inspector whether this came
 * from classification, a model, or learned priors.
 */
export type PlanDraft = {
  surface: SurfaceKind;
  title: string;
  rationale: string;
  objectives: string[];
  componentIntents: ComponentIntent[];
  actions: string[];
};

export type CandidateSource =
  | "deterministic"
  | "model"
  | "memory"
  | "product"
  | "baseline";

export type UiCandidate = {
  id: string;
  plan: PlanDraft;
  source: CandidateSource;
  /** Predicted clicks / fields / turns to finish the stated task. */
  predictedInteractions: number;
};

const intentsForKind: Record<SurfaceKind, ComponentIntent[]> = {
  comparison: ["compare", "select", "explain"],
  form: ["collect-input", "confirm"],
  dashboard: ["visualize", "summarize", "monitor"],
  workflow: ["collect-input", "navigate", "summarize"],
  detail: ["explain", "summarize"],
  list: ["enumerate", "select"],
  confirmation: ["confirm", "explain"],
  result: ["summarize", "explain"],
  empty: ["summarize"],
};

function titleFor(intent: string): string {
  const cleaned = intent.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
  const titled = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return titled.length > 140 ? `${titled.slice(0, 137)}…` : titled;
}

function predictedInteractions(kind: SurfaceKind, source: CandidateSource): number {
  if (source === "baseline" && kind === "detail") return 8;
  switch (kind) {
    case "comparison":
    case "confirmation":
      return 2;
    case "form":
    case "list":
      return 3;
    case "dashboard":
    case "result":
      return 3;
    case "workflow":
      return 4;
    case "detail":
      return 6;
    case "empty":
      return 10;
  }
}

function draftFor(
  understanding: ContextUnderstanding,
  kind: SurfaceKind,
  rationale: string,
): PlanDraft {
  return {
    surface: kind,
    title: titleFor(understanding.intent),
    rationale,
    objectives: [understanding.intent.trim().slice(0, 160)],
    componentIntents: intentsForKind[kind],
    actions: understanding.permittedActions.slice(0, 12),
  };
}

/**
 * Competing interface strategies for this intent. Always includes a
 * chat-like contrast candidate so evaluation can reject "just explain it"
 * when the task needs a real surface.
 */
export function proposeCandidates(
  understanding: ContextUnderstanding,
  options: { count?: number; includeBaselines?: boolean } = {},
): UiCandidate[] {
  const count = options.count ?? 4;
  const includeBaselines = options.includeBaselines ?? true;
  const seen = new Set<SurfaceKind>();
  const candidates: UiCandidate[] = [];

  const push = (
    kind: SurfaceKind,
    source: CandidateSource,
    rationale: string,
  ): void => {
    if (seen.has(kind) || candidates.length >= count) return;
    seen.add(kind);
    const id = `cand_${kind}_${candidates.length + 1}`;
    candidates.push({
      id,
      plan: draftFor(understanding, kind, rationale),
      source,
      predictedInteractions: predictedInteractions(kind, source),
    });
  };

  for (const flow of understanding.app?.matchedFlows ?? []) {
    push(
      flow.suggestedKind,
      "product",
      `Mirrors the learned "${flow.name}" flow (${flow.steps.join(" → ")}).`,
    );
  }

  for (const kind of understanding.preferredKinds) {
    push(
      kind,
      "deterministic",
      `Preferred ${kind} surface for a ${understanding.taskKind} task.`,
    );
  }

  if (includeBaselines) {
    push(
      "detail",
      "baseline",
      "Chat-like explanation: answer in prose and wait for the next question.",
    );
    push(
      "list",
      "baseline",
      "Static dump: enumerate everything available and leave the user to decide.",
    );
  }

  return candidates;
}

export function candidateFromPlan(
  plan: PlanDraft,
  source: CandidateSource,
  index: number,
): UiCandidate {
  return {
    id: `cand_${plan.surface}_${source}_${index}`,
    plan,
    source,
    predictedInteractions: predictedInteractions(plan.surface, source),
  };
}
