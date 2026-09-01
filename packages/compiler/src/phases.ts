import { z } from "zod";
import {
  SCHEMA_VERSION,
  type ComponentNode,
  type JsonValue,
  type Surface,
  type SurfaceLayout,
} from "@ovxa/schema";
import {
  buildCatalog,
  type ActionRegistry,
  type Catalog,
  type ComponentDefinition,
  type ComponentRegistry,
} from "@ovxa/registry";
import {
  candidateFromPlan,
  evaluateCandidate,
  proposeCandidates,
  selectBest,
  understandContext,
  type CandidateEvaluation,
  type ContextUnderstanding,
  type PatternMemory,
  type PlanDraft,
  type Selection,
  type UiCandidate,
  type UserHistorySignals,
} from "@ovxa/intelligence";
import { groundPlan, uiPlanSchema, type CompileContext, type UiPlan } from "./plan";

/**
 * The stages every generation passes through, in order. Both the batch
 * compiler and the streaming compiler record against this vocabulary so a
 * trace reads the same either way.
 */
export type CompileStage =
  | "understand"
  | "propose"
  | "evaluate"
  | "select"
  | "catalog"
  | "generate"
  | "validate"
  | "ground"
  | "fallback";

export type CompileTraceEntry = {
  stage: CompileStage;
  durationMs: number;
  detail: string;
};

/**
 * The provider boundary. A model contributes semantic judgement — which
 * surface, which components — and nothing else; every structural guarantee is
 * enforced by the compiler after the model returns.
 */
export interface SurfaceModel {
  readonly name: string;
  planSurface?(context: CompileContext, catalog: Catalog): Promise<unknown>;
  generateSurface(
    context: CompileContext,
    plan: UiPlan,
    catalog: Catalog,
  ): Promise<unknown>;
  /**
   * Raw text chunks of the surface document as the model writes it. Present
   * only on providers that support token streaming; the streaming compiler
   * falls back to `generateSurface` when it is absent, so no caller has to
   * branch on provider capability.
   */
  streamSurface?(
    context: CompileContext,
    plan: UiPlan,
    catalog: Catalog,
    signal?: AbortSignal,
  ): AsyncIterable<string>;
}

export type IntelligenceOptions = {
  /** How many competing plans to score. Default 4. */
  candidateCount?: number;
  /**
   * How many of the top-ranked plans to actually compile and re-score as
   * surfaces. Default 1. Raise it where latency permits.
   */
  compileTopK?: number;
  memory?: PatternMemory;
  history?: UserHistorySignals;
  latencyBudgetMs?: number;
};

export type CompilerOptions = {
  components: ComponentRegistry;
  actions: ActionRegistry;
  model?: SurfaceModel;
  now?: () => Date;
  newId?: () => string;
  intelligence?: IntelligenceOptions;
};

export type Tracker = <T>(
  stage: CompileStage,
  detail: string,
  run: () => Promise<T> | T,
) => Promise<T>;

/** Times a stage and appends the entry to one buffer. */
export function trackInto(sink: CompileTraceEntry[]): Tracker {
  return async <T>(
    stage: CompileStage,
    detail: string,
    run: () => Promise<T> | T,
  ): Promise<T> => {
    const started = Date.now();
    const value = await run();
    sink.push({ stage, durationMs: Date.now() - started, detail });
    return value;
  };
}

let counter = 0;

export function defaultSurfaceId(): string {
  counter += 1;
  return `srf_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/**
 * Where the data a surface renders comes from.
 *
 * The host is authoritative: anything the caller supplied wins, because that is
 * real application state and the model must never overwrite it. But a model
 * asked to build an interface for a request the host has no data for has to be
 * able to supply the subject matter too, otherwise every generated surface
 * outside a pre-loaded scenario renders as an empty shell. Model keys therefore
 * fill the gaps and never more than the gaps.
 */
export function mergeState(
  raw: unknown,
  hostState: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const authored =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as { state?: unknown }).state
      : undefined;
  if (
    typeof authored !== "object" ||
    authored === null ||
    Array.isArray(authored)
  ) {
    return hostState;
  }
  return { ...(authored as Record<string, JsonValue>), ...hostState };
}

function layoutForContext(context: CompileContext): SurfaceLayout {
  const density =
    context.app?.visualSource === "host"
      ? context.app.visual.density
      : "comfortable";
  return {
    columns: 2,
    density,
    maxWidth: density === "compact" ? "wide" : "regular",
  };
}

/** Host visual density wins over whatever the model guessed. OVXA fallback is not a host. */
export function applyAppStyle(surface: Surface, context: CompileContext): Surface {
  if (context.app?.visualSource !== "host") return surface;
  const density = context.app.visual.density;
  if (surface.layout.density === density) return surface;
  return { ...surface, layout: { ...surface.layout, density } };
}

/** Reading order for a composed surface: orient, then decide, then support. */
const INTENT_ORDER: Record<string, number> = {
  summarize: 0,
  monitor: 0,
  navigate: 1,
  compare: 2,
  select: 2,
  enumerate: 2,
  "collect-input": 3,
  confirm: 4,
  visualize: 5,
  explain: 6,
  annotate: 6,
};

function orderOf(intents: readonly string[]): number {
  return Math.min(9, ...intents.map((intent) => INTENT_ORDER[intent] ?? 7));
}

type Bindings = { props: Record<string, { $bind: string }>; satisfied: boolean };

/**
 * Binds a component's props to state by name. `satisfied` is false when a
 * required prop has no matching state key, which is how a component that
 * would render empty gets left out.
 */
function bindProps(
  definition: ComponentDefinition,
  stateKeys: readonly string[],
): Bindings {
  const shape = (definition.props as { shape?: Record<string, z.ZodType<unknown>> })
    .shape;
  if (!shape) return { props: {}, satisfied: false };

  const props = new Map<string, { $bind: string }>();
  let satisfied = true;
  for (const [name, schema] of Object.entries(shape)) {
    const match = stateKeys.find((key) => key.toLowerCase() === name.toLowerCase());
    if (match) {
      props.set(name, { $bind: match });
      continue;
    }
    if (!schema.safeParse(undefined).success) satisfied = false;
  }
  return {
    props: Object.fromEntries(props),
    satisfied: satisfied && props.size > 0,
  };
}

/** Enough to compose a real surface, few enough to stay readable. */
const MAX_DETERMINISTIC_NODES = 6;

/**
 * How many components the model is shown.
 *
 * The registry ranks by surface fit and intent overlap, so the top of the list is
 * the relevant part. Showing all of a large library costs prompt tokens on every
 * request and measurably worsens the choice — a model given twenty-three options
 * reaches for the unusual one. Twelve leaves real choice and keeps the prompt
 * small enough to start generating quickly.
 */
export const CATALOG_LIMIT = 12;

/**
 * Why there is no interface, in terms the person reading it can act on.
 *
 * The two causes need different answers: a request with no data behind it needs
 * data, and a request no registered component covers needs a component. Saying
 * "no results" for either is what makes a generated interface feel broken.
 */
function emptyReason(context: CompileContext, candidateCount: number): string {
  if (candidateCount === 0) {
    return "No registered component fits this kind of request yet. Register one for this surface kind and it becomes generatable.";
  }
  if (Object.keys(context.state).length === 0) {
    return "There is no data behind this request yet, and the model did not supply any. Pass application state alongside the intent, or configure a model to compose the subject matter.";
  }
  return "The data available does not fill any registered component. Check that the state keys match the props the components expect.";
}

/**
 * The surface shown when there is no model, or when the model produced nothing
 * usable.
 *
 * It composes every registered component the available state can actually
 * fill, in reading order — not just the single best match. Without a model
 * this is the whole product, so a one-component shell is not good enough.
 */
export function deterministicSurface(
  context: CompileContext,
  plan: UiPlan,
  components: ComponentRegistry,
  id: string,
  timestamp: string,
): Surface {
  const stateKeys = Object.keys(context.state);
  const candidates = components.candidatesFor({
    surface: plan.surface,
    intents: plan.componentIntents,
  });

  const usable = candidates
    .map((candidate) => ({
      definition: candidate.definition,
      score: candidate.score,
      ...bindProps(candidate.definition, stateKeys),
    }))
    .filter((entry) => entry.satisfied)
    .sort(
      (a, b) =>
        orderOf(a.definition.intents) - orderOf(b.definition.intents) ||
        b.score - a.score,
    )
    .slice(0, MAX_DETERMINISTIC_NODES);

  const root: ComponentNode[] = usable.map((entry) => ({
    id: entry.definition.name.replace(/[^A-Za-z0-9_:-]/g, "").toLowerCase(),
    type: entry.definition.name,
    props: entry.props,
    ...(entry.definition.a11y.requiresLabel ? { a11y: { label: plan.title } } : {}),
  }));

  /**
   * Nothing could bind, so there is no interface to compose.
   *
   * Rendering the best-matching component anyway used to look like a reasonable
   * degradation, but a data component with no data renders as "no data" — a card
   * that tells the user nothing and looks broken. An explicitly empty surface is
   * both more honest and more useful, because the renderer can then say what is
   * missing instead of showing a hole where an interface should be.
   */
  const empty = root.length === 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    intent: context.intent,
    kind: empty ? "empty" : plan.surface,
    title: plan.title,
    description: empty
      ? emptyReason(context, candidates.length)
      : plan.rationale,
    layout: layoutForContext(context),
    root,
    state: context.state,
    actions: [],
    status: "ready",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * The surface shell: everything a client needs to lay out and label the
 * interface before a single component exists. Streaming emits this the moment
 * a plan wins, which is what makes the first paint happen during generation
 * rather than after it.
 */
export function shellSurface(
  context: CompileContext,
  plan: UiPlan,
  id: string,
  timestamp: string,
): Surface {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    intent: context.intent,
    kind: plan.surface,
    title: plan.title,
    description: plan.rationale,
    layout: layoutForContext(context),
    root: [],
    state: context.state,
    actions: [],
    status: "streaming",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function toUiPlan(draft: PlanDraft, context: CompileContext): UiPlan {
  return groundPlan(
    uiPlanSchema.parse({
      surface: draft.surface,
      title: draft.title,
      rationale: draft.rationale,
      objectives: draft.objectives,
      componentIntents: draft.componentIntents,
      actions: draft.actions,
    }),
    context,
  );
}

function catalogSizeFor(components: ComponentRegistry, plan: PlanDraft): number {
  return components.candidatesFor({
    surface: plan.surface,
    intents: plan.componentIntents,
  }).length;
}

export type PlanSelection = {
  understanding: ContextUnderstanding;
  candidates: UiCandidate[];
  evaluations: CandidateEvaluation[];
  selection: Selection;
};

/**
 * Intent → context → candidate plans → evaluation → selection.
 *
 * The half of the pipeline that happens before any markup exists. Both the
 * batch and the streaming compiler run exactly this, which is what lets a
 * streaming client render a correctly-planned shell without waiting for
 * generation to finish.
 */
export async function selectPlan(
  context: CompileContext,
  options: CompilerOptions,
  track: Tracker,
): Promise<PlanSelection> {
  const intel = options.intelligence;

  const understanding = await track(
    "understand",
    "Classify the task and the context it must finish in",
    () =>
      understandContext({
        intent: context.intent,
        state: context.state,
        allowedActions: context.allowedActions,
        ...(context.locale !== undefined ? { locale: context.locale } : {}),
        ...(intel?.latencyBudgetMs !== undefined
          ? { latencyBudgetMs: intel.latencyBudgetMs }
          : {}),
        ...(intel?.history ? { history: intel.history } : {}),
        ...(context.app ? { app: context.app } : {}),
      }),
  );

  const candidates = await track(
    "propose",
    "Propose competing interface plans",
    async () => {
      const drafts = proposeCandidates(understanding, {
        count: intel?.candidateCount ?? 4,
      });
      if (!options.model?.planSurface) return drafts;
      try {
        const seed = drafts[0]?.plan;
        const catalog = buildCatalog(options.components, options.actions, {
          surface: seed?.surface ?? understanding.preferredKinds[0] ?? "detail",
          limit: CATALOG_LIMIT,
        });
        const raw = await options.model.planSurface(context, catalog);
        const parsed = uiPlanSchema.safeParse(raw);
        if (!parsed.success) return drafts;
        const grounded = groundPlan(parsed.data, context);
        return [candidateFromPlan(grounded, "model", drafts.length + 1), ...drafts];
      } catch {
        return drafts;
      }
    },
  );

  const evaluations = await track("evaluate", "Score every candidate plan", () =>
    candidates.map((candidate) =>
      evaluateCandidate({
        understanding,
        candidate,
        catalogSize: catalogSizeFor(options.components, candidate.plan),
        ...(intel?.memory ? { memory: intel.memory } : {}),
      }),
    ),
  );

  const selection = await track(
    "select",
    "Pick the plan most likely to complete the task",
    () => selectBest(candidates, evaluations),
  );

  return { understanding, candidates, evaluations, selection };
}
