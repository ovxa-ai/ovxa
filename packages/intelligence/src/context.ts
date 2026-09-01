import type { SurfaceKind } from "@ovxa/schema";
import type { AppLearning } from "./app";

/**
 * What the user is trying to finish — not what the UI looks like. Surface
 * kind is a later decision; task kind is the thing evaluation optimises for.
 */
export const taskKinds = [
  "choose",
  "configure",
  "investigate",
  "monitor",
  "approve",
  "collect",
  "browse",
  "arrange",
  "explain",
] as const;
export type TaskKind = (typeof taskKinds)[number];

export type UserHistorySignals = {
  preferredKinds?: readonly SurfaceKind[];
  completedIntents?: readonly string[];
  abandonedPatterns?: readonly string[];
};

export type ContextConstraints = {
  locale?: string;
  latencyBudgetMs?: number;
  maxInteractions?: number;
};

export type ContextUnderstanding = {
  intent: string;
  taskKind: TaskKind;
  /** Surface kinds that historically complete this task, strongest first. */
  preferredKinds: SurfaceKind[];
  availableData: string[];
  permittedActions: string[];
  constraints: ContextConstraints;
  history?: UserHistorySignals;
  /** Host style, user, and product flows this generation must belong to. */
  app?: AppLearning;
};

type TaskRule = {
  kind: TaskKind;
  patterns: RegExp[];
  kinds: SurfaceKind[];
};

/**
 * Verb-first classification. "insurance plan" is not a workflow just because
 * it contains the word "plan"; "choose the right plan" is a choice.
 */
const taskRules: TaskRule[] = [
  {
    kind: "choose",
    patterns: [
      /\bchoose\b/,
      /\bpick\b/,
      /\bselect\b/,
      /\bcompare\b/,
      /\bversus\b/,
      /\bvs\.?\b/,
      /\bright \w+ for\b/,
      /\bbest \w+ for\b/,
      /\bwhich (?:one|plan|option)\b/,
    ],
    kinds: ["comparison", "list", "form"],
  },
  {
    kind: "arrange",
    patterns: [
      /\bplan a\b/,
      /\bitinerary\b/,
      /\bstep by step\b/,
      /\bonboard(?:ing)?\b/,
      /\bworkflow\b/,
      /\bdays? in\b/,
    ],
    kinds: ["workflow", "form", "comparison"],
  },
  // Investigating a trend wants aggregate views; investigating one record
  // wants that record. Same task, opposite information hierarchy.
  {
    kind: "investigate",
    patterns: [/\bwhy\b/, /\bdropped\b/, /\bbreakdown\b/, /\bacross\b/],
    kinds: ["dashboard", "detail", "list"],
  },
  {
    kind: "investigate",
    patterns: [
      /\binvestigate\b/,
      /\binspect\b/,
      /\bsuspicious\b/,
      /\bwhat happened\b/,
    ],
    kinds: ["detail", "dashboard", "list"],
  },
  {
    kind: "monitor",
    patterns: [/\bmetrics?\b/, /\btrend\b/, /\bdashboard\b/, /\brevenue\b/, /\bspend(?:ing)?\b/],
    kinds: ["dashboard", "detail"],
  },
  {
    kind: "approve",
    patterns: [/\bapprove\b/, /\bconfirm\b/, /\bauthori[sz]e\b/, /\brefund\b/, /\btransfer\b/],
    kinds: ["confirmation", "detail"],
  },
  {
    kind: "configure",
    patterns: [/\bbook\b/, /\bsign ?up\b/, /\bcreate\b/, /\bconfigure\b/, /\bedit\b/, /\bapply\b/],
    kinds: ["form", "workflow", "confirmation"],
  },
  {
    kind: "collect",
    patterns: [/\bfill\b/, /\benter\b/, /\bsubmit\b/, /\bupdate\b/],
    kinds: ["form", "workflow"],
  },
  {
    kind: "browse",
    patterns: [/\blist\b/, /\bshow (?:me )?all\b/, /\bbrowse\b/, /\bfind\b/, /\bsearch\b/],
    kinds: ["list", "comparison"],
  },
  {
    kind: "explain",
    patterns: [/\bexplain\b/, /\bwhat is\b/, /\btell me\b/, /\bsummar(?:y|ise|ize)\b/],
    kinds: ["detail", "dashboard"],
  },
];

export function classifyTask(intent: string): {
  taskKind: TaskKind;
  preferredKinds: SurfaceKind[];
} {
  const normalized = intent.toLowerCase();
  let best: { rule: TaskRule; hits: number } | null = null;
  for (const rule of taskRules) {
    const hits = rule.patterns.filter((pattern) => pattern.test(normalized)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { rule, hits };
  }
  if (!best) {
    return { taskKind: "explain", preferredKinds: ["detail", "dashboard"] };
  }
  return { taskKind: best.rule.kind, preferredKinds: [...best.rule.kinds] };
}

export function understandContext(input: {
  intent: string;
  state: Record<string, unknown>;
  allowedActions: readonly string[];
  locale?: string;
  latencyBudgetMs?: number;
  maxInteractions?: number;
  history?: UserHistorySignals;
  app?: AppLearning;
}): ContextUnderstanding {
  const classified = classifyTask(input.intent);
  const preferredKinds: SurfaceKind[] = [];
  const seen = new Set<SurfaceKind>();
  const matchedKind = input.app?.matchedFlows[0]?.suggestedKind;
  for (const kind of [
    ...(matchedKind ? [matchedKind] : []),
    ...classified.preferredKinds,
  ]) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    preferredKinds.push(kind);
  }
  const constraints: ContextConstraints = {};
  if (input.locale !== undefined) constraints.locale = input.locale;
  if (input.latencyBudgetMs !== undefined) {
    constraints.latencyBudgetMs = input.latencyBudgetMs;
  }
  if (input.maxInteractions !== undefined) {
    constraints.maxInteractions = input.maxInteractions;
  }

  const understanding: ContextUnderstanding = {
    intent: input.intent,
    taskKind: classified.taskKind,
    preferredKinds,
    availableData: Object.keys(input.state),
    permittedActions: [...input.allowedActions],
    constraints,
  };
  if (input.history) understanding.history = input.history;
  if (input.app) understanding.app = input.app;
  return understanding;
}
