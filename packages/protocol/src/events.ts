import { z } from "zod";
import {
  componentNodeSchema,
  jsonValueSchema,
  surfacePatchOperationSchema,
  surfaceSchema,
  surfaceStatuses,
} from "@ovxa/schema";

/**
 * The wire vocabulary for a streaming surface. A client that applies these in
 * order reconstructs exactly the surface the server holds, which is what makes
 * progressive rendering and replay the same code path.
 */
export const surfaceEventSchema = z.discriminatedUnion("type", [
  /** The shell: title, kind and layout, with no components yet. */
  z
    .object({
      type: z.literal("surface.start"),
      surface: surfaceSchema,
      seq: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("surface.patch"),
      surfaceId: z.string().min(1),
      operations: z.array(surfacePatchOperationSchema).min(1).max(200),
      seq: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("component.add"),
      surfaceId: z.string().min(1),
      parentId: z.string().min(1).nullable(),
      index: z.number().int().min(0).optional(),
      node: componentNodeSchema,
      seq: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("state.patch"),
      surfaceId: z.string().min(1),
      path: z.string().min(1),
      value: jsonValueSchema,
      seq: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("action.start"),
      surfaceId: z.string().min(1),
      actionId: z.string().min(1),
      seq: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("action.complete"),
      surfaceId: z.string().min(1),
      actionId: z.string().min(1),
      message: z.string().max(400).optional(),
      seq: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("action.error"),
      surfaceId: z.string().min(1),
      actionId: z.string().min(1),
      message: z.string().max(400),
      seq: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("surface.status"),
      surfaceId: z.string().min(1),
      status: z.enum(surfaceStatuses),
      seq: z.number().int().min(0),
    })
    .strict(),
  /** Terminal. No further events for this surface. */
  z
    .object({
      type: z.literal("surface.complete"),
      surfaceId: z.string().min(1),
      seq: z.number().int().min(0),
    })
    .strict(),
  /**
   * Generation failed but whatever already streamed stays on screen. The
   * client is expected to keep rendering, not to blank the surface.
   */
  z
    .object({
      type: z.literal("surface.error"),
      surfaceId: z.string().min(1),
      message: z.string().max(400),
      recoverable: z.boolean(),
      seq: z.number().int().min(0),
    })
    .strict(),
]);

export type SurfaceEvent = z.infer<typeof surfaceEventSchema>;
export type SurfaceEventType = SurfaceEvent["type"];

export function parseSurfaceEvent(value: unknown): SurfaceEvent {
  return surfaceEventSchema.parse(value);
}

export function safeParseSurfaceEvent(value: unknown): SurfaceEvent | null {
  const result = surfaceEventSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function isTerminalEvent(event: SurfaceEvent): boolean {
  return (
    event.type === "surface.complete" ||
    (event.type === "surface.error" && !event.recoverable)
  );
}
