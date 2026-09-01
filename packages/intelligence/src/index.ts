/**
 * The OVXA UI Intelligence Engine.
 *
 * Schema, registry, protocol and renderer are infrastructure. This package is
 * the product: given intent, context, state, permissions and a component
 * system, decide which interface is most likely to help the user finish.
 *
 *   Intent → Context → Candidates → Evaluate → Select → Compile
 *         → Render → Interact → Outcome → Learning
 *
 * North star: did the generated interface help the user complete the task?
 */
import type { ContextUnderstanding } from "./context";
import type { CandidateEvaluation } from "./evaluate";
import type { RankedCandidate } from "./select";

export {
  classifyTask,
  understandContext,
  taskKinds,
  type ContextConstraints,
  type ContextUnderstanding,
  type TaskKind,
  type UserHistorySignals,
} from "./context";

export {
  candidateFromPlan,
  proposeCandidates,
  type CandidateSource,
  type PlanDraft,
  type UiCandidate,
} from "./candidates";

export {
  evaluateCandidate,
  evaluateSurface,
  qualityDimensions,
  type CandidateEvaluation,
  type DimensionScore,
  type EvaluationInput,
  type QualityDimension,
} from "./evaluate";

export { selectBest, type RankedCandidate, type Selection } from "./select";

export {
  benchmarkMetrics,
  outcomeResults,
  type BenchmarkMetric,
  type BenchmarkSample,
  type InterfaceBaseline,
  type LearningSignal,
  type OutcomeResult,
  type TaskOutcome,
} from "./outcome";

export {
  PatternMemory,
  type PatternKey,
  type PatternPrior,
  type PatternStats,
} from "./memory";

export {
  describeAppForPrompt,
  hostSnapshotFromLearning,
  learnApp,
  matchFlows,
  ovxaVisualContract,
  productKnowledgeFromGraph,
  suggestedIntents,
  visualCssVars,
  type AppLearning,
  type HostLearningSnapshot,
  type LearnedFlow,
  type ProductKnowledge,
  type UserContract,
  type VisualContract,
  type VisualDensity,
  type VisualSource,
} from "./app";

export {
  compareInterfaceStrategies,
  defaultChatPlan,
  defaultStaticPlan,
  type StrategyComparison,
  type StrategySet,
} from "./benchmark";

export type IntelligenceReport = {
  understanding: ContextUnderstanding;
  ranked: RankedCandidate[];
  selectedId: string;
  rationale: string;
  surfaceScore?: CandidateEvaluation;
};
