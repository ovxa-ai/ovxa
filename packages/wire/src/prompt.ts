import type { Catalog } from "@ovxa/registry";
import { WIRE_VERSION } from "./grammar";

/**
 * The Wire instructions, generated from whatever the host registered.
 *
 * Nothing here is hand-written per component. The catalogue already carries the
 * prop shapes, the semantic constraints and the permitted actions, so the prompt
 * is derived from it — which means registering a component is the only step
 * needed to make it generatable, and a component that was never registered can
 * never appear in the instructions.
 */

export function buildWireSyntax(): string {
  return [
    `Reply in OVXA Wire (${WIRE_VERSION}). No prose, no code fences, no JSON.`,
    "",
    "Grammar, one statement per line:",
    "  surface <kind> [columns 1-4] [narrow|regular|wide|full] [compact]",
    "  title <one line>",
    "  note <one line>            optional; why this surface answers the request",
    "  <ComponentType> <id>       a component; id is lowercase, unique, stable",
    "    <propName> <value>       indent two spaces; one prop per line",
    "    aria <text>              accessible label, for components that need one",
    "    act <actionId> <label>   attach a permitted action to this component",
    "  action <actionId> <label>  a surface-level action",
    "",
    "Values:",
    "  @path        read host state, e.g. `series @revenueByMonth`",
    "  true/false   boolean",
    "  42 / 3.5     number",
    "  [ ... ]      JSON array literal",
    "  { ... }      JSON object literal",
    "  anything else is the rest of the line as plain text — never quote it",
    "",
    "Bind to host state with @ wherever the data already exists. Never copy",
    "records, rows or series into the document: bound data is resolved at render",
    "time, so copying it is slower, longer, and the only way to get it wrong.",
    "",
    "Nest a component by indenting it two spaces further than its parent.",
  ].join("\n");
}

function describeProps(entry: Catalog["components"][number]): string {
  const names = Object.entries(entry.props).map(([key, type]) => {
    const required = entry.requiredProps.includes(key);
    return `${key}${required ? "" : "?"}:${type}`;
  });
  return names.length > 0 ? names.join(" ") : "(no props)";
}

/** The component menu, narrowed by the compiler before it reaches the model. */
export function buildWireCatalog(catalog: Catalog): string {
  const components = catalog.components.map((entry) => {
    const lines = [`${entry.name} — ${entry.description}`, `  props: ${describeProps(entry)}`];
    if (entry.actions.length > 0) {
      lines.push(`  actions: ${entry.actions.join(", ")}`);
    }
    if (entry.acceptsChildren) lines.push("  accepts nested components");
    for (const constraint of entry.constraints) {
      lines.push(`  · ${constraint}`);
    }
    return lines.join("\n");
  });

  const actions = catalog.actions.map(
    (action) =>
      `${action.id} — ${action.description}${action.confirm ? " (needs confirmation)" : ""}`,
  );

  return [
    "COMPONENTS — you may use these and no others:",
    "",
    components.join("\n\n"),
    "",
    actions.length > 0
      ? ["ACTIONS — you may reference these by id and no others:", "", actions.join("\n")].join("\n")
      : "ACTIONS — none are permitted for this request. Do not emit act or action lines.",
  ].join("\n");
}

/** A worked example, so the model sees the shape rather than only the rules. */
export function buildWireExample(): string {
  return [
    "Example, for an intent of \"how did Q2 revenue compare with Q1\" where host",
    "state has revenueDelta, mrrTrend, revenueByMonth and segments:",
    "",
    "surface dashboard 2 wide",
    "title Q2 revenue against Q1",
    "note Growth slowed on enterprise renewals rather than new business",
    "",
    "StatCard mrr",
    "  label Monthly recurring revenue",
    "  value $1.24M",
    "  delta @revenueDelta",
    "  trend @mrrTrend",
    "",
    "LineChart trend",
    "  aria Monthly revenue over twelve months",
    "  series @revenueByMonth",
    "  fill true",
    "",
    "RankedList segments",
    "  items @segments",
    "  unit $",
    "  act drillDown Investigate",
    "",
    "action exportData Export",
  ].join("\n");
}

export function buildWirePrompt(catalog: Catalog): string {
  return [
    "You choose and compose an interface. You do not write prose and you do not",
    "write code.",
    "",
    buildWireSyntax(),
    "",
    buildWireCatalog(catalog),
    "",
    buildWireExample(),
    "",
    "Rules:",
    "- Use only the components and actions listed above. Anything else is discarded.",
    "- Give every component a short, stable, lowercase id.",
    "- Bind to host state with @ instead of copying data.",
    "- Order components so the surface answers the request from the top down.",
    "- Stop when the task is answered. A shorter surface that completes the task",
    "  beats a longer one that buries it.",
  ].join("\n");
}
