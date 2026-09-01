import type { SurfaceKind } from "@ovxa/schema";

/**
 * What OVXA learned about the host application — the visual contract, the
 * person in the seat, and the flows the product already has. Generation reads
 * this the same way it reads intent: as a constraint, not as decoration.
 *
 * Without it, every surface is a generic kit. With it, a new flow has to feel
 * like it already lived in the product.
 */

export type VisualDensity = "comfortable" | "compact";

export type VisualSource = "host" | "fallback";

export type VisualContract = {
  background: string;
  foreground: string;
  surface: string;
  border: string;
  muted: string;
  accent: string;
  onAccent: string;
  fontSans: string;
  fontMono: string;
  fontSize: string;
  radius: string;
  density: VisualDensity;
};

export type UserContract = {
  id: string;
  name: string;
  role: string;
  permissions: readonly string[];
};

export type LearnedFlow = {
  id: string;
  name: string;
  /** Capability steps in the order the product already uses them. */
  steps: string[];
  suggestedKind: SurfaceKind;
  /** An intent that would regenerate this flow as a generative surface. */
  intent: string;
};

export type ProductKnowledge = {
  name: string;
  visual?: VisualContract;
  pages: ReadonlyArray<{ name: string }>;
  entities: ReadonlyArray<{ name: string }>;
  fields?: ReadonlyArray<{ name: string }>;
  workflows: ReadonlyArray<{
    id?: string;
    name: string;
    capabilityIds: readonly string[];
  }>;
  capabilities: ReadonlyArray<{
    name: string;
    action?: string;
    entity?: string;
    risk?: string;
    permissions?: readonly string[];
  }>;
};

export type AppLearning = {
  productName: string;
  /** True when pages, entities, workflows or capabilities were observed. */
  observed: boolean;
  /** Host tokens when captured; OVXA chrome otherwise — never treat fallback as the product. */
  visualSource: VisualSource;
  visual: VisualContract;
  user?: UserContract;
  flows: LearnedFlow[];
  /** Flows whose names or steps overlap this intent, strongest first. */
  matchedFlows: LearnedFlow[];
  /** Product nouns the surface must speak — pages, entities, capabilities. */
  vocabulary: string[];
};

/** Compact host state so a learned intent has product nouns to bind to. */
export type HostLearningSnapshot = {
  product: string;
  vocabulary: string[];
  flows: Array<{ name: string; kind: string; steps: string[] }>;
};

const MAX_FLOWS = 10;
const MAX_VOCAB = 32;
const MAX_MATCHED = 3;

/**
 * OVXA's own visual contract. Studio chrome only — never a stand-in for the
 * customer's product. Generated surfaces inherit this only when the host has
 * not been observed yet and no explicit visual was supplied.
 */
export function ovxaVisualContract(): VisualContract {
  return {
    background: "#0a0a0a",
    foreground: "#f5f5f5",
    surface: "#101010",
    border: "#2b2b2b",
    muted: "#b3b3b3",
    accent: "#fafafa",
    onAccent: "#0a0a0a",
    fontSans: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontMono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
    fontSize: "14px",
    radius: "10px",
    density: "compact",
  };
}

export function visualCssVars(visual: VisualContract): Record<string, string> {
  return {
    "--background": visual.background,
    "--foreground": visual.foreground,
    "--surface": visual.surface,
    "--border": visual.border,
    "--muted": visual.muted,
    "--accent": visual.accent,
    "--on-accent": visual.onAccent,
    "--mono": visual.fontMono,
    "--radius": visual.radius,
    fontFamily: visual.fontSans,
    fontSize: visual.fontSize,
  };
}

function uniqueNames(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const name = value.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

function suggestedKind(
  name: string,
  actions: readonly string[],
): SurfaceKind {
  const haystack = `${name} ${actions.join(" ")}`.toLowerCase();
  if (/\b(onboard|setup|wizard|step|recover(?:y)?|itinerary)\b/.test(haystack)) {
    return "workflow";
  }
  if (/\b(compar|choose|pick|select|versus|vs)\b/.test(haystack)) {
    return "comparison";
  }
  if (/\b(dashboard|monitor|metric|trend|revenue)\b/.test(haystack)) {
    return "dashboard";
  }
  if (/\b(approv|confirm|authori|refund)\b/.test(haystack)) {
    return "confirmation";
  }
  if (/\b(list|browse|search|find|index)\b/.test(haystack)) return "list";
  if (/\b(create|update|submit|edit|book|apply|configure)\b/.test(haystack)) {
    return "form";
  }
  if (/\b(detail|inspect|view|show)\b/.test(haystack)) return "detail";
  if (actions.length > 1) return "workflow";
  return "detail";
}

function capabilityLabel(capability: ProductKnowledge["capabilities"][number]): string {
  if (capability.action && capability.entity) {
    return `${capability.action} ${capability.entity}`;
  }
  return capability.name;
}

function permitted(
  capability: ProductKnowledge["capabilities"][number],
  user: UserContract | undefined,
): boolean {
  const required = capability.permissions ?? [];
  if (required.length === 0 || !user) return true;
  const held = new Set(user.permissions);
  return required.every((permission) => held.has(permission));
}

function flowsFromProduct(
  product: ProductKnowledge,
  user: UserContract | undefined,
): LearnedFlow[] {
  const capabilities = product.capabilities.filter((capability) =>
    permitted(capability, user),
  );
  const byId = new Map(
    capabilities.map((capability) => [capability.name, capability]),
  );

  const fromWorkflows = product.workflows.map((workflow, index) => {
    const steps = workflow.capabilityIds
      .map((id) => byId.get(id))
      .filter((capability): capability is NonNullable<typeof capability> =>
        Boolean(capability),
      )
      .map((capability) => capabilityLabel(capability));
    const actions = workflow.capabilityIds
      .map((id) => byId.get(id)?.action)
      .filter((action): action is string => Boolean(action));
    const kind = suggestedKind(workflow.name, actions);
    return {
      id: workflow.id ?? `flow:${index}:${workflow.name}`,
      name: workflow.name,
      steps: steps.length > 0 ? steps : [workflow.name],
      suggestedKind: kind,
      intent: intentForFlow(workflow.name, steps, kind),
    };
  });

  if (fromWorkflows.length > 0) return fromWorkflows.slice(0, MAX_FLOWS);

  // A product with no named workflows still has capabilities. Each one is a
  // one-step flow the generator can follow instead of inventing a generic task.
  return capabilities.slice(0, MAX_FLOWS).map((capability, index) => {
    const label = capabilityLabel(capability);
    const kind = suggestedKind(label, capability.action ? [capability.action] : []);
    return {
      id: `capability:${index}:${capability.name}`,
      name: label,
      steps: [label],
      suggestedKind: kind,
      intent: intentForFlow(label, [label], kind),
    };
  });
}

function intentForFlow(
  name: string,
  steps: readonly string[],
  kind: SurfaceKind,
): string {
  const sequence = steps.slice(0, 4).join(" → ");
  switch (kind) {
    case "comparison":
      return `Help me choose using the ${name} flow`;
    case "dashboard":
      return `Show me the ${name} view`;
    case "confirmation":
      return `Review and confirm ${name}`;
    case "form":
      return `Complete ${name}`;
    case "list":
      return `Browse ${name}`;
    case "workflow":
      return sequence
        ? `Walk through ${name}: ${sequence}`
        : `Walk through ${name}`;
    default:
      return `Open ${name}`;
  }
}

function isObserved(product: ProductKnowledge | undefined): boolean {
  if (!product) return false;
  return (
    product.pages.length > 0 ||
    product.entities.length > 0 ||
    product.workflows.length > 0 ||
    product.capabilities.length > 0
  );
}

export function matchFlows(
  flows: readonly LearnedFlow[],
  intent: string,
): LearnedFlow[] {
  const needle = intent.toLowerCase();
  if (!needle.trim()) return [];
  const scored = flows.map((flow) => {
    const haystack = `${flow.name} ${flow.steps.join(" ")}`.toLowerCase();
    const tokens = haystack.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    const hits = tokens.filter((token) => needle.includes(token)).length;
    return { flow, hits };
  });
  return scored
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, MAX_MATCHED)
    .map((entry) => entry.flow);
}

export function learnApp(input: {
  intent: string;
  product?: ProductKnowledge;
  user?: UserContract;
  visual?: VisualContract;
}): AppLearning {
  const product = input.product;
  const visualSource: VisualSource =
    input.visual || product?.visual ? "host" : "fallback";
  const visual = input.visual ?? product?.visual ?? ovxaVisualContract();
  const flows = product ? flowsFromProduct(product, input.user) : [];
  const vocabulary = uniqueNames(
    [
      ...(product?.pages.map((page) => page.name) ?? []),
      ...(product?.entities.map((entity) => entity.name) ?? []),
      ...(product?.fields?.map((field) => field.name) ?? []),
      ...(product?.capabilities.map((capability) => capabilityLabel(capability)) ??
        []),
    ],
    MAX_VOCAB,
  );
  const learning: AppLearning = {
    productName: product?.name ?? "",
    observed: isObserved(product),
    visualSource,
    visual,
    flows,
    matchedFlows: matchFlows(flows, input.intent),
    vocabulary,
  };
  if (input.user) learning.user = input.user;
  return learning;
}

/**
 * The slice of app learning that belongs in the generation prompt. Short on
 * purpose: long catalogues of every page teach the model to decorate, not to
 * finish the task in the product's voice.
 */
export function describeAppForPrompt(app: AppLearning): string {
  if (!app.observed) {
    return [
      "CUSTOMER APPLICATION: not observed yet.",
      "Do not invent a host product. Do not emit kit demos (health insurance plans, trip itineraries, generic SaaS dashboards) unless those nouns appear in the user intent.",
      "Compose only for the stated intent. Do not brand the surface as OVXA.",
    ].join("\n");
  }

  const lines = [
    "CUSTOMER APPLICATION (the host product — generate for this app, not an OVXA kit demo):",
    `  product: ${app.productName}`,
  ];

  if (app.visualSource === "host") {
    lines.push(
      `  density: ${app.visual.density}`,
      `  type: ${app.visual.fontSans} at ${app.visual.fontSize}; mono ${app.visual.fontMono}`,
      `  color: background ${app.visual.background}, surface ${app.visual.surface}, foreground ${app.visual.foreground}, muted ${app.visual.muted}, border ${app.visual.border}, accent ${app.visual.accent} on ${app.visual.onAccent}`,
      `  radius: ${app.visual.radius}`,
      "  Do not invent a second palette, a colour wash, or an accent hue the contract does not list.",
      "  Layout density and copy must match this contract. Compact means less chrome, tighter type, fewer cards.",
    );
  } else {
    lines.push(
      "  visual: not yet captured on the host. Do not invent a brand palette. Stay quiet and monochrome until tokens are observed.",
    );
  }

  lines.push(
    "  Do not generate kit demos (health plans, trip itineraries, 'Item 1' records) unless those nouns appear in PRODUCT VOCABULARY or USER INTENT.",
  );

  if (app.user) {
    const permissions =
      app.user.permissions.length > 0
        ? app.user.permissions.slice(0, 12).join(", ")
        : "(none listed — do not offer destructive product actions)";
    lines.push(
      "",
      "SIGNED-IN USER:",
      `  ${app.user.name} · ${app.user.role}`,
      `  permissions: ${permissions}`,
      "  Address this person. Do not offer actions their role cannot perform.",
    );
  }

  if (app.vocabulary.length > 0) {
    lines.push(
      "",
      "PRODUCT VOCABULARY (use these nouns; never genericise them into Item/Record/Dashboard):",
      `  ${app.vocabulary.join(", ")}`,
    );
  }

  const flows = app.matchedFlows.length > 0 ? app.matchedFlows : app.flows.slice(0, 4);
  if (flows.length > 0) {
    const heading =
      app.matchedFlows.length > 0
        ? "MATCHED PRODUCT FLOWS (follow these steps; do not invent a parallel journey):"
        : "PRODUCT FLOWS (prefer these shapes when the intent overlaps):";
    lines.push("", heading);
    for (const flow of flows) {
      lines.push(
        `  - ${flow.name} [${flow.suggestedKind}]: ${flow.steps.join(" → ")}`,
      );
    }
  }

  return lines.join("\n");
}

export function suggestedIntents(app: AppLearning): string[] {
  return uniqueNames(
    app.flows.map((flow) => flow.intent),
    8,
  );
}

export function hostSnapshotFromLearning(
  app: AppLearning,
): HostLearningSnapshot | undefined {
  if (!app.observed) return undefined;
  return {
    product: app.productName,
    vocabulary: app.vocabulary.slice(0, 16),
    flows: app.flows.slice(0, 6).map((flow) => ({
      name: flow.name,
      kind: flow.suggestedKind,
      steps: [...flow.steps],
    })),
  };
}

/**
 * Narrow a living product graph (or anything shaped like one) into the slice
 * generation actually reads. Keeps intelligence free of the graph package.
 */
export function productKnowledgeFromGraph(graph: {
  application: { name: string; visual?: VisualContract };
  pages: ReadonlyArray<{ name: string }>;
  entities: ReadonlyArray<{ name: string }>;
  fields?: ReadonlyArray<{ name: string }>;
  workflows: ReadonlyArray<{
    id: string;
    name: string;
    capabilityIds: readonly string[];
  }>;
  capabilities: ReadonlyArray<{
    name: string;
    capability: {
      id: string;
      action: string;
      entity: string;
      risk: string;
      requiredPermissions: readonly string[];
    };
  }>;
}): ProductKnowledge {
  const knowledge: ProductKnowledge = {
    name: graph.application.name,
    pages: graph.pages.map((page) => ({ name: page.name })),
    entities: graph.entities.map((entity) => ({ name: entity.name })),
    workflows: graph.workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      capabilityIds: [...workflow.capabilityIds],
    })),
    capabilities: graph.capabilities.map((node) => ({
      name: node.capability.id,
      action: node.capability.action,
      entity: node.capability.entity,
      risk: node.capability.risk,
      permissions: [...node.capability.requiredPermissions],
    })),
  };
  if (graph.application.visual) knowledge.visual = graph.application.visual;
  if (graph.fields && graph.fields.length > 0) {
    knowledge.fields = graph.fields.map((field) => ({ name: field.name }));
  }
  return knowledge;
}
