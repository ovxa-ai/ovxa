import { z } from "zod";
import { createRegistry, defineComponent, type ComponentRegistry } from "@ovxa/registry";
import { agenticComponents } from "./agentic";
import { chartComponents } from "./charts";
import { dataComponents } from "./data";

/**
 * The reference component library, registered with OVXA exactly the way a host
 * application would register its design system.
 *
 * These definitions carry no rendering code on purpose. The compiler needs the
 * prop schemas and the semantic metadata to choose and validate components, and
 * it has to be able to do that on the server, where React does not exist. The
 * studio maps these names onto real React components separately.
 */

export const metricRowProps = z.object({
  metrics: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      detail: z.string().optional(),
      trend: z.enum(["up", "down", "flat"]).optional(),
    }),
  ),
});

export const optionGridProps = z.object({
  options: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      price: z.string().optional(),
      cadence: z.string().optional(),
      badge: z.string().optional(),
      features: z.array(z.string()).optional(),
      recommended: z.boolean().optional(),
    }),
  ),
  selectedId: z.string().nullable().optional(),
});

export const compareTableProps = z.object({
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
  caption: z.string().optional(),
});

export const barChartProps = z.object({
  series: z.array(z.object({ label: z.string(), value: z.number() })),
  unit: z.string().optional(),
});

export const calloutProps = z.object({
  title: z.string(),
  body: z.string(),
  tone: z.enum(["info", "success", "warning", "critical"]).optional(),
});

export const filterBarProps = z.object({
  filters: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      options: z.array(z.string()),
      value: z.string(),
    }),
  ),
});

export const fieldSetProps = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      value: z.string(),
      type: z.enum(["text", "number", "date", "select"]).optional(),
      options: z.array(z.string()).optional(),
      help: z.string().optional(),
    }),
  ),
});

export const summaryProps = z.object({
  items: z.array(z.object({ label: z.string(), value: z.string() })),
  headline: z.string().optional(),
});

export const timelineProps = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string().optional(),
      status: z.enum(["done", "active", "todo"]),
    }),
  ),
});

export const sectionProps = z.object({
  title: z.string(),
  description: z.string().optional(),
});

/** The core set. Charts, data display and agent components are added alongside. */
export const surfaceComponentNames = [
  "MetricRow",
  "OptionGrid",
  "CompareTable",
  "BarChart",
  "Callout",
  "FilterBar",
  "FieldSet",
  "SummaryPanel",
  "StepTimeline",
  "Section",
] as const;

export type SurfaceComponentName = (typeof surfaceComponentNames)[number];

function createCoreRegistry(): ComponentRegistry {
  return createRegistry()
    .register(
      defineComponent({
        name: "MetricRow",
        description:
          "A row of headline numbers with optional trend. Use for the two to four figures that frame a decision.",
        intents: ["summarize", "monitor"],
        surfaces: ["dashboard", "detail", "comparison", "result", "workflow"],
        props: metricRowProps,
        states: { loading: true, empty: true, error: true },
        a11y: { keyboardOperable: false },
      }),
    )
    .register(
      defineComponent({
        name: "OptionGrid",
        description:
          "Selectable cards for a small set of mutually exclusive choices, such as plans, tiers or cabins.",
        intents: ["compare", "select"],
        surfaces: ["comparison", "form", "workflow"],
        props: optionGridProps,
        actions: ["selectOption"],
        events: ["select"],
        states: { loading: true, empty: true, error: true },
        a11y: { keyboardOperable: true },
        constraints: ["Use for 2–5 options. Beyond that use CompareTable."],
      }),
    )
    .register(
      defineComponent({
        name: "CompareTable",
        description:
          "A feature matrix across many items. Use when the user needs to scan attributes rather than pick a headline.",
        intents: ["compare", "enumerate"],
        surfaces: ["comparison", "list", "detail"],
        props: compareTableProps,
        states: { loading: true, empty: true, error: true },
        a11y: { keyboardOperable: false },
        constraints: [
          "Every row must use exactly the keys declared in columns[].key.",
        ],
      }),
    )
    .register(
      defineComponent({
        name: "BarChart",
        description: "Horizontal bars for comparing a single measure across categories.",
        intents: ["visualize"],
        surfaces: ["dashboard", "detail", "result"],
        props: barChartProps,
        states: { loading: true, empty: true, error: true },
        a11y: { keyboardOperable: false, requiresLabel: true },
        constraints: ["series[].value must be a number, never a formatted string."],
      }),
    )
    .register(
      defineComponent({
        name: "Callout",
        description:
          "A single recommendation, finding or warning that deserves to interrupt the scan.",
        intents: ["explain", "annotate"],
        surfaces: [],
        props: calloutProps,
        actions: ["selectOption", "confirm", "dismiss"],
        states: { loading: false, empty: false, error: false },
        a11y: { keyboardOperable: true },
        constraints: ["At most one per surface. Two callouts cancel each other out."],
      }),
    )
    .register(
      defineComponent({
        name: "FilterBar",
        description: "Segmented controls that narrow what the rest of the surface shows.",
        intents: ["select", "navigate"],
        surfaces: ["dashboard", "list", "comparison"],
        props: filterBarProps,
        actions: ["setFilter"],
        events: ["change"],
        states: { loading: false, empty: false, error: false },
        a11y: { keyboardOperable: true },
      }),
    )
    .register(
      defineComponent({
        name: "FieldSet",
        description:
          "The smallest form that collects what is still unknown. Prefer this over asking questions one at a time.",
        intents: ["collect-input"],
        surfaces: ["form", "workflow", "confirmation"],
        props: fieldSetProps,
        actions: ["setField", "submit"],
        events: ["change", "submit"],
        states: { loading: true, empty: false, error: true },
        a11y: { keyboardOperable: true },
        constraints: ["A field of type select must also supply options[]."],
      }),
    )
    .register(
      defineComponent({
        name: "SummaryPanel",
        description:
          "A labelled key/value review of what is about to happen or what just happened.",
        intents: ["summarize", "confirm"],
        surfaces: ["confirmation", "result", "detail", "workflow"],
        props: summaryProps,
        actions: ["confirm", "submit", "dismiss"],
        states: { loading: true, empty: true, error: true },
        a11y: { keyboardOperable: true },
      }),
    )
    .register(
      defineComponent({
        name: "StepTimeline",
        description: "Progress through an ordered task with a clear current step.",
        intents: ["navigate", "monitor"],
        surfaces: ["workflow", "detail", "result"],
        props: timelineProps,
        states: { loading: true, empty: false, error: false },
        a11y: { keyboardOperable: false },
        constraints: ["Exactly one step should have status \"active\"."],
      }),
    )
    .register(
      defineComponent({
        name: "Section",
        description:
          "Groups related components under a heading. Use to separate phases of a task, not to decorate.",
        intents: ["annotate"],
        surfaces: [],
        props: sectionProps,
        capacity: { maxChildren: 8 },
        states: { loading: false, empty: false, error: false },
        a11y: { keyboardOperable: false },
      }),
    );
}

/**
 * The full reference library. The compiler narrows this by surface kind and
 * intent before a model ever sees it, so a broad catalogue costs nothing at
 * generation time and buys a much better fit for the task.
 */
export function createSurfaceRegistry(): ComponentRegistry {
  return createCoreRegistry()
    .registerAll(dataComponents)
    .registerAll(chartComponents)
    .registerAll(agenticComponents);
}
