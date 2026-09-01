import { z } from "zod";
import { defineComponent, type ComponentDefinition } from "@ovxa/registry";

/**
 * Visualisation components.
 *
 * Every chart takes numbers, never pre-formatted strings: a model that writes
 * "1.2M" into a data point has destroyed the value the renderer needs to scale
 * an axis. Formatting is the renderer's job, and the constraint below says so in
 * the words the model reads.
 */

const tone = z.enum(["primary", "positive", "negative", "neutral"]);

export const lineChartProps = z.object({
  series: z
    .array(
      z.object({
        label: z.string(),
        points: z
          .array(z.object({ x: z.string(), y: z.number() }))
          .min(2)
          .max(120),
        tone: tone.optional(),
      }),
    )
    .min(1)
    .max(4),
  unit: z.string().optional(),
  /** Shades the area under the line. Use for one series, not for four. */
  fill: z.boolean().optional(),
  /** Draws a target line, e.g. a quota or an SLO. */
  goal: z.number().optional(),
  goalLabel: z.string().optional(),
});

export const donutChartProps = z.object({
  slices: z
    .array(z.object({ label: z.string(), value: z.number(), tone: tone.optional() }))
    .min(2)
    .max(8),
  /** Shown in the middle. Pre-formatted, because it is a label not a datum. */
  centerValue: z.string().optional(),
  centerLabel: z.string().optional(),
});

export const funnelChartProps = z.object({
  stages: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
        detail: z.string().optional(),
      }),
    )
    .min(2)
    .max(8),
  unit: z.string().optional(),
});

export const gaugeMeterProps = z.object({
  label: z.string(),
  value: z.number(),
  min: z.number().optional(),
  max: z.number(),
  target: z.number().optional(),
  unit: z.string().optional(),
  tone: tone.optional(),
});

export const heatGridProps = z.object({
  columns: z.array(z.string()).min(2).max(24),
  rows: z
    .array(z.object({ label: z.string(), values: z.array(z.number()) }))
    .min(1)
    .max(24),
  unit: z.string().optional(),
});

export const rankedListProps = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string(),
        value: z.number(),
        detail: z.string().optional(),
        tone: tone.optional(),
      }),
    )
    .min(1)
    .max(20),
  unit: z.string().optional(),
  /** Bars are drawn against this rather than the largest item when supplied. */
  total: z.number().optional(),
});

const NUMBERS_NOT_STRINGS =
  "Values must be raw numbers, never formatted strings: the renderer scales the axis and formats the label.";

export const chartComponents: ComponentDefinition<never>[] = [
  defineComponent({
    name: "LineChart",
    description:
      "A trend over time. Use when the shape of the change matters more than any single value — growth, decline, seasonality, a break in a pattern.",
    intents: ["visualize", "monitor", "explain"],
    surfaces: ["dashboard", "detail", "result", "comparison"],
    props: lineChartProps,
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: false, requiresLabel: true },
    constraints: [
      NUMBERS_NOT_STRINGS,
      "Every series needs at least two points; a single point is a metric, not a trend.",
      "Use fill for one series only. Overlapping shaded areas cannot be read.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "DonutChart",
    description:
      "How a whole splits into parts. Use for composition — revenue by segment, spend by category — and only when the parts sum to something meaningful.",
    intents: ["visualize", "summarize"],
    surfaces: ["dashboard", "detail", "result"],
    props: donutChartProps,
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: false, requiresLabel: true },
    constraints: [
      NUMBERS_NOT_STRINGS,
      "Two to eight slices. Beyond eight use RankedList, which stays readable.",
      "Do not use for values that are not parts of one total.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "FunnelChart",
    description:
      "Drop-off through an ordered sequence. Use for conversion, onboarding completion, or any pipeline where the question is where people leave.",
    intents: ["visualize", "explain", "monitor"],
    surfaces: ["dashboard", "detail", "result"],
    props: funnelChartProps,
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: false, requiresLabel: true },
    constraints: [
      NUMBERS_NOT_STRINGS,
      "Stages must be in sequence order and values should not increase down the funnel.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "GaugeMeter",
    description:
      "One value against a ceiling or a target. Use for utilisation, quota, budget consumed, or progress toward a committed number.",
    intents: ["monitor", "summarize"],
    surfaces: ["dashboard", "detail", "result", "workflow"],
    props: gaugeMeterProps,
    states: { loading: true, empty: false, error: true },
    a11y: { keyboardOperable: false },
    constraints: [NUMBERS_NOT_STRINGS, "max must be greater than min."],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "HeatGrid",
    description:
      "Density across two dimensions. Use to find where in a grid something concentrates — hour by weekday, region by product, cohort by month.",
    intents: ["visualize", "monitor"],
    surfaces: ["dashboard", "detail"],
    props: heatGridProps,
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: false, requiresLabel: true },
    constraints: [
      NUMBERS_NOT_STRINGS,
      "Every row's values array must have exactly one entry per column, in column order.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "RankedList",
    description:
      "Ordered contributors with their share. Use for breakdowns where naming the top few is the answer — biggest accounts, top error types, largest cost drivers.",
    intents: ["enumerate", "compare", "visualize"],
    surfaces: ["dashboard", "detail", "list", "result", "comparison"],
    props: rankedListProps,
    actions: ["drillDown", "selectOption"],
    events: ["select"],
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: true },
    constraints: [
      NUMBERS_NOT_STRINGS,
      "Order items yourself, largest first. The renderer does not sort.",
    ],
  }) as ComponentDefinition<never>,
];
