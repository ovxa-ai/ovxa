import * as React from "react";
import type { SurfaceComponentMap, SurfaceComponentProps } from "@ovxa/react";
import { ActionBar } from "@ovxa/react";
import { arr, isRecord, num, str } from "./values";

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value * 100) / 100);
}

function MetricRow({ data }: SurfaceComponentProps): React.ReactElement | null {
  const metrics = arr<{ label: string; value: string; detail?: string; trend?: string }>(
    data["metrics"],
  );
  if (metrics.length === 0) return null;
  return (
    <div className="ovxa-metrics">
      {metrics.map((metric) => (
        <div className="ovxa-metric" key={metric.label}>
          <span className="ovxa-muted">{metric.label}</span>
          <strong>{metric.value}</strong>
          {metric.detail ? (
            <span className={`ovxa-trend ovxa-trend-${metric.trend ?? "flat"}`}>
              {metric.detail}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function StatCard({ data }: SurfaceComponentProps): React.ReactElement {
  const delta = isRecord(data["delta"]) ? data["delta"] : null;
  const tone = str(delta?.["tone"], "neutral");
  return (
    <article className="ovxa-stat">
      <span className="ovxa-muted">{str(data["label"])}</span>
      <strong className="ovxa-stat-value">{str(data["value"])}</strong>
      {delta ? (
        <span className={`ovxa-trend ovxa-trend-${tone}`}>{str(delta["value"])}</span>
      ) : null}
      {str(data["caption"]) ? <span className="ovxa-muted">{str(data["caption"])}</span> : null}
    </article>
  );
}

function Callout({ data, actions, onAction }: SurfaceComponentProps): React.ReactElement {
  return (
    <aside className={`ovxa-callout ovxa-tone-${str(data["tone"], "info")}`} role="note">
      <strong>{str(data["title"])}</strong>
      <p>{str(data["body"])}</p>
      <ActionBar actions={actions} onAction={onAction} />
    </aside>
  );
}

function CompareTable({ data }: SurfaceComponentProps): React.ReactElement | null {
  const columns = arr<{ key: string; label: string }>(data["columns"]);
  const rows = arr<Record<string, string | number | boolean>>(data["rows"]);
  if (columns.length === 0) return null;
  const caption = str(data["caption"]);
  return (
    <div className="ovxa-table-wrap">
      <table className="ovxa-table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.key}>{String(row[column.key] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValueGrid({ data }: SurfaceComponentProps): React.ReactElement {
  const items = arr<{ label: string; value: string; hint?: string }>(data["items"]);
  return (
    <section className="ovxa-kv">
      {str(data["title"]) ? <h3>{str(data["title"])}</h3> : null}
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              {item.value}
              {item.hint ? <span className="ovxa-muted"> {item.hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SummaryPanel({
  data,
  actions,
  onAction,
}: SurfaceComponentProps): React.ReactElement {
  const items = arr<{ label: string; value: string }>(data["items"]);
  return (
    <section className="ovxa-summary">
      {str(data["headline"]) ? <h3>{str(data["headline"])}</h3> : null}
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <ActionBar actions={actions} onAction={onAction} />
    </section>
  );
}

function OptionGrid({ data, actions, onAction }: SurfaceComponentProps): React.ReactElement | null {
  const options = arr<{
    id: string;
    title: string;
    price?: string;
    cadence?: string;
    badge?: string;
    features?: string[];
    recommended?: boolean;
  }>(data["options"]);
  const selected = data["selectedId"];
  const select = actions.find((action) => action.id.toLowerCase().includes("select"));
  if (options.length === 0) return null;
  return (
    <div className="ovxa-options" role="radiogroup" aria-label="Options">
      {options.map((option) => {
        const isSelected = selected === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={`ovxa-option${isSelected ? " is-selected" : ""}${option.recommended ? " is-recommended" : ""}`}
            onClick={() => select && onAction(select.id, { id: option.id })}
          >
            <span>
              <strong>{option.title}</strong>
              {option.badge ? <span className="ovxa-chip">{option.badge}</span> : null}
            </span>
            {option.price ? (
              <span className="ovxa-option-price">
                {option.price}
                {option.cadence ? <em> {option.cadence}</em> : null}
              </span>
            ) : null}
            {(option.features ?? []).length > 0 ? (
              <ul>
                {(option.features ?? []).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function FilterBar({ data, onAction }: SurfaceComponentProps): React.ReactElement | null {
  const filters = arr<{
    id: string;
    label: string;
    options: string[];
    value: string;
  }>(data["filters"]);
  if (filters.length === 0) return null;
  return (
    <div className="ovxa-filters">
      {filters.map((filter) => (
        <label key={filter.id}>
          <span className="ovxa-muted">{filter.label}</span>
          <select
            value={filter.value}
            onChange={(event) =>
              onAction("setFilter", { id: filter.id, value: event.target.value })
            }
          >
            {filter.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function FieldSet({ data, onAction }: SurfaceComponentProps): React.ReactElement | null {
  const fields = arr<{
    id: string;
    label: string;
    value: string;
    type?: string;
    options?: string[];
    help?: string;
  }>(data["fields"]);
  if (fields.length === 0) return null;
  return (
    <form
      className="ovxa-form"
      onSubmit={(event) => {
        event.preventDefault();
        onAction("submit", {});
      }}
    >
      {fields.map((field) => (
        <label key={field.id}>
          <span>{field.label}</span>
          {field.type === "select" ? (
            <select
              value={field.value}
              onChange={(event) =>
                onAction("setField", { id: field.id, value: event.target.value })
              }
            >
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
              value={field.value}
              onChange={(event) =>
                onAction("setField", { id: field.id, value: event.target.value })
              }
            />
          )}
          {field.help ? <span className="ovxa-muted">{field.help}</span> : null}
        </label>
      ))}
      <button type="submit" className="ovxa-btn ovxa-btn-primary">
        Submit
      </button>
    </form>
  );
}

function StepTimeline({ data }: SurfaceComponentProps): React.ReactElement | null {
  const steps = arr<{
    id: string;
    label: string;
    detail?: string;
    status: string;
  }>(data["steps"]);
  if (steps.length === 0) return null;
  return (
    <ol className="ovxa-timeline">
      {steps.map((step) => (
        <li key={step.id} data-status={step.status}>
          <strong>{step.label}</strong>
          {step.detail ? <span className="ovxa-muted">{step.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function Section({ data, children }: SurfaceComponentProps): React.ReactElement {
  return (
    <section className="ovxa-section">
      <header>
        <h3>{str(data["title"])}</h3>
        {str(data["description"]) ? <p className="ovxa-muted">{str(data["description"])}</p> : null}
      </header>
      {children}
    </section>
  );
}

function BarChart({ data, node }: SurfaceComponentProps): React.ReactElement | null {
  const series = arr<{ label: string; value: number }>(data["series"]);
  if (series.length === 0) return null;
  const max = Math.max(...series.map((item) => Math.abs(num(item.value))), 1);
  const unit = str(data["unit"]);
  return (
    <figure className="ovxa-chart" aria-label={node.type}>
      {series.map((item) => (
        <div className="ovxa-bar-row" key={item.label}>
          <span>{item.label}</span>
          <span
            className="ovxa-bar"
            style={{ width: `${(Math.abs(num(item.value)) / max) * 100}%` }}
          />
          <span>
            {compact(num(item.value))}
            {unit}
          </span>
        </div>
      ))}
    </figure>
  );
}

function LineChart({ data, node }: SurfaceComponentProps): React.ReactElement | null {
  const series = arr<{ label: string; points: Array<{ x: string; y: number }> }>(
    data["series"],
  );
  const points = series[0]?.points ?? [];
  if (points.length < 2) return null;
  const values = points.map((point) => num(point.y));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 36 - ((value - min) / span) * 32;
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
  return (
    <figure className="ovxa-chart" aria-label={str(series[0]?.label, node.type)}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </figure>
  );
}

function RankedList({ data }: SurfaceComponentProps): React.ReactElement | null {
  const items = arr<{ label: string; value: number; detail?: string }>(data["items"]);
  if (items.length === 0) return null;
  const unit = str(data["unit"]);
  return (
    <ol className="ovxa-ranked">
      {items.map((item, index) => (
        <li key={`${item.label}-${index}`}>
          <span>{item.label}</span>
          <strong>
            {compact(num(item.value))}
            {unit}
          </strong>
          {item.detail ? <span className="ovxa-muted">{item.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function JsonViewer({ data }: SurfaceComponentProps): React.ReactElement {
  return (
    <section className="ovxa-code">
      {str(data["title"]) ? <h3>{str(data["title"])}</h3> : null}
      <pre>
        <code>{JSON.stringify(data["data"] ?? data, null, 2)}</code>
      </pre>
    </section>
  );
}

function CodeBlock({ data }: SurfaceComponentProps): React.ReactElement {
  return (
    <section className="ovxa-code">
      {str(data["filename"]) ? <h3>{str(data["filename"])}</h3> : null}
      <pre>
        <code>{str(data["code"])}</code>
      </pre>
    </section>
  );
}

function ApprovalCard({
  data,
  actions,
  onAction,
}: SurfaceComponentProps): React.ReactElement {
  const facts = arr<{ label: string; value: string }>(data["facts"]);
  return (
    <article className={`ovxa-approval ovxa-risk-${str(data["risk"], "medium")}`}>
      <strong>{str(data["title"])}</strong>
      <p>{str(data["summary"])}</p>
      {facts.length > 0 ? (
        <dl>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ActionBar actions={actions} onAction={onAction} />
    </article>
  );
}

function ThinkingTrace({ data }: SurfaceComponentProps): React.ReactElement | null {
  const steps = arr<{ id: string; label: string; status: string; detail?: string }>(
    data["steps"],
  );
  if (steps.length === 0) return null;
  return (
    <ol className="ovxa-trace">
      {steps.map((step) => (
        <li key={step.id} data-status={step.status}>
          <strong>{step.label}</strong>
          {step.detail ? <span className="ovxa-muted">{step.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function SourceList({ data, onAction }: SurfaceComponentProps): React.ReactElement | null {
  const sources = arr<{
    id: string;
    title: string;
    publisher?: string;
    snippet?: string;
  }>(data["sources"]);
  if (sources.length === 0) return null;
  return (
    <ul className="ovxa-sources">
      {sources.map((source) => (
        <li key={source.id}>
          <button type="button" className="ovxa-link" onClick={() => onAction("openSource", { id: source.id })}>
            {source.title}
          </button>
          {source.publisher ? <span className="ovxa-muted"> {source.publisher}</span> : null}
          {source.snippet ? <p className="ovxa-muted">{source.snippet}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function AgentTaskList({ data }: SurfaceComponentProps): React.ReactElement | null {
  const tasks = arr<{ id: string; label: string; status: string; detail?: string }>(
    data["tasks"],
  );
  if (tasks.length === 0) return null;
  return (
    <section className="ovxa-tasks">
      {str(data["title"]) ? <h3>{str(data["title"])}</h3> : null}
      <ul>
        {tasks.map((task) => (
          <li key={task.id} data-status={task.status}>
            <strong>{task.label}</strong>
            {task.detail ? <span className="ovxa-muted">{task.detail}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AnomalyList({ data }: SurfaceComponentProps): React.ReactElement | null {
  const items = arr<{ id?: string; title: string; detail?: string; severity?: string }>(
    data["anomalies"] ?? data["items"],
  );
  if (items.length === 0) return null;
  return (
    <ul className="ovxa-anomalies">
      {items.map((item, index) => (
        <li key={item.id ?? `${item.title}-${index}`} data-severity={item.severity}>
          <strong>{item.title}</strong>
          {item.detail ? <span className="ovxa-muted">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function DonutChart({ data, node }: SurfaceComponentProps): React.ReactElement | null {
  const slices = arr<{ label: string; value: number }>(data["slices"]);
  if (slices.length === 0) return null;
  const total = slices.reduce((sum, slice) => sum + Math.max(0, num(slice.value)), 0) || 1;
  return (
    <figure className="ovxa-chart ovxa-donut" aria-label={node.type}>
      <ul>
        {slices.map((slice) => (
          <li key={slice.label}>
            <span>{slice.label}</span>
            <strong>{Math.round((num(slice.value) / total) * 100)}%</strong>
          </li>
        ))}
      </ul>
      {str(data["centerValue"]) ? (
        <figcaption>
          <strong>{str(data["centerValue"])}</strong>
          {str(data["centerLabel"]) ? (
            <span className="ovxa-muted">{str(data["centerLabel"])}</span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function FunnelChart({ data }: SurfaceComponentProps): React.ReactElement | null {
  const stages = arr<{ label: string; value: number; detail?: string }>(data["stages"]);
  if (stages.length === 0) return null;
  const max = Math.max(...stages.map((stage) => num(stage.value)), 1);
  return (
    <ol className="ovxa-funnel">
      {stages.map((stage) => (
        <li key={stage.label} style={{ width: `${(num(stage.value) / max) * 100}%` }}>
          <strong>{stage.label}</strong>
          <span>{compact(num(stage.value))}</span>
        </li>
      ))}
    </ol>
  );
}

function GaugeMeter({ data }: SurfaceComponentProps): React.ReactElement {
  const min = num(data["min"], 0);
  const max = num(data["max"], 100);
  const value = num(data["value"]);
  const ratio = max === min ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  return (
    <article className="ovxa-gauge" aria-label={str(data["label"])}>
      <span className="ovxa-muted">{str(data["label"])}</span>
      <div className="ovxa-gauge-track">
        <span className="ovxa-gauge-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <strong>
        {compact(value)}
        {str(data["unit"])}
      </strong>
    </article>
  );
}

function HeatGrid({ data }: SurfaceComponentProps): React.ReactElement | null {
  const columns = arr<string>(data["columns"]);
  const rows = arr<{ label: string; values: number[] }>(data["rows"]);
  if (columns.length === 0 || rows.length === 0) return null;
  const all = rows.flatMap((row) => row.values.map((value) => num(value)));
  const max = Math.max(...all, 1);
  return (
    <div className="ovxa-table-wrap">
      <table className="ovxa-table ovxa-heat">
        <thead>
          <tr>
            <th scope="col" />
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((value, index) => (
                <td
                  key={columns[index] ?? index}
                  style={{ opacity: 0.25 + (num(value) / max) * 0.75 }}
                >
                  {compact(num(value))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffViewer({ data }: SurfaceComponentProps): React.ReactElement {
  return (
    <section className="ovxa-diff">
      {str(data["title"]) ? <h3>{str(data["title"])}</h3> : null}
      <div className="ovxa-diff-panes">
        <pre>
          <code>{str(data["before"])}</code>
        </pre>
        <pre>
          <code>{str(data["after"])}</code>
        </pre>
      </div>
    </section>
  );
}

function ToolRun({ data }: SurfaceComponentProps): React.ReactElement {
  return (
    <article className="ovxa-tool" data-status={str(data["status"])}>
      <strong>{str(data["tool"])}</strong>
      <span className="ovxa-muted">{str(data["status"])}</span>
      {str(data["error"]) ? <p role="alert">{str(data["error"])}</p> : null}
    </article>
  );
}

const specialized: SurfaceComponentMap = {
  MetricRow,
  StatCard,
  Callout,
  CompareTable,
  KeyValueGrid,
  SummaryPanel,
  OptionGrid,
  FilterBar,
  FieldSet,
  StepTimeline,
  Section,
  BarChart,
  LineChart,
  DonutChart,
  FunnelChart,
  GaugeMeter,
  HeatGrid,
  RankedList,
  JsonViewer,
  CodeBlock,
  DiffViewer,
  ApprovalCard,
  ThinkingTrace,
  SourceList,
  AgentTaskList,
  AnomalyList,
  ToolRun,
};

/**
 * Reference renderers for every surface-kit component. Unknown types are not
 * on this map — `SurfaceRenderer` shows the data through `FallbackNode`.
 */
export const defaultComponents: SurfaceComponentMap = specialized;
