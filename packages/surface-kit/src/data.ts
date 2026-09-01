import { z } from "zod";
import { defineComponent, type ComponentDefinition } from "@ovxa/registry";

/**
 * Data display beyond a plain table.
 *
 * These exist because a generated interface that only has tables and metrics
 * pushes the model toward dumping records. A hero number, a dense fact grid and
 * a readable diff each answer a different question, and giving the compiler that
 * choice is what keeps the output shaped like the task.
 */

const tone = z.enum(["primary", "positive", "negative", "neutral"]);

export const statCardProps = z.object({
  label: z.string(),
  /** Pre-formatted, because this is the headline the user reads. */
  value: z.string(),
  delta: z
    .object({
      value: z.string(),
      direction: z.enum(["up", "down", "flat"]),
      /** Up is not always good. State whether this change is good or bad. */
      tone: z.enum(["positive", "negative", "neutral"]).optional(),
      caption: z.string().optional(),
    })
    .optional(),
  /** Raw numbers for the sparkline. Oldest first. */
  trend: z.array(z.number()).max(60).optional(),
  caption: z.string().optional(),
});

export const keyValueGridProps = z.object({
  items: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        hint: z.string().optional(),
        tone: tone.optional(),
      }),
    )
    .min(1)
    .max(24),
  title: z.string().optional(),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export const codeBlockProps = z.object({
  code: z.string().max(20_000),
  language: z.string().optional(),
  filename: z.string().optional(),
});

export const jsonViewerProps = z.object({
  data: z.unknown(),
  title: z.string().optional(),
});

export const diffViewerProps = z.object({
  before: z.string().max(20_000),
  after: z.string().max(20_000),
  title: z.string().optional(),
  beforeLabel: z.string().optional(),
  afterLabel: z.string().optional(),
});

export const dataComponents: ComponentDefinition<never>[] = [
  defineComponent({
    name: "StatCard",
    description:
      "One number that carries the answer, with its change and recent shape. Use for the single figure the whole surface is about.",
    intents: ["summarize", "monitor"],
    surfaces: ["dashboard", "detail", "result", "comparison"],
    props: statCardProps,
    states: { loading: true, empty: false, error: true },
    a11y: { keyboardOperable: false },
    constraints: [
      "At most two per surface. A wall of hero numbers has no hero — use MetricRow instead.",
      "trend must be raw numbers, oldest first.",
      "Set delta.tone explicitly: a rising cost is negative even though the arrow points up.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "KeyValueGrid",
    description:
      "Dense labelled facts. Use for the attributes of one thing — an account, an invoice, a deployment — where every field matters and none is the headline.",
    intents: ["summarize", "explain"],
    surfaces: ["detail", "result", "confirmation", "workflow"],
    props: keyValueGridProps,
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: false },
    constraints: ["Values are pre-formatted strings, including units and currency."],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "CodeBlock",
    description:
      "A snippet, query or configuration shown verbatim. Use when the exact text is the deliverable.",
    intents: ["explain"],
    surfaces: ["result", "detail"],
    props: codeBlockProps,
    states: { loading: true, empty: false, error: true },
    a11y: { keyboardOperable: true },
    constraints: [
      "Rendered as text, never executed. Do not use it to smuggle behaviour into a surface.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "JsonViewer",
    description:
      "A structured payload, expandable. Use to show a raw tool result or record without pretending it is prose.",
    intents: ["explain"],
    surfaces: ["result", "detail"],
    props: jsonViewerProps,
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: true },
    constraints: ["Prefer a real component when the shape is known; this is the fallback."],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "DiffViewer",
    description:
      "What changed between two versions, line by line. Use for proposed edits, config changes and before/after review.",
    intents: ["compare", "explain", "confirm"],
    surfaces: ["comparison", "confirmation", "detail", "result"],
    props: diffViewerProps,
    states: { loading: true, empty: false, error: true },
    a11y: { keyboardOperable: false },
    constraints: ["Send the full text of both sides; the renderer computes the diff."],
  }) as ComponentDefinition<never>,
];
