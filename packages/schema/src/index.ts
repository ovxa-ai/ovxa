/**
 * The OVXA UI Schema: the declarative contract between a model and a rendered
 * interface. Everything a generated surface can express lives here, and
 * nothing outside it is renderable.
 */
export {
  bindableSchema,
  bindingSchema,
  conditionSchema,
  evaluateCondition,
  isBinding,
  jsonValueSchema,
  readPath,
  type Bindable,
  type Binding,
  type Condition,
  type JsonValue,
} from "./primitives";

export {
  actionInvocationSchema,
  actionRiskLevels,
  actionSchema,
  actionStatuses,
  confirmationSchema,
  type ActionInvocation,
  type ActionRisk,
  type ActionStatus,
  type Confirmation,
  type SurfaceAction,
} from "./action";

export {
  accessibilitySchema,
  breakpoints,
  collectComponentIds,
  componentNodeSchema,
  componentPhases,
  findComponent,
  responsiveSchema,
  walkComponents,
  type Accessibility,
  type Breakpoint,
  type ComponentNode,
  type ComponentPhase,
  type Responsive,
} from "./component";

export {
  SCHEMA_VERSION,
  SurfaceValidationError,
  layoutSchema,
  parseSurface,
  safeParseSurface,
  surfaceKinds,
  surfaceSchema,
  surfaceStatuses,
  type Surface,
  type SurfaceKind,
  type SurfaceLayout,
  type SurfaceStatus,
} from "./surface";

export {
  applySurfacePatch,
  surfacePatchOperationSchema,
  surfacePatchSchema,
  type PatchResult,
  type RejectedOperation,
  type SurfacePatch,
  type SurfacePatchOperation,
} from "./patch";

export {
  collectBoundPaths,
  resolveBindable,
  resolveSurface,
  type ResolvedNode,
} from "./resolve";
