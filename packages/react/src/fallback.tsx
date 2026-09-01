import * as React from "react";
import type { SurfaceAction } from "@ovxa/schema";
import type { SurfaceComponentMap, SurfaceComponentProps } from "./types";

function titleFrom(data: Record<string, unknown>, type: string): string {
  for (const key of ["title", "label", "headline", "name"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function ActionBar({
  actions,
  onAction,
}: {
  actions: SurfaceAction[];
  onAction: (actionId: string, input?: Record<string, unknown>) => void;
}): React.ReactElement | null {
  if (actions.length === 0) return null;
  return (
    <div className="ovxa-actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`ovxa-btn ovxa-btn-${action.variant}`}
          disabled={action.status === "running"}
          onClick={() => onAction(action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders any unmapped node as structured, accessible HTML.
 *
 * Hosts should still register their design system. This exists so a missing
 * renderer never blanks the surface — the user still sees the data.
 */
export function FallbackNode({
  node,
  data,
  actions,
  onAction,
  children,
}: SurfaceComponentProps): React.ReactElement {
  const entries = Object.entries(data).filter(
    ([key]) => !["title", "label", "headline", "name"].includes(key),
  );

  return (
    <article className="ovxa-node" data-ovxa-type={node.type}>
      <header className="ovxa-node-head">
        <strong>{titleFrom(data, node.type)}</strong>
      </header>
      {entries.length > 0 ? (
        <dl className="ovxa-node-props">
          {entries.map(([key, value]) => (
            <div key={key} className="ovxa-node-row">
              <dt>{key}</dt>
              <dd>
                {Array.isArray(value)
                  ? value
                      .map((item) =>
                        isPlainRecord(item)
                          ? formatValue(item["label"] ?? item["title"] ?? item["value"] ?? item)
                          : formatValue(item),
                      )
                      .join(", ")
                  : formatValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
      <ActionBar actions={actions} onAction={onAction} />
    </article>
  );
}

/** A map that resolves every component name, including ones the host forgot. */
export const fallbackComponents: SurfaceComponentMap = new Proxy(
  {} as SurfaceComponentMap,
  {
    get: () => FallbackNode,
    has: () => true,
  },
);
