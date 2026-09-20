/**
 * The jobs a generated interface does better than a paragraph.
 *
 * These are the suggestions `OvxaSearch` shows before the user has typed, and
 * the shortest honest answer to "what would I use this for". Each intent is
 * phrased the way a user would say it, because that is what the engine reads.
 */
export type UseCase = {
  id: string;
  title: string;
  /** A representative intent, in the user's words. */
  intent: string;
  /** What the winning interface tends to look like. */
  description: string;
};

export const defaultUseCases: readonly UseCase[] = [
  {
    id: "compare",
    title: "Compare",
    intent: "Compare Q2 revenue against Q1 and show where growth was lost",
    description: "Two periods side by side, with the delta that explains the change.",
  },
  {
    id: "choose",
    title: "Choose",
    intent: "Help me pick the right plan for a team of twelve",
    description: "Options with a recommendation, not a wall of feature rows.",
  },
  {
    id: "configure",
    title: "Configure",
    intent: "Set alerting thresholds for the checkout service",
    description: "Only the fields that matter, prefilled from current state.",
  },
  {
    id: "approve",
    title: "Approve",
    intent: "Review this refund request and decide",
    description: "The facts, the risk, and one clear action.",
  },
  {
    id: "investigate",
    title: "Investigate",
    intent: "Why did checkout conversion drop last Tuesday?",
    description: "A funnel, the anomaly, and the sources behind it.",
  },
  {
    id: "monitor",
    title: "Monitor",
    intent: "Show the health of the payments pipeline right now",
    description: "Live metrics with the failing step pulled to the front.",
  },
];

/** Case-insensitive match on title, intent and description. Empty query keeps all. */
export function filterUseCases(cases: readonly UseCase[], query: string): UseCase[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...cases];
  return cases.filter((useCase) =>
    [useCase.title, useCase.intent, useCase.description].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}
