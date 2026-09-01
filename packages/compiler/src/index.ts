/**
 * The UI Compiler: turns an intent into a validated, grounded surface. Models
 * make semantic choices; the compiler makes every structural guarantee.
 */
export {
  groundPlan,
  uiPlanSchema,
  type CompileContext,
  type UiPlan,
} from "./plan";

export { groundSurface, type GroundingIssue, type GroundingResult } from "./validate";

export {
  CATALOG_LIMIT,
  applyAppStyle,
  defaultSurfaceId,
  deterministicSurface,
  mergeState,
  selectPlan,
  shellSurface,
  toUiPlan,
  trackInto,
  type CompileStage,
  type CompileTraceEntry,
  type CompilerOptions,
  type IntelligenceOptions,
  type PlanSelection,
  type SurfaceModel,
  type Tracker,
} from "./phases";

export {
  compileSurface,
  type CompiledAttempt,
  type CompileResult,
} from "./compiler";
