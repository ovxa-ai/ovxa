import {
  SCHEMA_VERSION,
  isBinding,
  safeParseSurface,
  type ComponentNode,
  type JsonValue,
  type Surface,
  type SurfacePatchOperation,
} from "@ovxa/schema";
import { buildCatalog } from "@ovxa/registry";
import {
  evaluateSurface,
  type IntelligenceReport,
} from "@ovxa/intelligence";
import {
  CATALOG_LIMIT,
  applyAppStyle,
  defaultSurfaceId,
  deterministicSurface,
  groundSurface,
  mergeState,
  selectPlan,
  shellSurface,
  toUiPlan,
  trackInto,
  type CompileContext,
  type CompilerOptions,
  type CompileTraceEntry,
  type GroundingIssue,
  type UiPlan,
} from "@ovxa/compiler";
import { SurfaceEventEmitter, type SurfaceEvent } from "@ovxa/protocol";
import { IncrementalSurfaceParser, type IncrementalHeader } from "./incremental";

export type StreamOptions = CompilerOptions & {
  /** Cancels in-flight generation. Whatever already streamed stays on screen. */
  signal?: AbortSignal;
};

export type StreamResult = {
  surface: Surface;
  plan: UiPlan;
  issues: GroundingIssue[];
  trace: CompileTraceEntry[];
  usedFallback: boolean;
  model: string;
  intelligence: IntelligenceReport;
  /** Components that rendered before generation had finished. */
  streamedComponents: number;
  /** How long the user waited for a laid-out, labelled interface. */
  timeToShellMs: number;
  /** How long the user waited to see real content. Null if nothing streamed. */
  timeToFirstComponentMs: number | null;
  elapsedMs: number;
  /** Set when generation failed but a usable surface was preserved. */
  degradedReason: string | null;
};

/** Bounded, non-leaking description of a generation failure. */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Generation was cancelled";
  }
  if (error instanceof Error && typeof error.message === "string") {
    return error.message.slice(0, 200);
  }
  return "Generation failed";
}

/**
 * Only top-level identifiers can be the root of a binding, so a state key that
 * is not one can never be read by a component. Skipping those keeps the patch
 * stream free of writes nothing can consume.
 */
const BINDABLE_KEY = /^[A-Za-z_$][\w$]*$/;

function structurallyEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Grounds one streamed node in isolation, using the same pass the batch
 * compiler applies to a whole surface. A component reaches the screen mid-flight
 * only if it would also have survived a full compile — streaming never relaxes
 * the allowlist.
 */
function groundStreamedNode(
  raw: unknown,
  shell: Surface,
  context: CompileContext,
  options: CompilerOptions,
  usedIds: ReadonlySet<string>,
): ComponentNode | null {
  const probe = safeParseSurface({ ...shell, root: [raw] });
  if (!probe.ok) return null;

  const grounded = groundSurface(probe.surface, options.components, options.actions, {
    allowedActions: context.allowedActions,
  });
  const node = grounded.surface.root[0];
  if (!node || usedIds.has(node.id)) return null;

  // A binding whose state root has not arrived yet renders as a skeleton
  // rather than an empty card; the reconcile pass clears it.
  const pending = Object.values(node.props).some(
    (value) =>
      isBinding(value) && !((value.$bind.split(".")[0] ?? "") in shell.state),
  );
  return pending ? { ...node, phase: "loading" } : node;
}

/**
 * Fields the runtime owns outright.
 *
 * Identity, timing and intent are obvious. `status` belongs here too and it is
 * easy to miss: a model that writes an unrecognised status would otherwise fail
 * the whole document on a field it was never entitled to set.
 */
function withRuntimeIdentity(
  raw: Record<string, unknown>,
  context: CompileContext,
  surfaceId: string,
  timestamp: string,
): Record<string, unknown> {
  return {
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    id: surfaceId,
    intent: context.intent,
    state: mergeState(raw, context.state),
    status: "ready",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Rebuilds a surface from the parts of a document that are valid.
 *
 * Whole-document validation is all-or-nothing, so one malformed component would
 * otherwise cost every good one — and a model that got nine cards right and the
 * tenth wrong would fall all the way back to the deterministic surface. Here each
 * root node is validated on its own and the failures are dropped, which is the
 * same fail-closed rule applied at a useful granularity.
 */
function salvageSurface(
  raw: unknown,
  shell: Surface,
  context: CompileContext,
  options: CompilerOptions,
  surfaceId: string,
  timestamp: string,
): { surface: Surface | null; dropped: number } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { surface: null, dropped: 0 };
  }
  const record = raw as Record<string, unknown>;
  const rawRoot = Array.isArray(record.root) ? record.root : [];
  if (rawRoot.length === 0) return { surface: null, dropped: 0 };

  // The header is rebuilt from the shell, which is already valid, so a bad title
  // or layout cannot take the surface down either.
  const base = withRuntimeIdentity(
    { ...record, root: [], actions: [] },
    context,
    surfaceId,
    timestamp,
  );
  const headerOnly = safeParseSurface({
    ...base,
    kind: typeof record.kind === "string" ? record.kind : shell.kind,
    title: typeof record.title === "string" && record.title.length > 0 ? record.title : shell.title,
    layout: shell.layout,
    status: "streaming",
  });
  const scaffold = headerOnly.ok ? headerOnly.surface : shell;

  const kept: ComponentNode[] = [];
  const seen = new Set<string>();
  for (const candidate of rawRoot) {
    const node = groundStreamedNode(candidate, scaffold, context, options, seen);
    if (!node) continue;
    seen.add(node.id);
    // A salvaged node is settled, not still streaming.
    kept.push({ ...node, phase: "ready" });
  }

  if (kept.length === 0) return { surface: null, dropped: rawRoot.length };

  const assembled = safeParseSurface({ ...scaffold, root: kept, status: "ready" });
  return assembled.ok
    ? { surface: assembled.surface, dropped: rawRoot.length - kept.length }
    : { surface: null, dropped: rawRoot.length };
}

function headerOperations(header: IncrementalHeader): SurfacePatchOperation[] {
  const patch: Extract<SurfacePatchOperation, { op: "surface.patch" }> = {
    op: "surface.patch",
  };
  let any = false;
  if (header.title !== undefined && header.title.length > 0) {
    patch.title = header.title.slice(0, 140);
    any = true;
  }
  if (header.description !== undefined) {
    patch.description = header.description.slice(0, 400);
    any = true;
  }
  return any ? [patch] : [];
}

/**
 * Reconciles the surface a client already rendered against the surface the
 * compiler finally produced.
 *
 * This is the difference between streaming and re-rendering: nodes already on
 * screen are patched in place, so a selection, a focused field or a scroll
 * position survives the end of generation.
 */
function reconcile(
  shell: Surface,
  streamed: readonly ComponentNode[],
  final: Surface,
): SurfacePatchOperation[] {
  const operations: SurfacePatchOperation[] = [];

  // State lands first: components bind into it, and a phase cleared before its
  // data arrived would show an empty component instead of a skeleton.
  for (const [key, value] of Object.entries(final.state)) {
    if (!BINDABLE_KEY.test(key)) continue;
    if (structurallyEqual(shell.state[key], value)) continue;
    operations.push({ op: "state.patch", path: key, value });
  }

  const streamedById = new Map(streamed.map((node) => [node.id, node]));
  const finalIds = new Set(final.root.map((node) => node.id));

  // Anything the model streamed but the finished surface dropped.
  for (const node of streamed) {
    if (!finalIds.has(node.id)) {
      operations.push({ op: "component.remove", id: node.id });
      streamedById.delete(node.id);
    }
  }

  /**
   * Processing in ascending index keeps inserts correct: by the time index `i`
   * is considered, positions before it already match the finished surface, so
   * an insert at `i` lands exactly where it belongs.
   */
  final.root.forEach((node, index) => {
    const existing = streamedById.get(node.id);
    if (!existing) {
      operations.push({ op: "component.add", parentId: null, index, node });
      return;
    }

    // Props, phase and actions are patchable. A changed subtree is not, so a
    // node whose children moved is replaced rather than left inconsistent.
    if (!structurallyEqual(existing.children, node.children)) {
      operations.push({ op: "component.remove", id: node.id });
      operations.push({ op: "component.add", parentId: null, index, node });
      return;
    }

    const patch: Extract<SurfacePatchOperation, { op: "component.patch" }> = {
      op: "component.patch",
      id: node.id,
      props: node.props,
      phase: node.phase ?? "ready",
      error: null,
    };
    if (node.actions) patch.actions = node.actions;
    operations.push(patch);
  });

  const header: Extract<SurfacePatchOperation, { op: "surface.patch" }> = {
    op: "surface.patch",
    status: "ready",
    actions: final.actions,
  };
  if (final.title !== shell.title) header.title = final.title;
  if (final.description !== undefined && final.description !== shell.description) {
    header.description = final.description;
  }
  if (final.kind !== shell.kind) header.kind = final.kind;
  if (!structurallyEqual(final.layout, shell.layout)) header.layout = final.layout;
  operations.push(header);

  return operations;
}

/**
 * Generation as a stream of protocol events.
 *
 * The shell is emitted as soon as a plan wins, so the interface is laid out and
 * labelled while the model is still working. Components follow individually —
 * from the token stream where the provider supports one — each validated and
 * grounded before it is allowed on screen. A final reconcile patch settles the
 * surface without discarding what the user is already looking at.
 *
 * The generator's return value carries the finished surface and its trace, so a
 * caller can persist and score exactly what the client rendered.
 */
export async function* streamSurface(
  context: CompileContext,
  options: StreamOptions,
): AsyncGenerator<SurfaceEvent, StreamResult> {
  const startedAt = Date.now();
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? defaultSurfaceId;
  const emitter = new SurfaceEventEmitter();
  const trace: CompileTraceEntry[] = [];
  const track = trackInto(trace);
  const surfaceId = newId();
  const timestamp = now().toISOString();
  const issues: GroundingIssue[] = [];

  const { understanding, selection } = await selectPlan(context, options, track);
  const plan = toUiPlan(selection.winner.candidate.plan, context);
  const shell = shellSurface(context, plan, surfaceId, timestamp);

  yield emitter.emit({ type: "surface.start", surface: shell });
  const timeToShellMs = Date.now() - startedAt;

  const catalog = await track(
    "catalog",
    `Narrow the catalogue for ${plan.surface}`,
    () =>
      buildCatalog(options.components, options.actions, {
        surface: plan.surface,
        intents: plan.componentIntents,
        limit: CATALOG_LIMIT,
      }),
  );

  const streamed: ComponentNode[] = [];
  const usedIds = new Set<string>();
  let timeToFirstComponentMs: number | null = null;
  let raw: unknown = null;
  let failure: string | null = null;

  const model = options.model;
  if (model?.streamSurface) {
    const parser = new IncrementalSurfaceParser();
    const generationStarted = Date.now();
    try {
      for await (const chunk of model.streamSurface(
        context,
        plan,
        catalog,
        options.signal,
      )) {
        const { nodes, header } = parser.push(chunk);

        if (header) {
          const operations = headerOperations(header);
          if (operations.length > 0) {
            yield emitter.emit({ type: "surface.patch", surfaceId, operations });
          }
        }

        for (const candidate of nodes) {
          const node = groundStreamedNode(candidate, shell, context, options, usedIds);
          if (!node) continue;
          streamed.push(node);
          usedIds.add(node.id);
          timeToFirstComponentMs ??= Date.now() - startedAt;
          yield emitter.emit({
            type: "component.add",
            surfaceId,
            parentId: null,
            node,
          });
        }
      }
      raw = JSON.parse(parser.text) as unknown;
    } catch (error) {
      failure = getErrorMessage(error);
    }
    trace.push({
      stage: "generate",
      durationMs: Date.now() - generationStarted,
      detail: `Stream ${plan.surface} with ${model.name}`,
    });
  } else if (model) {
    raw = await track("generate", `Generate ${plan.surface} with ${model.name}`, async () => {
      try {
        return await model.generateSurface(context, plan, catalog);
      } catch (error) {
        failure = getErrorMessage(error);
        return null;
      }
    });
  }

  let final: Surface | null = null;

  if (raw !== null && raw !== undefined) {
    final = await track("validate", "Validate against the OVXA UI Schema", () => {
      const candidate =
        typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? withRuntimeIdentity(
              raw as Record<string, unknown>,
              context,
              surfaceId,
              timestamp,
            )
          : raw;

      const parsed = safeParseSurface(candidate);
      if (parsed.ok) return parsed.surface;
      for (const issue of parsed.issues) {
        issues.push({ severity: "error", path: "schema", message: issue });
      }

      // One bad component must not cost the good ones.
      const salvaged = salvageSurface(raw, shell, context, options, surfaceId, timestamp);
      if (salvaged.surface) {
        issues.push({
          severity: "warning",
          path: "root",
          message: `Dropped ${salvaged.dropped} component(s) that failed validation; kept ${salvaged.surface.root.length}`,
        });
      }
      return salvaged.surface;
    });
  }

  /**
   * The document never closed, but these components already validated and
   * rendered. Keeping them beats replacing a half-built interface with a
   * generic one.
   */
  if (!final && streamed.length > 0) {
    final = { ...shell, root: [...streamed], status: "ready" };
    failure ??= "Generation ended before the surface document was complete";
  }

  if (final) {
    final = await track("ground", "Strip anything not in the registry", () => {
      const grounded = groundSurface(
        final as Surface,
        options.components,
        options.actions,
        { allowedActions: context.allowedActions },
      );
      issues.push(...grounded.issues);
      return grounded.surface;
    });
  }

  let usedFallback = false;
  if (!final || final.root.length === 0) {
    usedFallback = true;
    final = await track("fallback", "Compose the deterministic surface", () =>
      deterministicSurface(context, plan, options.components, surfaceId, timestamp),
    );
  }

  final = applyAppStyle(final, context);

  const operations = reconcile(shell, streamed, final);
  if (operations.length > 0) {
    yield emitter.emit({ type: "surface.patch", surfaceId, operations });
  }

  // A recoverable error is reported after the surface settles, so a client
  // shows a degraded-but-usable interface instead of an error screen.
  if (failure && !usedFallback) {
    yield emitter.emit({
      type: "surface.error",
      surfaceId,
      message: failure,
      recoverable: true,
    });
  }

  yield emitter.emit({ type: "surface.complete", surfaceId });

  return {
    surface: final,
    plan,
    issues,
    trace,
    usedFallback,
    model: usedFallback ? "deterministic" : (model?.name ?? "deterministic"),
    intelligence: {
      understanding,
      ranked: selection.ranked,
      selectedId: selection.winner.candidate.id,
      rationale: selection.rationale,
      surfaceScore: evaluateSurface(
        final,
        understanding,
        options.intelligence?.memory,
      ),
    },
    streamedComponents: streamed.length,
    timeToShellMs,
    timeToFirstComponentMs,
    elapsedMs: Date.now() - startedAt,
    degradedReason: failure,
  };
}

/** Drains a stream into its events and result. Useful in tests and replay. */
export async function collectStream(
  stream: AsyncGenerator<SurfaceEvent, StreamResult>,
): Promise<{ events: SurfaceEvent[]; result: StreamResult }> {
  const events: SurfaceEvent[] = [];
  let next = await stream.next();
  while (!next.done) {
    events.push(next.value);
    next = await stream.next();
  }
  return { events, result: next.value };
}
