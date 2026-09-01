import type { Catalog } from "@ovxa/registry";
import type { JsonValue } from "@ovxa/schema";
import { surfaceKinds } from "@ovxa/schema";
import { componentIntents } from "@ovxa/registry";
import { describeAppForPrompt, type AppLearning } from "@ovxa/intelligence";

/**
 * Prompt construction for the hosted generation stage.
 *
 * The catalogue is rendered as a compact contract rather than prose. Everything
 * the model is told here is enforced again by the compiler afterwards, so the
 * prompt exists to raise the hit rate, never to provide a guarantee.
 */

function describeComponent(entry: Catalog["components"][number]): string {
  const props = Object.entries(entry.props)
    .map(([name, type]) => {
      const required = entry.requiredProps.includes(name);
      return `${name}${required ? "" : "?"}: ${type}`;
    })
    .join(", ");
  const lines = [`- ${entry.name}({ ${props} })`, `    ${entry.description}`];
  if (entry.actions.length > 0) {
    const control = entry.events.length > 0 ? " — REQUIRED, this is a control" : "";
    lines.push(`    actions: ${entry.actions.join(", ")}${control}`);
  }
  if (entry.acceptsChildren) {
    lines.push(`    accepts children`);
  }
  for (const constraint of entry.constraints) {
    lines.push(`    constraint: ${constraint}`);
  }
  return lines.join("\n");
}

function describeCatalog(catalog: Catalog): string {
  const components = catalog.components.map(describeComponent).join("\n");
  const actions = catalog.actions
    .map((action) => `- ${action.id} (${action.risk}) — ${action.description}`)
    .join("\n");
  return `COMPONENTS (the only component types that exist):\n${components}\n\nACTIONS (the only action ids that exist):\n${actions}`;
}

/** A short, truthful description of what the host already put in state. */
function describeHostState(state: Record<string, JsonValue>): string {
  const keys = Object.keys(state);
  if (keys.length === 0) {
    return [
      "HOST STATE: empty.",
      "The host supplied no data, so you must author the data this surface shows.",
      "Produce specific, realistic, internally consistent values — real-looking names,",
      "figures, dates and units for this exact request. Never emit filler such as",
      '"Item 1", "Lorem ipsum", "Option A", "N/A", "TBD" or "example.com".',
    ].join("\n");
  }
  const preview = JSON.stringify(state).slice(0, 4000);
  return [
    `HOST STATE (authoritative — bind to it, never restate or contradict it):`,
    preview,
    "Add new keys only for data the host did not supply.",
  ].join("\n");
}

const SURFACE_RULES = `
OUTPUT CONTRACT — return one JSON object, nothing else, with the keys IN THIS ORDER:

{
  "kind": one of ${surfaceKinds.join(" | ")},
  "title": string (<=140 chars, names the task, not the UI),
  "description": string (<=400 chars, one sentence on what the user can do here),
  "layout": { "columns": 1|2|3|4, "density": "comfortable"|"compact", "maxWidth": "narrow"|"regular"|"wide"|"full" },
  "root": array of component nodes,
  "actions": array of surface-level actions (usually []),
  "state": object — ALL data this surface displays
}

KEY ORDER MATTERS. Your response is streamed to the user's screen as you write it,
and each component appears the moment you finish it. "root" therefore comes before
"state": the interface renders while you are still writing the data, and the data
fills in behind it. Emitting "state" first means the user watches a blank screen
for as long as the data takes.

COMPONENT NODE:
{
  "id": unique, matches ^[A-Za-z0-9_:-]+$,
  "type": a component name from COMPONENTS,
  "props": { propName: literal | { "$bind": "dotted.state.path" } },
  "children": [ ... ]        // only where the component accepts children
  "actions": [ ... ]         // only ids from ACTIONS
  "a11y": { "label": string }  // required where noted
}

ACTION:
{ "id": from ACTIONS, "label": short verb phrase, "variant": "primary"|"secondary"|"ghost"|"destructive" }

HARD RULES
1. Data lives in "state". Props reference it with { "$bind": "path" }. Do not inline
   arrays or objects into props — bind them. Short scalars like a caption may be literal.
2. Every $bind path must resolve against the "state" object you emit.
3. Use only component types listed in COMPONENTS and only action ids listed in ACTIONS.
   Anything else is stripped and the user sees less.
4. Respect each component's prop types exactly. Numbers are numbers, not "1,240".
5. THE SURFACE MUST BE OPERABLE. A component whose COMPONENTS entry lists actions is a
   control, not a picture. Give it those actions, or the user is left with something
   that looks interactive and does nothing. In particular:
   - OptionGrid is how the user chooses. It needs the selectOption action, its
     selectedId bound, and state.selectedId seeded (null when nothing is chosen yet).
   - FieldSet needs setField, and submit when the form can be completed.
   - FilterBar needs setFilter. SummaryPanel needs confirm when a decision is committed.
6. Component ids are unique across the whole tree.
7. Build the smallest interface that finishes the task. Three well-chosen components
   beat eight. Do not add a component just because it is available.
8. Where a component requiresLabel, supply a11y.label.

WORKED EXAMPLE — the shape, not the content:

{
  "kind": "comparison",
  "title": "Three plans for a team of 12",
  "description": "Compare the tiers on price and limits, then pick one.",
  "layout": { "columns": 2, "density": "comfortable", "maxWidth": "wide" },
  "root": [
    { "id": "choose", "type": "OptionGrid",
      "props": { "options": { "$bind": "plans" }, "selectedId": { "$bind": "selectedId" } },
      "actions": [ { "id": "selectOption", "label": "Choose this plan", "variant": "primary" } ] },
    { "id": "annual", "type": "BarChart",
      "props": { "series": { "$bind": "spend" }, "unit": " USD" },
      "a11y": { "label": "Annual spend for 12 seats" } }
  ],
  "actions": [],
  "state": {
    "selectedId": null,
    "plans": [
      { "id": "starter", "title": "Starter", "price": "$29", "cadence": "/user/mo",
        "features": ["10 GB storage", "Email support"] },
      { "id": "growth", "title": "Growth", "price": "$59", "cadence": "/user/mo",
        "badge": "Best fit", "recommended": true,
        "features": ["100 GB storage", "Priority support", "SSO"] }
    ],
    "spend": [ { "label": "Starter", "value": 4176 }, { "label": "Growth", "value": 8496 } ]
  }
}

Answer with JSON only. No prose, no markdown fence.
`.trim();

export function buildGenerateSystemPrompt(): string {
  return [
    "You are the generation stage of the OVXA UI compiler.",
    "",
    "You are given a user intent and a plan chosen by the Quality Engine, and you",
    "return one declarative surface: a component tree plus the data it renders.",
    "You are not writing code, markup or prose — you are filling a validated schema.",
    "When a CUSTOMER APPLICATION contract is provided, the surface must look, read and flow as if it already belonged to that host product. New generative flows reuse its vocabulary, density and learned journeys. Do not emit OVXA kit demos (health plans, trip itineraries) unless those nouns are in the customer vocabulary.",
    "",
    "The compiler validates everything you return against the component registry.",
    "Unregistered components, mistyped props and unknown actions are deleted, so a",
    "careless answer costs the user working interface.",
    "",
    SURFACE_RULES,
  ].join("\n");
}

export function buildGenerateUserPrompt(input: {
  intent: string;
  plan: {
    surface: string;
    title: string;
    rationale: string;
    objectives: readonly string[];
    componentIntents: readonly string[];
    actions: readonly string[];
  };
  state: Record<string, JsonValue>;
  catalog: Catalog;
  locale?: string | undefined;
  app?: AppLearning;
}): string {
  const sections = [
    `USER INTENT: ${input.intent}`,
    "",
    "SELECTED PLAN (the Quality Engine already decided this — implement it):",
    `  surface kind: ${input.plan.surface}`,
    `  working title: ${input.plan.title}`,
    `  why: ${input.plan.rationale}`,
    `  the user must be able to: ${input.plan.objectives.join("; ")}`,
    `  component intents: ${input.plan.componentIntents.join(", ")}`,
    `  permitted actions: ${input.plan.actions.length > 0 ? input.plan.actions.join(", ") : "(none requested — add only what the task needs)"}`,
    "",
    describeHostState(input.state),
    "",
    describeCatalog(input.catalog),
  ];
  if (input.app) {
    sections.push("", describeAppForPrompt(input.app));
  }
  if (input.locale) sections.push("", `LOCALE: ${input.locale}`);
  return sections.join("\n");
}

const PLAN_RULES = `
Return one JSON object, nothing else:

{
  "surface": one of ${surfaceKinds.join(" | ")},
  "title": string (<=140 chars),
  "rationale": string (<=400 chars) — why this shape of interface finishes this task,
  "objectives": [1-8 strings] — what the user must be able to DO, in order,
  "componentIntents": [1-8 of ${componentIntents.join(" | ")}],
  "actions": [action ids the surface should expose, from the list given]
}

Choose the surface kind from the task, not from the data:
  comparison — the user must weigh options against each other before choosing
  form       — something is unknown and must be collected before anything can happen
  dashboard  — the user is monitoring or diagnosing across several measures
  workflow   — the task has ordered steps with a current position
  detail     — one entity examined in depth
  list       — many similar items to scan or filter
  confirmation — one consequential decision to review and commit
  result     — the task is finished and the outcome must be understood

Answer with JSON only.
`.trim();

export function buildPlanSystemPrompt(): string {
  return [
    "You are the planning stage of the OVXA UI compiler.",
    "",
    "Before any interface is generated, you decide what shape of interface the task",
    "needs. Your plan competes against plans proposed by the Quality Engine and is",
    "scored against them, so argue with the plan itself, not with adjectives.",
    "",
    PLAN_RULES,
  ].join("\n");
}

export function buildPlanUserPrompt(input: {
  intent: string;
  state: Record<string, JsonValue>;
  catalog: Catalog;
  app?: AppLearning;
}): string {
  const sections = [
    `USER INTENT: ${input.intent}`,
    "",
    describeHostState(input.state),
    "",
    `AVAILABLE COMPONENT TYPES: ${input.catalog.components.map((entry) => entry.name).join(", ")}`,
    `AVAILABLE ACTION IDS: ${input.catalog.actions.map((action) => action.id).join(", ")}`,
  ];
  if (input.app) {
    sections.push("", describeAppForPrompt(input.app));
  }
  return sections.join("\n");
}
