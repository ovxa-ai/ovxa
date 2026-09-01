import type { CompileContext, SurfaceModel, UiPlan } from "@ovxa/compiler";
import type { LlmAdapter } from "@ovxa/llm";
import type { Catalog } from "@ovxa/registry";
import { SCHEMA_VERSION, safeParseSurface } from "@ovxa/schema";
import { normalizeSurfaceDraft, type ActionAllowlist } from "./normalize";
import {
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
} from "./prompt";

export {
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
} from "./prompt";
export { normalizeSurfaceDraft, type ActionAllowlist } from "./normalize";

/** Component name → the actions that component is allowed to invoke. */
function actionAllowlist(catalog: Catalog): ActionAllowlist {
  return new Map(
    catalog.components.map((entry) => [entry.name, new Set(entry.actions)]),
  );
}

/** One observable model round trip, for health reporting and the trace. */
export type SurfaceModelAttempt = {
  stage: "plan" | "generate" | "repair";
  outcome: "ok" | "invalid" | "failed";
  durationMs: number;
  reason?: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export type LlmSurfaceModelOptions = {
  adapter: LlmAdapter;
  /** Model id, surfaced in the compile result so operators know what ran. */
  model: string;
  temperature?: number;
  /**
   * Let the model contribute a competing plan. It is ranked against the Quality
   * Engine's own candidates and wins only on score. Costs one extra round trip.
   */
  proposePlan?: boolean;
  /**
   * Re-prompt once with the validation errors when the first surface does not
   * satisfy the schema. Off means one malformed response costs the fallback.
   */
  repairAttempts?: number;
  onAttempt?: (attempt: SurfaceModelAttempt) => void;
};

/**
 * Validation preview. The compiler owns the authoritative pass, but the model
 * needs to know whether its own output would survive it in order to repair the
 * response while the context is still cheap to re-send.
 */
function schemaIssues(draft: Record<string, unknown>, intent: string): string[] {
  const timestamp = new Date().toISOString();
  const result = safeParseSurface({
    ...draft,
    schemaVersion: SCHEMA_VERSION,
    id: "preflight",
    intent,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return result.ok ? [] : result.issues;
}

/**
 * Controls that cannot be operated.
 *
 * A schema-valid surface can still be useless: an OptionGrid with no
 * `selectOption` renders selectable cards that do nothing when clicked. The
 * registry already distinguishes these — a component that emits events and
 * declares actions is a control — so the omission is detectable, and worth one
 * more round trip because the alternative is an interface that lies about what
 * it can do.
 */
function operabilityIssues(
  draft: Record<string, unknown>,
  catalog: Catalog,
): string[] {
  const controls = new Map(
    catalog.components
      .filter((entry) => entry.events.length > 0 && entry.actions.length > 0)
      .map((entry) => [entry.name, entry.actions]),
  );
  const issues: string[] = [];

  const visit = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (typeof node !== "object" || node === null) continue;
      const record = node as Record<string, unknown>;
      const allowed = controls.get(String(record["type"]));
      const attached = Array.isArray(record["actions"]) ? record["actions"] : [];
      if (allowed && attached.length === 0) {
        issues.push(
          `<${String(record["type"])} id="${String(record["id"])}"> is a control with no actions. ` +
            `Add one of: ${allowed.join(", ")}.`,
        );
      }
      visit(record["children"]);
    }
  };
  visit(draft["root"]);
  return issues;
}

/**
 * The hosted generation stage.
 *
 * The model contributes semantic judgement — which surface shape, which
 * components, and the data the interface is about — and nothing structural.
 * Everything it returns is normalised here and validated again by the compiler,
 * so a bad generation degrades to a simpler surface instead of a broken one.
 */
export function createLlmSurfaceModel(options: LlmSurfaceModelOptions): SurfaceModel {
  const temperature = options.temperature ?? 0.3;
  const repairAttempts = options.repairAttempts ?? 1;

  const report = (attempt: SurfaceModelAttempt): void => {
    options.onAttempt?.(attempt);
  };

  const model: SurfaceModel = {
    name: options.model,

    async generateSurface(
      context: CompileContext,
      plan: UiPlan,
      catalog: Catalog,
    ): Promise<unknown> {
      const system = buildGenerateSystemPrompt();
      const user = buildGenerateUserPrompt({
        intent: context.intent,
        plan,
        state: context.state,
        catalog,
        locale: context.locale,
        ...(context.app ? { app: context.app } : {}),
      });

      const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        { role: "user", content: user },
      ];
      const allowlist = actionAllowlist(catalog);

      for (let attempt = 0; attempt <= repairAttempts; attempt += 1) {
        const started = Date.now();
        let raw: unknown;
        let usage: { inputTokens: number; outputTokens: number } | undefined;
        try {
          const response = await options.adapter.complete<unknown>({
            system,
            temperature,
            messages,
          });
          raw = response.output;
          usage = response.usage;
        } catch (error) {
          report({
            stage: attempt === 0 ? "generate" : "repair",
            outcome: "failed",
            durationMs: Date.now() - started,
            reason: error instanceof Error ? error.message : String(error),
          });
          return null;
        }

        const draft = normalizeSurfaceDraft(raw, allowlist);
        if (!draft) {
          report({
            stage: attempt === 0 ? "generate" : "repair",
            outcome: "invalid",
            durationMs: Date.now() - started,
            reason: "Response was not a surface object",
            ...(usage ? { usage } : {}),
          });
          return null;
        }

        const issues = [
          ...schemaIssues(draft, context.intent),
          ...operabilityIssues(draft, catalog),
        ];
        if (issues.length === 0) {
          report({
            stage: attempt === 0 ? "generate" : "repair",
            outcome: "ok",
            durationMs: Date.now() - started,
            ...(usage ? { usage } : {}),
          });
          return draft;
        }

        report({
          stage: attempt === 0 ? "generate" : "repair",
          outcome: "invalid",
          durationMs: Date.now() - started,
          reason: issues.slice(0, 5).join("; "),
          ...(usage ? { usage } : {}),
        });

        if (attempt === repairAttempts) {
          // Hand it over anyway: the compiler strips what fails and keeps the
          // rest, which is strictly more interface than returning nothing.
          return draft;
        }

        messages.push(
          { role: "assistant", content: JSON.stringify(raw) },
          {
            role: "user",
            content: [
              "That response did not pass validation:",
              ...issues.slice(0, 12).map((issue) => `- ${issue}`),
              "",
              "Return the corrected surface as one complete JSON object.",
              "Fix only what is listed; keep every component and every value that was valid.",
            ].join("\n"),
          },
        );
      }

      return null;
    },
  };

  /**
   * Token streaming, when the provider offers it.
   *
   * Streaming trades the repair loop for latency: there is no second round trip
   * to correct a malformed response, because components have already reached the
   * screen by the time the document ends. The compiler's per-component grounding
   * is what makes that safe — an invalid component is dropped rather than
   * repaired — and a document that never completes still leaves every valid
   * component that arrived before it failed.
   */
  const adapterStream = options.adapter.stream?.bind(options.adapter);
  if (adapterStream) {
    model.streamSurface = async function* streamSurface(
      context: CompileContext,
      plan: UiPlan,
      catalog: Catalog,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      const started = Date.now();
      let characters = 0;
      try {
        const chunks = adapterStream(
          {
            system: buildGenerateSystemPrompt(),
            temperature,
            messages: [
              {
                role: "user",
                content: buildGenerateUserPrompt({
                  intent: context.intent,
                  plan,
                  state: context.state,
                  catalog,
                  locale: context.locale,
                  ...(context.app ? { app: context.app } : {}),
                }),
              },
            ],
          },
          signal,
        );
        for await (const chunk of chunks) {
          characters += chunk.length;
          yield chunk;
        }
        report({
          stage: "generate",
          outcome: characters > 0 ? "ok" : "invalid",
          durationMs: Date.now() - started,
          ...(characters === 0 ? { reason: "Stream produced no output" } : {}),
        });
      } catch (error) {
        report({
          stage: "generate",
          outcome: "failed",
          durationMs: Date.now() - started,
          reason: error instanceof Error ? error.message : "Stream failed",
        });
        throw error;
      }
    };
  }

  if (options.proposePlan !== false) {
    model.planSurface = async (
      context: CompileContext,
      catalog: Catalog,
    ): Promise<unknown> => {
      const started = Date.now();
      try {
        const response = await options.adapter.complete<unknown>({
          system: buildPlanSystemPrompt(),
          temperature: 0,
          messages: [
            {
              role: "user",
              content: buildPlanUserPrompt({
                intent: context.intent,
                state: context.state,
                catalog,
                ...(context.app ? { app: context.app } : {}),
              }),
            },
          ],
        });
        report({
          stage: "plan",
          outcome: "ok",
          durationMs: Date.now() - started,
          usage: response.usage,
        });
        return response.output;
      } catch (error) {
        // A missing plan is not a failure: the Quality Engine already proposed
        // several, and the compiler ranks whatever it has.
        report({
          stage: "plan",
          outcome: "failed",
          durationMs: Date.now() - started,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };
  }

  return model;
}
