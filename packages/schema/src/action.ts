import { z } from "zod";
import { bindableSchema } from "./primitives";

/**
 * How much damage an action can do if the model chose it wrongly. The runtime
 * uses this to decide what needs confirmation or approval before it runs, so
 * it is part of the schema rather than a registry-only concern.
 */
export const actionRiskLevels = ["read", "low", "medium", "high"] as const;
export type ActionRisk = (typeof actionRiskLevels)[number];

export const actionStatuses = [
  "idle",
  "confirming",
  "running",
  "complete",
  "error",
  "blocked",
] as const;
export type ActionStatus = (typeof actionStatuses)[number];

export const confirmationSchema = z
  .object({
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(400),
    confirmLabel: z.string().min(1).max(40).default("Confirm"),
    cancelLabel: z.string().min(1).max(40).default("Cancel"),
    tone: z.enum(["default", "destructive"]).default("default"),
  })
  .strict();

export type Confirmation = z.infer<typeof confirmationSchema>;

/**
 * An action the generated surface may invoke. `id` must resolve to an action
 * registered by the host application: the runtime never executes anything the
 * model names that the registry does not already know about.
 */
export const actionSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
    description: z.string().max(240).optional(),
    input: z.record(z.string(), bindableSchema).default({}),
    variant: z
      .enum(["primary", "secondary", "ghost", "destructive"])
      .default("secondary"),
    risk: z.enum(actionRiskLevels).default("low"),
    confirm: confirmationSchema.optional(),
    status: z.enum(actionStatuses).default("idle"),
    /** Message shown when `status` is `error` or `blocked`. */
    statusDetail: z.string().max(400).optional(),
    /**
     * Applied to surface state the moment the user commits, before the host
     * responds, and rolled back automatically if the action fails.
     */
    optimistic: z
      .array(
        z
          .object({ path: z.string().min(1), value: bindableSchema })
          .strict(),
      )
      .max(16)
      .default([]),
  })
  .strict();

export type SurfaceAction = z.infer<typeof actionSchema>;

/**
 * What the host receives when a user interacts with generated UI. This is the
 * return path of the loop: generated interfaces emit semantic intent, not DOM
 * events.
 */
export const actionInvocationSchema = z
  .object({
    surfaceId: z.string().min(1),
    componentId: z.string().min(1).optional(),
    actionId: z.string().min(1),
    input: z.record(z.string(), z.unknown()).default({}),
    source: z.literal("generated-ui").default("generated-ui"),
    at: z.string().datetime(),
  })
  .strict();

export type ActionInvocation = z.infer<typeof actionInvocationSchema>;
