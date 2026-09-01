import { z } from "zod";
import type { ActionInvocation, ActionRisk, JsonValue } from "@ovxa/schema";

export type ActionHandler<TInput> = (
  input: TInput,
  context: ActionContext,
) => Promise<ActionOutcome> | ActionOutcome;

export type ActionContext = {
  surfaceId: string;
  componentId: string | undefined;
  /** Current surface state, read-only. */
  state: Readonly<Record<string, JsonValue>>;
};

/**
 * What a handler gives back. `statePatch` lets an action update the surface
 * without a model round trip, which is how most interactions stay instant.
 */
export type ActionOutcome = {
  statePatch?: Record<string, JsonValue>;
  message?: string;
  /** Ask the compiler for a new/updated surface because intent has moved on. */
  recompile?: { intent: string } | undefined;
};

export interface ActionDefinition<TInput = unknown> {
  id: string;
  description: string;
  input: z.ZodType<TInput>;
  risk: ActionRisk;
  /** Requires explicit user confirmation before the handler runs. */
  confirm: boolean;
  handler: ActionHandler<TInput>;
}

export type ActionInput<TInput> = {
  id: string;
  description: string;
  input: z.ZodType<TInput>;
  handler: ActionHandler<TInput>;
  risk?: ActionRisk;
  confirm?: boolean;
};

export function defineAction<TInput>(
  input: ActionInput<TInput>,
): ActionDefinition<TInput> {
  const risk = input.risk ?? "low";
  return {
    id: input.id,
    description: input.description,
    input: input.input,
    handler: input.handler,
    risk,
    // High-risk actions default to confirmed even if the author forgot.
    confirm: input.confirm ?? risk === "high",
  };
}

export type DispatchResult =
  | { ok: true; outcome: ActionOutcome }
  | { ok: false; reason: string; issues?: string[] };

/**
 * The only path from generated UI to application code. A model can name an
 * action; it can never supply one. Unregistered ids and malformed input are
 * rejected before any handler runs.
 */
export class ActionRegistry {
  private readonly actions = new Map<string, ActionDefinition>();

  register<TInput>(definition: ActionDefinition<TInput>): this {
    if (this.actions.has(definition.id)) {
      throw new Error(`Action "${definition.id}" is already registered`);
    }
    this.actions.set(definition.id, definition as ActionDefinition);
    return this;
  }

  has(id: string): boolean {
    return this.actions.has(id);
  }

  get(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  list(): ActionDefinition[] {
    return [...this.actions.values()];
  }

  ids(): string[] {
    return [...this.actions.keys()].sort();
  }

  async dispatch(
    invocation: ActionInvocation,
    context: ActionContext,
  ): Promise<DispatchResult> {
    const definition = this.actions.get(invocation.actionId);
    if (!definition) {
      return {
        ok: false,
        reason: `Action "${invocation.actionId}" is not registered`,
      };
    }
    const parsed = definition.input.safeParse(invocation.input);
    if (!parsed.success) {
      return {
        ok: false,
        reason: `Input for "${invocation.actionId}" failed validation`,
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      };
    }
    try {
      const outcome = await definition.handler(parsed.data, context);
      return { ok: true, outcome };
    } catch (error) {
      // Handler internals never reach the browser.
      return {
        ok: false,
        reason: `Action "${invocation.actionId}" failed`,
      };
    }
  }
}

export function createActionRegistry(): ActionRegistry {
  return new ActionRegistry();
}
