import { z } from "zod";
import { actionSchema } from "./action";
import { collectComponentIds, componentNodeSchema } from "./component";
import { jsonValueSchema } from "./primitives";

export const SCHEMA_VERSION = "2.0" as const;

/**
 * The shape of the task, not the shape of the markup. The compiler picks a
 * kind first and lets it constrain which components are even eligible, which
 * is what keeps generated interfaces from turning into arbitrary div soup.
 */
export const surfaceKinds = [
  "dashboard",
  "comparison",
  "form",
  "workflow",
  "detail",
  "list",
  "confirmation",
  "result",
  "empty",
] as const;
export type SurfaceKind = (typeof surfaceKinds)[number];

export const surfaceStatuses = [
  "planning",
  "streaming",
  "ready",
  "updating",
  "awaiting_input",
  "complete",
  "failed",
] as const;
export type SurfaceStatus = (typeof surfaceStatuses)[number];

export const layoutSchema = z
  .object({
    columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
    density: z.enum(["comfortable", "compact"]).default("comfortable"),
    maxWidth: z.enum(["narrow", "regular", "wide", "full"]).default("regular"),
  })
  .strict();

export type SurfaceLayout = z.infer<typeof layoutSchema>;

export const surfaceSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1).max(80),
    /** The user goal this surface exists to complete. */
    intent: z.string().min(1).max(500),
    kind: z.enum(surfaceKinds),
    title: z.string().min(1).max(140),
    description: z.string().max(400).optional(),
    layout: layoutSchema,
    root: z.array(componentNodeSchema).max(200),
    /** Data the surface owns. Component props bind into this graph. */
    state: z.record(z.string(), jsonValueSchema).default({}),
    /** Surface-level actions, rendered outside any single component. */
    actions: z.array(actionSchema).max(24).default([]),
    status: z.enum(surfaceStatuses),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type Surface = z.infer<typeof surfaceSchema>;

export class SurfaceValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "SurfaceValidationError";
  }
}

/**
 * Structural checks Zod cannot express. Duplicate component ids are the
 * dangerous one: reconciliation addresses nodes by id, so a duplicate makes
 * every later patch ambiguous.
 */
function structuralIssues(surface: Surface): string[] {
  const issues: string[] = [];
  const ids = collectComponentIds(surface.root);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    issues.push(`Duplicate component ids: ${[...new Set(duplicates)].join(", ")}`);
  }
  const actionIds = surface.actions.map((action) => action.id);
  const duplicateActions = actionIds.filter(
    (id, index) => actionIds.indexOf(id) !== index,
  );
  if (duplicateActions.length > 0) {
    issues.push(
      `Duplicate surface action ids: ${[...new Set(duplicateActions)].join(", ")}`,
    );
  }
  // A surface that is still planning or streaming has no components yet by
  // design; only a settled surface is expected to have rendered something.
  const settled =
    surface.status !== "planning" &&
    surface.status !== "streaming" &&
    surface.status !== "failed";
  if (settled && surface.kind !== "empty" && surface.root.length === 0) {
    issues.push(`Surface kind "${surface.kind}" must render at least one component`);
  }
  return issues;
}

export function parseSurface(value: unknown): Surface {
  const result = surfaceSchema.safeParse(value);
  if (!result.success) {
    throw new SurfaceValidationError(
      "Generated surface does not match the OVXA UI Schema",
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  const issues = structuralIssues(result.data);
  if (issues.length > 0) {
    throw new SurfaceValidationError("Generated surface is structurally invalid", issues);
  }
  return result.data;
}

export function safeParseSurface(
  value: unknown,
): { ok: true; surface: Surface } | { ok: false; issues: string[] } {
  try {
    return { ok: true, surface: parseSurface(value) };
  } catch (error) {
    if (error instanceof SurfaceValidationError) {
      return { ok: false, issues: error.issues };
    }
    throw error;
  }
}
