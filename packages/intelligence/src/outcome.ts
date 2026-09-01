import type { SurfaceKind } from "@ovxa/schema";
import type { TaskKind } from "./context";

/**
 * What actually happened after a generated interface was shown. This is the
 * only signal that matters for the flywheel — not whether the surface rendered.
 */
export const outcomeResults = [
  "completed",
  "abandoned",
  "error",
  "corrected",
] as const;
export type OutcomeResult = (typeof outcomeResults)[number];

export type TaskOutcome = {
  surfaceId: string;
  intent: string;
  taskKind: TaskKind;
  surfaceKind: SurfaceKind;
  componentSignature?: string;
  result: OutcomeResult;
  interactionCount: number;
  timeMs: number;
  corrections: number;
  converted?: boolean;
};

export type LearningSignal = {
  surfaceId: string;
  pattern: {
    taskKind: TaskKind;
    surfaceKind: SurfaceKind;
    componentSignature?: string;
  };
  /** 0–1 reward used to bias future ranking of this pattern. */
  reward: number;
  outcome: OutcomeResult;
  metrics: {
    interactionCount: number;
    timeMs: number;
    corrections: number;
    converted: boolean;
  };
};

/**
 * North-star comparison. OVXA wins when its generated interface beats both
 * a chat transcript and a predetermined static screen on these numbers.
 */
export const benchmarkMetrics = [
  "taskCompletionRate",
  "timeToCompletionMs",
  "interactionCount",
  "abandonmentRate",
  "errorRate",
  "correctionRate",
  "conversionRate",
] as const;
export type BenchmarkMetric = (typeof benchmarkMetrics)[number];

export type InterfaceBaseline = "chat" | "static" | "ovxa";

export type BenchmarkSample = {
  baseline: InterfaceBaseline;
  metrics: Record<BenchmarkMetric, number>;
};
