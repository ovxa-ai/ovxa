import { z } from "zod";
import {
  createActionRegistry,
  defineAction,
  type ActionRegistry,
} from "@ovxa/registry";
import type { JsonValue } from "@ovxa/schema";

/**
 * The actions the reference host exposes to generated surfaces. A model may
 * name any of these; it can never introduce a new one, and every handler
 * validates its own input before touching state.
 */
export function createSurfaceActions(): ActionRegistry {
  return createActionRegistry()
    .register(
      defineAction({
        id: "selectOption",
        description: "Select one option from a set the surface is showing.",
        input: z.object({ id: z.string().min(1) }),
        handler: (input) => ({
          statePatch: { selectedId: input.id },
          message: `Selected ${input.id}`,
        }),
      }),
    )
    .register(
      defineAction({
        id: "setFilter",
        description: "Change one filter and let the surface recompute.",
        input: z.object({ id: z.string().min(1), value: z.string() }),
        handler: (input, context) => {
          const filters = context.state["filters"];
          const current =
            typeof filters === "object" && filters !== null && !Array.isArray(filters)
              ? (filters as Record<string, JsonValue>)
              : {};
          return { statePatch: { filters: { ...current, [input.id]: input.value } } };
        },
      }),
    )
    .register(
      defineAction({
        id: "setField",
        description: "Update one form field.",
        input: z.object({ id: z.string().min(1), value: z.string() }),
        handler: (input, context) => {
          const form = context.state["form"];
          const current =
            typeof form === "object" && form !== null && !Array.isArray(form)
              ? (form as Record<string, JsonValue>)
              : {};
          return { statePatch: { form: { ...current, [input.id]: input.value } } };
        },
      }),
    )
    .register(
      defineAction({
        id: "confirm",
        description: "Commit the decision the surface is presenting.",
        input: z.object({}).passthrough(),
        risk: "medium",
        handler: () => ({
          statePatch: { confirmed: true },
          message: "Confirmed",
        }),
      }),
    )
    .register(
      defineAction({
        id: "submit",
        description: "Submit the collected form and move the task forward.",
        input: z.object({}).passthrough(),
        risk: "medium",
        handler: () => ({ statePatch: { submitted: true }, message: "Submitted" }),
      }),
    )
    .register(
      defineAction({
        id: "dismiss",
        description: "Dismiss a recommendation without acting on it.",
        input: z.object({}).passthrough(),
        handler: () => ({ statePatch: { dismissed: true } }),
      }),
    )
    .register(
      defineAction({
        id: "drillDown",
        description:
          "Investigate one item in depth. The surface is rebuilt around that subject.",
        input: z.object({ id: z.string().min(1), label: z.string().optional() }),
        handler: (input) => ({
          statePatch: { focusId: input.id },
          // The user has changed the question, not just the data, so this is
          // one of the few interactions worth a new generation.
          recompile: {
            intent: `Investigate ${input.label ?? input.id} in detail and explain what is driving it`,
          },
        }),
      }),
    )
    .register(
      defineAction({
        id: "changePeriod",
        description: "Change the time range the surface covers.",
        input: z.object({ period: z.string().min(1) }),
        handler: (input) => ({
          statePatch: { period: input.period },
          message: `Showing ${input.period}`,
        }),
      }),
    )
    .register(
      defineAction({
        id: "approve",
        description: "Approve the pending decision and let the work proceed.",
        input: z.object({ id: z.string().optional(), note: z.string().optional() }),
        risk: "high",
        handler: (input) => ({
          statePatch: { approval: { status: "approved", id: input.id ?? null } },
          message: "Approved",
        }),
      }),
    )
    .register(
      defineAction({
        id: "reject",
        description: "Reject the pending decision and stop the work.",
        input: z.object({ id: z.string().optional(), reason: z.string().optional() }),
        risk: "medium",
        handler: (input) => ({
          statePatch: { approval: { status: "rejected", id: input.id ?? null } },
          message: "Rejected",
        }),
      }),
    )
    .register(
      defineAction({
        id: "retryTool",
        description: "Run a failed tool call again.",
        input: z.object({ tool: z.string().min(1) }),
        risk: "medium",
        handler: (input) => ({
          statePatch: { retrying: input.tool },
          message: `Retrying ${input.tool}`,
        }),
      }),
    )
    .register(
      defineAction({
        id: "openSource",
        description: "Open a cited source so the user can verify a claim.",
        input: z.object({ id: z.string().min(1) }),
        handler: (input) => ({ statePatch: { openedSourceId: input.id } }),
      }),
    )
    .register(
      defineAction({
        id: "exportData",
        description: "Export what the surface is showing.",
        input: z.object({ format: z.enum(["csv", "json", "pdf"]).optional() }),
        handler: (input) => ({
          statePatch: { exported: input.format ?? "csv" },
          message: `Exported as ${(input.format ?? "csv").toUpperCase()}`,
        }),
      }),
    );
}
