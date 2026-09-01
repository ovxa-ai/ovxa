import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildCatalog,
  createActionRegistry,
  createRegistry,
  defineAction,
  defineComponent,
} from "@ovxa/registry";
import { SCHEMA_VERSION, parseSurface, type Surface } from "@ovxa/schema";
import {
  WireStreamDecoder,
  buildWirePrompt,
  decodeValue,
  decodeWire,
  encodeSurfaceToWire,
} from "./index";

const WIRE = `surface dashboard 2 wide
title Q2 revenue against Q1
note Growth slowed on enterprise renewals

StatCard mrr
  label Monthly recurring revenue
  value $1.24M
  delta @revenueDelta
  trend @mrrTrend

LineChart trend
  aria Monthly revenue over twelve months
  series @revenueByMonth
  fill true

Section breakdown
  title Where it went
  RankedList segments
    items @segments
    unit $
    act drillDown Investigate

action exportData Export
`;

describe("decodeWire", () => {
  it("reads the surface header and its layout modifiers", () => {
    const { draft } = decodeWire(WIRE);
    expect(draft.kind).toBe("dashboard");
    expect(draft.title).toBe("Q2 revenue against Q1");
    expect(draft.description).toBe("Growth slowed on enterprise renewals");
    expect(draft.layout).toEqual({
      columns: 2,
      density: "comfortable",
      maxWidth: "wide",
    });
  });

  it("reads components, their props and their order", () => {
    const { draft } = decodeWire(WIRE);
    expect(draft.root.map((node) => node.type)).toEqual([
      "StatCard",
      "LineChart",
      "Section",
    ]);
    expect(draft.root[0]?.props).toEqual({
      label: "Monthly recurring revenue",
      value: "$1.24M",
      delta: { $bind: "revenueDelta" },
      trend: { $bind: "mrrTrend" },
    });
  });

  it("nests a component by indentation", () => {
    const { draft } = decodeWire(WIRE);
    const section = draft.root[2];
    expect(section?.type).toBe("Section");
    expect(section?.props["title"]).toBe("Where it went");
    expect(section?.children?.[0]?.type).toBe("RankedList");
    expect(section?.children?.[0]?.actions).toEqual([
      { id: "drillDown", label: "Investigate" },
    ]);
  });

  it("lifts aria out of props and onto the node", () => {
    const { draft } = decodeWire(WIRE);
    const chart = draft.root[1];
    expect(chart?.a11y).toEqual({ label: "Monthly revenue over twelve months" });
    expect(chart?.props["aria"]).toBeUndefined();
    expect(chart?.props["fill"]).toBe(true);
  });

  it("collects surface-level actions", () => {
    const { draft } = decodeWire(WIRE);
    expect(draft.actions).toEqual([{ id: "exportData", label: "Export" }]);
  });

  it("gives an unnamed component a stable, unique id", () => {
    const first = decodeWire("surface list\nStatCard\nStatCard\n");
    const second = decodeWire("surface list\nStatCard\nStatCard\n");
    expect(first.draft.root.map((node) => node.id)).toEqual(["statcard", "statcard2"]);
    // Stable across runs: a random id would make every reconcile a replacement.
    expect(second.draft.root.map((node) => node.id)).toEqual(
      first.draft.root.map((node) => node.id),
    );
  });

  it("never lets a duplicate id through", () => {
    const { draft } = decodeWire("surface list\nStatCard same\nLineChart same\n");
    const ids = draft.root.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports a line it cannot place instead of guessing", () => {
    const { draft, skipped } = decodeWire(
      "surface list\n!!! ignore me\nStatCard a\n  label Fine\n",
    );
    expect(skipped).toEqual(["!!! ignore me"]);
    expect(draft.root).toHaveLength(1);
  });

  it("skips a prop that arrives before any component", () => {
    const { skipped } = decodeWire("surface list\n  orphan 12\n");
    expect(skipped).toEqual(["orphan 12"]);
  });
});

describe("tabular props", () => {
  const TABLE = `surface list
title Accounts
CompareTable accounts
  columns |key|label
  |account|Account
  |arr|ARR
  rows |account|arr|active
  |Northwind|48000|true
  |Acme|31500|false
  caption Renewals this quarter
`;

  it("expands rows into records using the column header", () => {
    const { draft } = decodeWire(TABLE);
    expect(draft.root[0]?.props["rows"]).toEqual([
      { account: "Northwind", arr: 48000, active: true },
      { account: "Acme", arr: 31500, active: false },
    ]);
  });

  it("supports more than one table on the same component", () => {
    const { draft } = decodeWire(TABLE);
    expect(draft.root[0]?.props["columns"]).toEqual([
      { key: "account", label: "Account" },
      { key: "arr", label: "ARR" },
    ]);
  });

  it("closes the table when an ordinary prop follows", () => {
    const { draft } = decodeWire(TABLE);
    expect(draft.root[0]?.props["caption"]).toBe("Renewals this quarter");
  });

  it("omits a column with no cell rather than inventing an empty one", () => {
    const { draft } = decodeWire(
      "surface list\nCompareTable t\n  rows |a|b|c\n  |one||three\n",
    );
    expect(draft.root[0]?.props["rows"]).toEqual([{ a: "one", c: "three" }]);
  });

  it("skips a row that arrives with no table open", () => {
    const { skipped } = decodeWire("surface list\nCompareTable t\n  |a|b\n");
    expect(skipped).toEqual(["|a|b"]);
  });

  it("round-trips a uniform record array through the tabular form", () => {
    const withRows = parseSurface({
      ...surface,
      root: [
        {
          id: "t",
          type: "CompareTable",
          props: {
            rows: [
              { account: "Northwind", arr: 48000, active: true },
              { account: "Acme", arr: 31500, active: false },
            ],
          },
        },
      ],
    });
    const encoded = encodeSurfaceToWire(withRows);
    expect(encoded).toContain("rows |account|arr|active");
    expect(decodeWire(encoded).draft.root[0]?.props["rows"]).toEqual(
      withRows.root[0]?.props["rows"],
    );
  });

  it("keeps a value containing the separator as JSON instead of a table", () => {
    const risky = parseSurface({
      ...surface,
      root: [
        {
          id: "t",
          type: "CompareTable",
          props: {
            rows: [{ label: "a|b" }, { label: "c" }],
          },
        },
      ],
    });
    const encoded = encodeSurfaceToWire(risky);
    expect(encoded).not.toContain("rows |label");
    expect(decodeWire(encoded).draft.root[0]?.props["rows"]).toEqual([
      { label: "a|b" },
      { label: "c" },
    ]);
  });
});

describe("decodeValue", () => {
  it("reads a binding", () => {
    expect(decodeValue("@revenue.byMonth[0]")).toEqual({
      $bind: "revenue.byMonth[0]",
    });
  });

  it("keeps a malformed binding as text rather than emitting an invalid one", () => {
    expect(decodeValue("@not a path")).toBe("@not a path");
  });

  it("reads scalars and JSON literals", () => {
    expect(decodeValue("true")).toBe(true);
    expect(decodeValue("42")).toBe(42);
    expect(decodeValue("-3.5")).toBe(-3.5);
    expect(decodeValue("null")).toBeNull();
    expect(decodeValue("[1,2,3]")).toEqual([1, 2, 3]);
    expect(decodeValue('{"a":1}')).toEqual({ a: 1 });
  });

  it("leaves ordinary text unquoted and intact", () => {
    expect(decodeValue("Monthly recurring revenue")).toBe("Monthly recurring revenue");
    // Not a bare number, so it stays a string.
    expect(decodeValue("$1.24M")).toBe("$1.24M");
    expect(decodeValue("3 accounts at risk")).toBe("3 accounts at risk");
  });

  it("recovers from a broken JSON literal instead of throwing", () => {
    expect(decodeValue("[1,2,")).toBe("[1,2,");
  });
});

const surface: Surface = parseSurface({
  schemaVersion: SCHEMA_VERSION,
  id: "srf_1",
  intent: "Compare Q2 revenue against Q1",
  kind: "dashboard",
  title: "Q2 revenue against Q1",
  description: "Growth slowed on enterprise renewals",
  layout: { columns: 2, density: "comfortable", maxWidth: "wide" },
  root: [
    {
      id: "mrr",
      type: "StatCard",
      props: { label: "MRR", value: "$1.24M", trend: { $bind: "mrrTrend" } },
    },
    {
      id: "wrap",
      type: "Section",
      props: { title: "Breakdown" },
      children: [
        {
          id: "segments",
          type: "RankedList",
          props: { items: { $bind: "segments" }, unit: "$" },
          actions: [
            {
              id: "drillDown",
              label: "Investigate",
              input: {},
              variant: "secondary",
              risk: "low",
              status: "idle",
              optimistic: [],
            },
          ],
        },
      ],
    },
  ],
  state: { mrrTrend: [1, 2], segments: [] },
  actions: [],
  status: "ready",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("encodeSurfaceToWire", () => {
  it("round-trips structure, props, nesting and bindings", () => {
    const { draft } = decodeWire(encodeSurfaceToWire(surface));

    expect(draft.kind).toBe(surface.kind);
    expect(draft.title).toBe(surface.title);
    expect(draft.description).toBe(surface.description);
    expect(draft.layout).toEqual(surface.layout);

    expect(draft.root.map((node) => node.id)).toEqual(["mrr", "wrap"]);
    expect(draft.root[0]?.props).toEqual(surface.root[0]?.props);

    const nested = draft.root[1]?.children?.[0];
    expect(nested?.id).toBe("segments");
    expect(nested?.props["items"]).toEqual({ $bind: "segments" });
    expect(nested?.actions).toEqual([{ id: "drillDown", label: "Investigate" }]);
  });

  it("quotes a string that would otherwise decode as something else", () => {
    const tricky = parseSurface({
      ...surface,
      root: [
        {
          id: "a",
          type: "StatCard",
          props: { label: "42", value: "@notabinding", caption: "true" },
        },
      ],
    });
    const { draft } = decodeWire(encodeSurfaceToWire(tricky));
    expect(draft.root[0]?.props).toEqual({
      label: "42",
      value: "@notabinding",
      caption: "true",
    });
  });
});

describe("WireStreamDecoder", () => {
  /** Slices land mid-line and mid-word, exactly as provider chunks do. */
  function feed(text: string, size: number) {
    const decoder = new WireStreamDecoder();
    const nodes: string[] = [];
    const headers: unknown[] = [];
    for (let index = 0; index < text.length; index += size) {
      const { nodes: ready, header } = decoder.push(text.slice(index, index + size));
      nodes.push(...ready.map((node) => node.id));
      if (header) headers.push(header);
    }
    const flushed = decoder.flush();
    nodes.push(...flushed.nodes.map((node) => node.id));
    return { nodes, headers, draft: flushed.draft, skipped: flushed.skipped };
  }

  it("releases each root component once the next one starts", () => {
    const { nodes, draft } = feed(WIRE, 9);
    expect(nodes).toEqual(["mrr", "trend", "breakdown"]);
    expect(draft.root).toHaveLength(3);
  });

  it("produces the same result whatever the chunk size", () => {
    const whole = decodeWire(WIRE).draft;
    for (const size of [1, 3, 17, 200, 5000]) {
      expect(feed(WIRE, size).draft).toEqual(whole);
    }
  });

  it("never releases a component while its props are still arriving", () => {
    const decoder = new WireStreamDecoder();
    // The whole first component has arrived, but nothing proves it is finished.
    const first = decoder.push("surface dashboard\nStatCard mrr\n  label MRR\n");
    expect(first.nodes).toEqual([]);
    // A second root component proves the first one closed.
    const second = decoder.push("LineChart trend\n");
    expect(second.nodes.map((node) => node.id)).toEqual(["mrr"]);
    expect(second.nodes[0]?.props["label"]).toBe("MRR");
  });

  it("reports header fields once, as soon as their line completes", () => {
    const decoder = new WireStreamDecoder();
    expect(decoder.push("surface dashboard 2 wide\ntit").header).toEqual({
      kind: "dashboard",
    });
    expect(decoder.push("le Q2 revenue\n").header).toEqual({ title: "Q2 revenue" });
    expect(decoder.push("StatCard a\n").header).toBeNull();
  });

  it("keeps whatever arrived when a stream is cut off mid-document", () => {
    const truncated = WIRE.slice(0, WIRE.indexOf("Section"));
    const { draft } = feed(truncated, 11);
    expect(draft.root.map((node) => node.id)).toEqual(["mrr", "trend"]);
  });
});

describe("buildWirePrompt", () => {
  const components = createRegistry().register(
    defineComponent({
      name: "StatCard",
      description: "One number that carries the answer.",
      intents: ["summarize"],
      surfaces: ["dashboard"],
      props: z.object({ label: z.string(), value: z.string() }),
      actions: ["drillDown"],
      constraints: ["At most two per surface."],
    }),
  );
  const actions = createActionRegistry().register(
    defineAction({
      id: "drillDown",
      description: "Investigate one item in depth.",
      input: z.object({ id: z.string() }),
      handler: () => ({}),
    }),
  );

  it("derives the component menu from the registry", () => {
    const prompt = buildWirePrompt(
      buildCatalog(components, actions, { surface: "dashboard" }),
    );
    expect(prompt).toContain("StatCard — One number that carries the answer.");
    expect(prompt).toContain("label:string");
    expect(prompt).toContain("At most two per surface.");
    expect(prompt).toContain("drillDown — Investigate one item in depth.");
  });

  it("tells the model to bind rather than copy data", () => {
    const prompt = buildWirePrompt(
      buildCatalog(components, actions, { surface: "dashboard" }),
    );
    expect(prompt).toContain("Never copy");
    expect(prompt).toContain("@path");
  });

  it("says there are no actions when the host permitted none", () => {
    const prompt = buildWirePrompt(
      buildCatalog(components, createActionRegistry(), { surface: "dashboard" }),
    );
    expect(prompt).toContain("none are permitted");
  });
});
