import { SCHEMA_VERSION, isBinding, parseSurface, type ComponentNode, type Surface } from "@ovxa/schema";
import { encodeSurfaceToWire } from "./encode";

/**
 * What a generated surface costs the model to write.
 *
 * Three encodings of the same interface are measured, because the interesting
 * comparison is not "is our syntax terser" but "how much does the model have to
 * write at all":
 *
 *   json    the surface as minified JSON — what a schema-shaped format costs
 *   wire    the same surface in Wire, data still inline — the structural saving
 *   bound   the same surface in Wire with data referenced by @path — the real
 *           OVXA path, where the model never transcribes a record
 *
 * The third column is the one that matters and the one that is hardest to argue
 * with: its cost is a function of how many components the interface has, not how
 * much data they show. A table of ten rows and a table of ten thousand cost the
 * same to generate.
 */

export type BenchmarkScenario = {
  id: string;
  description: string;
  surface: Surface;
};

export type ScenarioMeasurement = {
  id: string;
  description: string;
  json: number;
  wire: number;
  bound: number;
  /** Wire against JSON, as a negative percentage. */
  wireVsJson: number;
  /** Bound Wire against JSON, as a negative percentage. */
  boundVsJson: number;
};

export type BenchmarkReport = {
  scenarios: ScenarioMeasurement[];
  totals: {
    json: number;
    wire: number;
    bound: number;
    wireVsJson: number;
    boundVsJson: number;
  };
};

/** Counts tokens. Injected so the benchmark runs with or without a tokenizer. */
export type TokenCounter = (text: string) => number;

const BASE = {
  schemaVersion: SCHEMA_VERSION,
  id: "srf_bench",
  state: {},
  status: "ready" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const LAYOUT = { columns: 2 as const, density: "comfortable" as const, maxWidth: "wide" as const };

function months(count: number, from: number, drift: number) {
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return Array.from({ length: count }, (_, index) => ({
    x: names[index % 12] ?? `M${index}`,
    y: Math.round(from + drift * index),
  }));
}

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    account: `Account ${index + 1}`,
    plan: index % 3 === 0 ? "Enterprise" : index % 3 === 1 ? "Scale" : "Pro",
    arr: 12_000 + index * 3_100,
    seats: 12 + index * 4,
    renewal: `2026-0${(index % 9) + 1}-15`,
  }));
}

/**
 * Seven interfaces spanning the shapes a generative UI platform actually has to
 * produce, with data volumes a real one would carry.
 */
export function benchmarkScenarios(): BenchmarkScenario[] {
  const specs: Array<{ id: string; description: string; document: Record<string, unknown> }> = [
    {
      id: "simple-table",
      description: "Ten accounts with five columns",
      document: {
        kind: "list",
        title: "Accounts up for renewal",
        root: [
          {
            id: "accounts",
            type: "CompareTable",
            props: {
              columns: [
                { key: "account", label: "Account" },
                { key: "plan", label: "Plan" },
                { key: "arr", label: "ARR" },
                { key: "seats", label: "Seats" },
                { key: "renewal", label: "Renews" },
              ],
              rows: rows(10),
            },
          },
        ],
      },
    },
    {
      id: "chart-with-data",
      description: "Twelve-month revenue trend",
      document: {
        kind: "dashboard",
        title: "Revenue over the last year",
        root: [
          {
            id: "trend",
            type: "LineChart",
            props: {
              series: [{ label: "MRR", points: months(12, 980_000, 21_000) }],
              fill: true,
              unit: "$",
            },
            a11y: { label: "Monthly recurring revenue over twelve months" },
          },
        ],
      },
    },
    {
      id: "contact-form",
      description: "Eight-field form with a submit action",
      document: {
        kind: "form",
        title: "Request a migration review",
        description: "We will come back within two business days.",
        root: [
          {
            id: "details",
            type: "FieldSet",
            props: {
              fields: [
                { id: "name", label: "Full name", value: "", type: "text" },
                { id: "email", label: "Work email", value: "", type: "text" },
                { id: "company", label: "Company", value: "", type: "text" },
                { id: "seats", label: "Seats", value: "", type: "number" },
                {
                  id: "plan",
                  label: "Current plan",
                  value: "Pro",
                  type: "select",
                  options: ["Pro", "Scale", "Enterprise"],
                },
                { id: "region", label: "Data region", value: "EU", type: "select", options: ["EU", "US"] },
                { id: "date", label: "Target date", value: "", type: "date" },
                { id: "notes", label: "Anything we should know", value: "", type: "text" },
              ],
            },
          },
        ],
        actions: [{ id: "submit", label: "Request review", variant: "primary" }],
      },
    },
    {
      id: "dashboard",
      description: "Two hero metrics, a trend, a breakdown and two findings",
      document: {
        kind: "dashboard",
        title: "Q2 revenue against Q1",
        description: "Growth slowed on enterprise renewals rather than new business.",
        root: [
          {
            id: "mrr",
            type: "StatCard",
            props: {
              label: "Monthly recurring revenue",
              value: "$1.24M",
              delta: { value: "-8.2%", direction: "down", tone: "negative" },
              trend: [1.35, 1.34, 1.33, 1.31, 1.29, 1.24],
            },
          },
          {
            id: "churn",
            type: "StatCard",
            props: {
              label: "Net revenue retention",
              value: "94%",
              delta: { value: "-6pt", direction: "down", tone: "negative" },
              trend: [1.02, 1.01, 0.99, 0.97, 0.95, 0.94],
            },
          },
          {
            id: "trend",
            type: "LineChart",
            props: {
              series: [{ label: "MRR", points: months(6, 1_350_000, -22_000) }],
              fill: true,
            },
            a11y: { label: "Monthly recurring revenue, six months" },
          },
          {
            id: "segments",
            type: "RankedList",
            props: {
              items: [
                { id: "enterprise", label: "Enterprise", value: 612_000, detail: "3 renewals slipped" },
                { id: "scale", label: "Scale", value: 421_000 },
                { id: "pro", label: "Pro", value: 207_000 },
              ],
              unit: "$",
            },
          },
          {
            id: "findings",
            type: "AnomalyList",
            props: {
              anomalies: [
                {
                  id: "a1",
                  title: "Three enterprise renewals slipped past quarter end",
                  detail: "Northwind, Acme and Belfry moved to July, worth $184k combined.",
                  severity: "high",
                  delta: "-$184k",
                },
                {
                  id: "a2",
                  title: "Seat expansion stalled in EMEA",
                  detail: "Net new seats fell from 1,240 to 310 quarter on quarter.",
                  severity: "medium",
                },
              ],
            },
          },
        ],
        actions: [
          { id: "drillDown", label: "Investigate enterprise" },
          { id: "exportData", label: "Export" },
        ],
      },
    },
    {
      id: "pricing-page",
      description: "Three plans plus a feature matrix",
      document: {
        kind: "comparison",
        title: "Choose a plan",
        root: [
          {
            id: "plans",
            type: "OptionGrid",
            props: {
              options: [
                {
                  id: "pro",
                  title: "Pro",
                  price: "$49",
                  cadence: "/seat/mo",
                  features: ["Up to 20 seats", "Email support", "Standard SLA"],
                },
                {
                  id: "scale",
                  title: "Scale",
                  price: "$99",
                  cadence: "/seat/mo",
                  badge: "Popular",
                  recommended: true,
                  features: ["Up to 200 seats", "Priority support", "99.9% SLA", "SSO"],
                },
                {
                  id: "enterprise",
                  title: "Enterprise",
                  price: "Custom",
                  features: ["Unlimited seats", "Dedicated CSM", "99.99% SLA", "SSO + SCIM", "VPC option"],
                },
              ],
            },
          },
          {
            id: "matrix",
            type: "CompareTable",
            props: {
              columns: [
                { key: "feature", label: "Feature" },
                { key: "pro", label: "Pro" },
                { key: "scale", label: "Scale" },
                { key: "enterprise", label: "Enterprise" },
              ],
              rows: [
                { feature: "Seats", pro: "20", scale: "200", enterprise: "Unlimited" },
                { feature: "SSO", pro: false, scale: true, enterprise: true },
                { feature: "SCIM", pro: false, scale: false, enterprise: true },
                { feature: "Audit log", pro: false, scale: true, enterprise: true },
                { feature: "SLA", pro: "None", scale: "99.9%", enterprise: "99.99%" },
                { feature: "Support", pro: "Email", scale: "Priority", enterprise: "Dedicated" },
              ],
            },
          },
        ],
        actions: [{ id: "selectOption", label: "Continue", variant: "primary" }],
      },
    },
    {
      id: "settings-panel",
      description: "Grouped settings with twelve fields",
      document: {
        kind: "form",
        title: "Workspace settings",
        root: [
          {
            id: "identity",
            type: "Section",
            props: { title: "Identity", description: "How your workspace appears." },
            children: [
              {
                id: "identity-fields",
                type: "FieldSet",
                props: {
                  fields: [
                    { id: "name", label: "Workspace name", value: "Northwind" },
                    { id: "slug", label: "URL slug", value: "northwind" },
                    { id: "region", label: "Data region", value: "EU", type: "select", options: ["EU", "US", "AP"] },
                    { id: "locale", label: "Default locale", value: "en-GB", type: "select", options: ["en-GB", "en-US", "de-DE"] },
                  ],
                },
              },
            ],
          },
          {
            id: "security",
            type: "Section",
            props: { title: "Security" },
            children: [
              {
                id: "security-fields",
                type: "FieldSet",
                props: {
                  fields: [
                    { id: "sso", label: "SSO provider", value: "Okta", type: "select", options: ["Okta", "Entra", "Google"] },
                    { id: "mfa", label: "Require MFA", value: "Yes", type: "select", options: ["Yes", "No"] },
                    { id: "session", label: "Session length (hours)", value: "12", type: "number" },
                    { id: "ipAllow", label: "IP allowlist", value: "" },
                  ],
                },
              },
            ],
          },
          {
            id: "retention",
            type: "Section",
            props: { title: "Retention" },
            children: [
              {
                id: "retention-fields",
                type: "FieldSet",
                props: {
                  fields: [
                    { id: "logs", label: "Log retention (days)", value: "90", type: "number" },
                    { id: "traces", label: "Trace retention (days)", value: "30", type: "number" },
                    { id: "zeroRetention", label: "Zero retention mode", value: "No", type: "select", options: ["Yes", "No"] },
                    { id: "export", label: "Nightly export bucket", value: "" },
                  ],
                },
              },
            ],
          },
        ],
        actions: [{ id: "submit", label: "Save changes", variant: "primary" }],
      },
    },
    {
      id: "ecommerce-product",
      description: "Product detail with specs, options and a purchase action",
      document: {
        kind: "detail",
        title: "Aeron Remastered — Size B",
        description: "In stock, ships in two working days.",
        root: [
          {
            id: "price",
            type: "StatCard",
            props: {
              label: "Price",
              value: "£1,395",
              delta: { value: "-12%", direction: "down", tone: "positive", caption: "vs list" },
            },
          },
          {
            id: "variants",
            type: "OptionGrid",
            props: {
              options: [
                { id: "graphite", title: "Graphite", price: "£1,395", features: ["Standard mesh", "Ships Tue"] },
                { id: "carbon", title: "Carbon", price: "£1,425", features: ["Standard mesh", "Ships Thu"], recommended: true },
                { id: "mineral", title: "Mineral", price: "£1,455", features: ["Premium mesh", "Ships in 3 weeks"] },
              ],
            },
          },
          {
            id: "specs",
            type: "KeyValueGrid",
            props: {
              title: "Specification",
              items: [
                { label: "Size", value: "B (medium)" },
                { label: "Weight capacity", value: "159 kg" },
                { label: "Recline", value: "Tilt limiter, 4 positions" },
                { label: "Arms", value: "Fully adjustable" },
                { label: "Casters", value: "Hard floor" },
                { label: "Warranty", value: "12 years" },
                { label: "Assembly", value: "Not required" },
                { label: "Returns", value: "30 days, free" },
              ],
            },
          },
          {
            id: "note",
            type: "Callout",
            props: {
              title: "Carbon is the closest match to your existing chairs",
              body: "Your last order was Carbon with a tilt limiter, so the finish will match.",
              tone: "info",
            },
          },
        ],
        actions: [{ id: "selectOption", label: "Add to basket", variant: "primary" }],
      },
    },
  ];

  return specs.map(({ id, description, document }) => ({
    id,
    description,
    surface: parseSurface({
      ...BASE,
      layout: LAYOUT,
      actions: [],
      ...document,
      intent: description,
    }),
  }));
}

/**
 * Replaces every inline data structure with a binding.
 *
 * This is not a trick to win a benchmark — it is how OVXA generates. Host state
 * is authoritative and already in memory, so a model that names it produces a
 * correct surface, while a model that retypes it produces a slower, longer and
 * occasionally hallucinated one.
 */
function bindData(nodes: readonly ComponentNode[]): ComponentNode[] {
  return nodes.map((node) => {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.props)) {
      const structural =
        !isBinding(value) && typeof value === "object" && value !== null;
      props[key] = structural ? { $bind: `${node.id}_${key}` } : value;
    }
    return {
      ...node,
      props: props as ComponentNode["props"],
      ...(node.children ? { children: bindData(node.children) } : {}),
    };
  });
}

export function runBenchmark(count: TokenCounter): BenchmarkReport {
  const scenarios = benchmarkScenarios().map((scenario): ScenarioMeasurement => {
    // What the model writes, not what is stored: identity, timestamps and state
    // are assigned by the runtime and are not part of any encoding's cost.
    const { schemaVersion, id, intent, state, createdAt, updatedAt, ...authored } =
      scenario.surface;
    void schemaVersion;
    void id;
    void intent;
    void state;
    void createdAt;
    void updatedAt;

    const json = count(JSON.stringify(authored));
    const wire = count(encodeSurfaceToWire(scenario.surface));
    const bound = count(
      encodeSurfaceToWire({ ...scenario.surface, root: bindData(scenario.surface.root) }),
    );

    return {
      id: scenario.id,
      description: scenario.description,
      json,
      wire,
      bound,
      wireVsJson: (wire - json) / json,
      boundVsJson: (bound - json) / json,
    };
  });

  const sum = (pick: (item: ScenarioMeasurement) => number): number =>
    scenarios.reduce((total, item) => total + pick(item), 0);

  const json = sum((item) => item.json);
  const wire = sum((item) => item.wire);
  const bound = sum((item) => item.bound);

  return {
    scenarios,
    totals: {
      json,
      wire,
      bound,
      wireVsJson: (wire - json) / json,
      boundVsJson: (bound - json) / json,
    },
  };
}

/** Fixed-width report, so a run can be pasted into a PR without reformatting. */
export function formatBenchmark(report: BenchmarkReport): string {
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const pad = (text: string, width: number): string => text.padEnd(width);
  const padStart = (text: string, width: number): string => text.padStart(width);

  const lines = [
    `${pad("scenario", 22)}${padStart("json", 8)}${padStart("wire", 8)}${padStart("bound", 8)}${padStart("wire", 10)}${padStart("bound", 10)}`,
    "-".repeat(66),
  ];

  for (const item of report.scenarios) {
    lines.push(
      pad(item.id, 22) +
        padStart(String(item.json), 8) +
        padStart(String(item.wire), 8) +
        padStart(String(item.bound), 8) +
        padStart(pct(item.wireVsJson), 10) +
        padStart(pct(item.boundVsJson), 10),
    );
  }

  lines.push("-".repeat(66));
  lines.push(
    pad("TOTAL", 22) +
      padStart(String(report.totals.json), 8) +
      padStart(String(report.totals.wire), 8) +
      padStart(String(report.totals.bound), 8) +
      padStart(pct(report.totals.wireVsJson), 10) +
      padStart(pct(report.totals.boundVsJson), 10),
  );

  return lines.join("\n");
}
