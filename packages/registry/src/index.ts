/**
 * The allowlist layer. Components and actions must be registered by the host
 * application before a generated surface may reference them.
 */
export {
  componentIntents,
  defineComponent,
  type ComponentAccessibility,
  type ComponentCapacity,
  type ComponentDefinition,
  type ComponentExample,
  type ComponentInput,
  type ComponentIntent,
  type ComponentStateSupport,
} from "./definition";

export {
  ComponentRegistry,
  createRegistry,
  type ComponentCandidate,
  type NodeValidation,
  type PropIssue,
} from "./registry";

export {
  ActionRegistry,
  createActionRegistry,
  defineAction,
  type ActionContext,
  type ActionDefinition,
  type ActionHandler,
  type ActionInput,
  type ActionOutcome,
  type DispatchResult,
} from "./actions";

export { buildCatalog, type Catalog, type CatalogEntry } from "./catalog";
