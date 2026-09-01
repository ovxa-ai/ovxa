import type { SurfaceKind } from "@ovxa/schema";
import type { TaskKind } from "./context";
import type { LearningSignal, TaskOutcome } from "./outcome";

export type PatternKey = {
  taskKind: TaskKind;
  surfaceKind: SurfaceKind;
  componentSignature?: string;
};

export type PatternPrior = {
  trials: number;
  completionRate: number;
  abandonmentRate: number;
  errorRate: number;
  avgInteractions: number;
  avgTimeMs: number;
  confidence: number;
};

export type PatternStats = {
  trials: number;
  completions: number;
  abandonments: number;
  errors: number;
  corrections: number;
  conversions: number;
  totalInteractions: number;
  totalTimeMs: number;
};

function keyOf(key: PatternKey): string {
  return `${key.taskKind}|${key.surfaceKind}|${key.componentSignature ?? "*"}`;
}

function emptyStats(): PatternStats {
  return {
    trials: 0,
    completions: 0,
    abandonments: 0,
    errors: 0,
    corrections: 0,
    conversions: 0,
    totalInteractions: 0,
    totalTimeMs: 0,
  };
}

function toPrior(stats: PatternStats): PatternPrior {
  const trials = stats.trials;
  return {
    trials,
    completionRate: trials === 0 ? 0.5 : stats.completions / trials,
    abandonmentRate: trials === 0 ? 0 : stats.abandonments / trials,
    errorRate: trials === 0 ? 0 : stats.errors / trials,
    avgInteractions: trials === 0 ? 0 : stats.totalInteractions / trials,
    avgTimeMs: trials === 0 ? 0 : stats.totalTimeMs / trials,
    confidence: clampConfidence(trials),
  };
}

function clampConfidence(trials: number): number {
  return Math.min(1, trials / 20);
}

/**
 * In-memory priors for which UI patterns finish which tasks. Persistence is
 * a host concern; this object is the contract the Quality Engine reads.
 */
export class PatternMemory {
  // Keeps the structured key beside the stats so reading them back never has
  // to parse the string id.
  private readonly stats = new Map<string, { key: PatternKey; stats: PatternStats }>();

  prior(key: PatternKey): PatternPrior | undefined {
    const exact = this.stats.get(keyOf(key));
    if (exact && exact.stats.trials > 0) return toPrior(exact.stats);
    const wildcard = this.stats.get(
      keyOf({ taskKind: key.taskKind, surfaceKind: key.surfaceKind }),
    );
    if (wildcard && wildcard.stats.trials > 0) return toPrior(wildcard.stats);
    return undefined;
  }

  snapshot(key: PatternKey): PatternStats | undefined {
    const entry = this.stats.get(keyOf(key));
    return entry ? { ...entry.stats } : undefined;
  }

  /** Every pattern with recorded outcomes, most-completed first. */
  entries(): Array<{ key: PatternKey; prior: PatternPrior }> {
    return [...this.stats.values()]
      .map((entry) => ({ key: entry.key, prior: toPrior(entry.stats) }))
      .sort(
        (a, b) =>
          b.prior.completionRate - a.prior.completionRate ||
          b.prior.trials - a.prior.trials,
      );
  }

  record(outcome: TaskOutcome): LearningSignal {
    const key: PatternKey = {
      taskKind: outcome.taskKind,
      surfaceKind: outcome.surfaceKind,
      ...(outcome.componentSignature
        ? { componentSignature: outcome.componentSignature }
        : {}),
    };
    const id = keyOf(key);
    const current = this.stats.get(id)?.stats ?? emptyStats();
    current.trials += 1;
    current.totalInteractions += outcome.interactionCount;
    current.totalTimeMs += outcome.timeMs;
    current.corrections += outcome.corrections;
    if (outcome.result === "completed") current.completions += 1;
    if (outcome.result === "abandoned") current.abandonments += 1;
    if (outcome.result === "error") current.errors += 1;
    if (outcome.converted) current.conversions += 1;
    this.stats.set(id, { key, stats: current });

    const reward =
      outcome.result === "completed"
        ? 1 - Math.min(0.4, outcome.interactionCount / 20)
        : outcome.result === "corrected"
          ? 0.35
          : 0;

    return {
      surfaceId: outcome.surfaceId,
      pattern: key,
      reward,
      outcome: outcome.result,
      metrics: {
        interactionCount: outcome.interactionCount,
        timeMs: outcome.timeMs,
        corrections: outcome.corrections,
        converted: outcome.converted ?? false,
      },
    };
  }
}
