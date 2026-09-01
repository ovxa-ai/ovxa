import { SCHEMA_VERSION, safeParseSurface, type Surface } from "@ovxa/schema";
import { buildCatalog } from "@ovxa/registry";
import {
  evaluateSurface,
  type CandidateEvaluation,
  type IntelligenceReport,
  type PlanDraft,
} from "@ovxa/intelligence";
import type { CompileContext, UiPlan } from "./plan";
import { groundSurface, type GroundingIssue } from "./validate";
import {
  CATALOG_LIMIT,
  applyAppStyle,
  defaultSurfaceId,
  deterministicSurface,
  mergeState,
  selectPlan,
  toUiPlan,
  trackInto,
  type CompileTraceEntry,
  type CompilerOptions,
} from "./phases";

/**
 * One candidate taken all the way to a real surface. Scoring a compiled
 * surface, rather than only its plan, is what lets the Quality Engine reject a
 * plan that looked good but grounded badly.
 */
export type CompiledAttempt = {
  candidateId: string;
  plan: UiPlan;
  surface: Surface;
  issues: GroundingIssue[];
  usedFallback: boolean;
  score: CandidateEvaluation;
};

export type CompileResult = {
  surface: Surface;
  plan: UiPlan;
  issues: GroundingIssue[];
  trace: CompileTraceEntry[];
  /** True when the deterministic surface was used instead of the model's. */
  usedFallback: boolean;
  model: string;
  /** Why this interface won — the Quality Engine's decision, not a render log. */
  intelligence: IntelligenceReport;
  /** Every candidate that was compiled, best first. Length 1 unless compileTopK > 1. */
  attempts: CompiledAttempt[];
};

/**
 * Intent → context → candidate plans → evaluation → selection → generation
 * → validation → grounding → surface.
 *
 * The Quality Engine participates before anything is compiled. A model can
 * still propose a plan or a surface; it cannot skip the ranking.
 */
export async function compileSurface(
  context: CompileContext,
  options: CompilerOptions,
): Promise<CompileResult> {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? defaultSurfaceId;
  const trace: CompileTraceEntry[] = [];
  const surfaceId = newId();
  const timestamp = now().toISOString();
  const intel = options.intelligence;

  const { understanding, selection } = await selectPlan(
    context,
    options,
    trackInto(trace),
  );

  /**
   * Takes one ranked plan all the way to a grounded surface. Isolated so the
   * compiler can run it over several candidates and compare real output.
   *
   * Candidates compile concurrently, so each one records into its own buffer
   * and the buffers are appended in rank order afterwards. A shared array
   * would interleave and make the trace unreadable.
   */
  const compileCandidate = async (
    candidateId: string,
    draft: PlanDraft,
    id: string,
    sink: CompileTraceEntry[],
  ): Promise<CompiledAttempt> => {
    const track = trackInto(sink);
    const plan = toUiPlan(draft, context);
    const issues: GroundingIssue[] = [];

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

    const raw = options.model
      ? await track(
          "generate",
          `Generate ${plan.surface} with ${options.model.name}`,
          async () => {
            try {
              return await options.model?.generateSurface(context, plan, catalog);
            } catch {
              return null;
            }
          },
        )
      : null;

    let surface: Surface | null = null;

    if (raw !== null && raw !== undefined) {
      surface = await track("validate", "Validate against the OVXA UI Schema", () => {
        const withIdentity =
          typeof raw === "object" && raw !== null
            ? {
                ...(raw as Record<string, unknown>),
                // Identity, timing, intent and status belong to the runtime,
                // never the model. Status is the easy one to forget: a model
                // that invents a status value would otherwise fail the whole
                // document over a field it was never entitled to set.
                schemaVersion: SCHEMA_VERSION,
                id,
                intent: context.intent,
                state: mergeState(raw, context.state),
                status: "ready",
                createdAt: timestamp,
                updatedAt: timestamp,
              }
            : raw;
        const parsed = safeParseSurface(withIdentity);
        if (parsed.ok) return parsed.surface;
        for (const issue of parsed.issues) {
          issues.push({ severity: "error", path: "schema", message: issue });
        }
        return null;
      });
    }

    if (surface) {
      surface = await track("ground", "Strip anything not in the registry", () => {
        const grounded = groundSurface(
          surface as Surface,
          options.components,
          options.actions,
          { allowedActions: context.allowedActions },
        );
        issues.push(...grounded.issues);
        return grounded.surface;
      });
    }

    let usedFallback = false;
    if (!surface || surface.root.length === 0) {
      usedFallback = true;
      surface = await track("fallback", "Compose the deterministic surface", () =>
        deterministicSurface(context, plan, options.components, id, timestamp),
      );
    }

    const styled = applyAppStyle(surface, context);
    return {
      candidateId,
      plan,
      surface: styled,
      issues,
      usedFallback,
      score: evaluateSurface(styled, understanding, intel?.memory),
    };
  };

  const topK = Math.max(1, Math.min(intel?.compileTopK ?? 1, selection.ranked.length));
  const shortlist = selection.ranked
    .filter((entry) => !entry.evaluation.vetoed)
    .slice(0, topK);
  const toCompile = shortlist.length > 0 ? shortlist : [selection.winner];

  const buffers = toCompile.map((): CompileTraceEntry[] => []);
  const attempts = await Promise.all(
    toCompile.map((entry, index) =>
      compileCandidate(
        entry.candidate.id,
        entry.candidate.plan,
        index === 0 ? surfaceId : `${surfaceId}_k${index}`,
        buffers[index] ?? [],
      ),
    ),
  );
  for (const buffer of buffers) trace.push(...buffer);

  // A compiled surface that fell back is a weaker result than one the model
  // actually produced, even when the raw scores are close.
  const ranked = [...attempts].sort((a, b) => {
    if (a.usedFallback !== b.usedFallback) return a.usedFallback ? 1 : -1;
    return b.score.total - a.score.total;
  });

  const best = ranked[0];
  if (!best) throw new Error("compileSurface produced no candidate");

  if (attempts.length > 1) {
    trace.push({
      stage: "select",
      durationMs: 0,
      detail: `Compiled ${attempts.length} candidates; kept ${best.plan.surface}`,
    });
  }

  const intelligence: IntelligenceReport = {
    understanding,
    ranked: selection.ranked,
    selectedId: best.candidateId,
    rationale:
      attempts.length > 1
        ? `${selection.rationale} Compiled ${attempts.length} candidates and kept the strongest surface.`
        : selection.rationale,
    surfaceScore: best.score,
  };

  return {
    surface: best.surface,
    plan: best.plan,
    issues: best.issues,
    trace,
    usedFallback: best.usedFallback,
    model: best.usedFallback
      ? "deterministic"
      : (options.model?.name ?? "deterministic"),
    intelligence,
    attempts: ranked,
  };
}
