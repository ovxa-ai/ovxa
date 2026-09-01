import { z } from "zod";
import { surfaceKinds, type JsonValue } from "@ovxa/schema";
import { componentIntents } from "@ovxa/registry";
import type { AppLearning } from "@ovxa/intelligence";

/**
 * The semantic decision made before any markup exists: what kind of surface
 * the goal needs, what the user must be able to do, and which component
 * intents that implies. Planning separately from generation is what stops the
 * model from reaching for whatever component it saw first.
 *
 * Plans are proposed and ranked by `@ovxa/intelligence`; this schema is the
 * validated shape the compiler will accept, whoever authored it.
 */
export const uiPlanSchema = z
  .object({
    surface: z.enum(surfaceKinds),
    title: z.string().min(1).max(140),
    rationale: z.string().min(1).max(400),
    /** Ordered, user-facing outcomes this surface must support. */
    objectives: z.array(z.string().min(1).max(160)).min(1).max(8),
    componentIntents: z.array(z.enum(componentIntents)).min(1).max(8),
    /** Registered action ids the surface is expected to expose. */
    actions: z.array(z.string().min(1).max(80)).max(12).default([]),
  })
  .strict();

export type UiPlan = z.infer<typeof uiPlanSchema>;

export type CompileContext = {
  intent: string;
  /** Application/agent data the surface may bind to. */
  state: Record<string, JsonValue>;
  /** Action ids the caller permits for this request. */
  allowedActions: readonly string[];
  locale?: string;
  /** Host style, signed-in user, and product flows this surface must belong to. */
  app?: AppLearning;
};

/**
 * Keeps a model-authored plan inside the bounds the caller allows. Actions the
 * host did not permit are dropped rather than rejected, so one bad action
 * suggestion does not cost the whole plan.
 */
export function groundPlan(plan: UiPlan, context: CompileContext): UiPlan {
  const allowed = new Set(context.allowedActions);
  return {
    ...plan,
    actions: plan.actions.filter((action) => allowed.has(action)),
  };
}
