import { z } from "zod";
import { defineComponent, type ComponentDefinition } from "@ovxa/registry";

/**
 * Components for interfaces that an agent drives.
 *
 * A long-running agent has to be legible without leaking its reasoning. These
 * render what it is *doing* — steps, tools, sources, what needs a human — and
 * deliberately provide nowhere to put private chain-of-thought.
 */

export const thinkingTraceProps = z.object({
  steps: z
    .array(
      z.object({
        id: z.string(),
        /** Observable work, in plain language: "Searching transactions". */
        label: z.string(),
        status: z.enum(["done", "active", "pending", "failed"]),
        detail: z.string().optional(),
        durationMs: z.number().optional(),
      }),
    )
    .min(1)
    .max(24),
  elapsedMs: z.number().optional(),
  summary: z.string().optional(),
});

export const toolRunProps = z.object({
  tool: z.string(),
  status: z.enum(["running", "succeeded", "failed"]),
  /** Arguments as sent. Redact before this reaches the surface, not after. */
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});

export const sourceListProps = z.object({
  sources: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string().optional(),
        publisher: z.string().optional(),
        snippet: z.string().optional(),
        /** 0–1. Shown as a strength indicator, never as a percentage claim. */
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const agentTaskListProps = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.enum(["done", "running", "queued", "blocked", "failed"]),
        /** 0–1 for a task that reports partial completion. */
        progress: z.number().min(0).max(1).optional(),
        detail: z.string().optional(),
      }),
    )
    .min(1)
    .max(24),
  title: z.string().optional(),
});

export const approvalCardProps = z.object({
  title: z.string(),
  summary: z.string(),
  risk: z.enum(["low", "medium", "high"]),
  facts: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .max(10)
    .optional(),
  /** What the operator should check before approving. */
  warning: z.string().optional(),
});

export const anomalyListProps = z.object({
  anomalies: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        detail: z.string(),
        severity: z.enum(["low", "medium", "high"]),
        metric: z.string().optional(),
        delta: z.string().optional(),
      }),
    )
    .min(1)
    .max(12),
});

export const agenticComponents: ComponentDefinition<never>[] = [
  defineComponent({
    name: "ThinkingTrace",
    description:
      "What the system is doing right now, step by step. Use while work is still running so the wait is legible instead of blank.",
    intents: ["monitor", "explain"],
    surfaces: ["workflow", "result", "detail", "dashboard"],
    props: thinkingTraceProps,
    states: { loading: true, empty: false, error: true },
    a11y: { keyboardOperable: false, live: "polite" },
    constraints: [
      "Describe observable work only — what is being searched, compared or fetched.",
      "Never put model reasoning, deliberation or private chain-of-thought in a label or detail.",
      "At most one step may have status \"active\".",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "ToolRun",
    description:
      "One tool call with its arguments, result and outcome. Use to make an agent's side effects inspectable rather than implied.",
    intents: ["monitor", "explain"],
    surfaces: ["workflow", "result", "detail"],
    props: toolRunProps,
    actions: ["retryTool"],
    states: { loading: true, empty: false, error: true },
    a11y: { keyboardOperable: true, live: "polite" },
    constraints: [
      "Redact secrets and personal data before putting them in input or output.",
      "A failed run must set error; a status of failed with no error is not renderable.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "SourceList",
    description:
      "Where an answer came from. Use whenever a claim rests on retrieved documents, so the user can check it.",
    intents: ["explain", "enumerate"],
    surfaces: ["result", "detail", "list"],
    props: sourceListProps,
    actions: ["openSource"],
    events: ["select"],
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: true },
    constraints: [
      "Only cite sources actually used. A plausible-looking citation that was not read is a fabrication.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "AgentTaskList",
    description:
      "Progress across the pieces of a longer job. Use when work fans out and the user needs to see what is finished, running and blocked.",
    intents: ["monitor", "navigate"],
    surfaces: ["workflow", "dashboard", "result"],
    props: agentTaskListProps,
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: false, live: "polite" },
    constraints: ["A blocked task must explain what it is waiting on in detail."],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "ApprovalCard",
    description:
      "A decision that needs a human before anything happens. Use for money movement, destructive changes, and anything a policy marks as requiring sign-off.",
    intents: ["confirm", "explain"],
    surfaces: ["confirmation", "workflow", "detail", "result"],
    props: approvalCardProps,
    actions: ["approve", "reject"],
    events: ["submit"],
    states: { loading: true, empty: false, error: true },
    a11y: { keyboardOperable: true },
    constraints: [
      "State the concrete effect of approving in summary — amounts, names, counts.",
      "Never pre-approve, and never present approval as the only available action.",
    ],
  }) as ComponentDefinition<never>,

  defineComponent({
    name: "AnomalyList",
    description:
      "Findings that break an expected pattern, worst first. Use when the answer to \"what happened\" is a short list of specific irregularities.",
    intents: ["explain", "monitor", "enumerate"],
    surfaces: ["dashboard", "detail", "result", "list"],
    props: anomalyListProps,
    actions: ["drillDown", "dismiss"],
    events: ["select"],
    states: { loading: true, empty: true, error: true },
    a11y: { keyboardOperable: true },
    constraints: [
      "Order by severity, highest first.",
      "Each anomaly needs a specific detail — a number, a name, a time — not a restatement of the title.",
    ],
  }) as ComponentDefinition<never>,
];
