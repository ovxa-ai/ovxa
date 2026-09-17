import type * as React from "react";

/**
 * Host design tokens for a generated surface.
 *
 * Every value is a CSS value and lands on a `--ovxa-*` custom property on the
 * surface root, so a host can also set them from a stylesheet:
 *
 *   .ovxa { --ovxa-radius: var(--radius); --ovxa-border: hsl(var(--border)); }
 *
 * Anything not set is derived from the host's `currentColor` and `font`, which
 * is what lets a surface look native inside an app that never configured it.
 */
export type OvxaTheme = {
  /** Corner radius for cards, inputs and buttons. */
  radius?: string;
  /** Hairline border colour. */
  border?: string;
  /** Emphasised border (selected, recommended). */
  borderStrong?: string;
  /** Secondary text colour. */
  muted?: string;
  /** Soft fill for hover, skeletons and tracks. */
  fill?: string;
  /** Primary action and highlight colour. */
  accent?: string;
  /** Text colour on top of `accent`. */
  onAccent?: string;
  success?: string;
  danger?: string;
  /** Font shorthand. Defaults to `inherit`. */
  font?: string;
  /** Gap between components. */
  gap?: string;
};

const TOKEN_TO_PROPERTY: Record<keyof OvxaTheme, string> = {
  radius: "--ovxa-radius",
  border: "--ovxa-border",
  borderStrong: "--ovxa-border-strong",
  muted: "--ovxa-muted",
  fill: "--ovxa-fill",
  accent: "--ovxa-accent",
  onAccent: "--ovxa-on-accent",
  success: "--ovxa-success",
  danger: "--ovxa-danger",
  font: "--ovxa-font",
  gap: "--ovxa-gap",
};

/** Inline style carrying the theme as custom properties, or undefined if empty. */
export function themeStyle(theme: OvxaTheme | undefined): React.CSSProperties | undefined {
  if (!theme) return undefined;
  const style: Record<string, string> = {};
  for (const [token, property] of Object.entries(TOKEN_TO_PROPERTY) as Array<
    [keyof OvxaTheme, string]
  >) {
    const value = theme[token];
    if (typeof value === "string" && value.length > 0) style[property] = value;
  }
  return Object.keys(style).length > 0 ? (style as React.CSSProperties) : undefined;
}

/** Joins class names, skipping empties. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter((name): name is string => Boolean(name)).join(" ");
}
