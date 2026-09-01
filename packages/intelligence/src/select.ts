import type { CandidateEvaluation } from "./evaluate";
import type { UiCandidate } from "./candidates";

export type RankedCandidate = {
  candidate: UiCandidate;
  evaluation: CandidateEvaluation;
  rank: number;
};

export type Selection = {
  winner: RankedCandidate;
  ranked: RankedCandidate[];
  rationale: string;
};

/**
 * Pick the interface most likely to finish the task. Vetoed candidates lose
 * even if their weighted total is higher; ties break toward fewer predicted
 * interactions, then toward the earlier (more preferred) candidate.
 */
export function selectBest(
  candidates: UiCandidate[],
  evaluations: CandidateEvaluation[],
): Selection {
  const byId = new Map(evaluations.map((evaluation) => [evaluation.candidateId, evaluation]));
  const ranked = [...candidates]
    .map((candidate) => {
      const evaluation = byId.get(candidate.id);
      if (!evaluation) {
        throw new Error(`Missing evaluation for candidate ${candidate.id}`);
      }
      return { candidate, evaluation, rank: 0 };
    })
    .sort((a, b) => {
      if (a.evaluation.vetoed !== b.evaluation.vetoed) {
        return a.evaluation.vetoed ? 1 : -1;
      }
      if (a.evaluation.total !== b.evaluation.total) {
        return b.evaluation.total - a.evaluation.total;
      }
      if (a.candidate.predictedInteractions !== b.candidate.predictedInteractions) {
        return a.candidate.predictedInteractions - b.candidate.predictedInteractions;
      }
      return a.candidate.id.localeCompare(b.candidate.id);
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const winner = ranked[0];
  if (!winner) {
    throw new Error("selectBest requires at least one candidate");
  }

  const runnerUp = ranked[1];
  const margin = runnerUp
    ? (winner.evaluation.total - runnerUp.evaluation.total).toFixed(2)
    : "n/a";
  const top = winner.evaluation.scores
    .slice()
    .sort((a, b) => b.score - a.score)[0];

  return {
    winner,
    ranked,
    rationale: runnerUp
      ? `Selected ${winner.candidate.plan.surface} over ${runnerUp.candidate.plan.surface} (margin ${margin})${top ? `; strongest signal: ${top.dimension}` : ""}.`
      : `Only viable candidate is a ${winner.candidate.plan.surface} surface.`,
  };
}
