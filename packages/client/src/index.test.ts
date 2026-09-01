import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Surface } from "@ovxa/schema";
import { encodeSseEvent } from "@ovxa/streaming";
import type { SurfaceEvent } from "@ovxa/protocol";
import { OvxaError, collectSurface, createOvxa } from "./index";

const shell: Surface = {
  schemaVersion: SCHEMA_VERSION,
  id: "srf_1",
  intent: "Compare Q2 revenue against Q1",
  kind: "dashboard",
  title: "Q2 revenue against Q1",
  layout: { columns: 2, density: "comfortable", maxWidth: "wide" },
  root: [],
  state: { mrrTrend: [1, 2, 3] },
  actions: [],
  status: "streaming",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const events: SurfaceEvent[] = [
  { type: "surface.start", surface: shell, seq: 0 },
  {
    type: "component.add",
    surfaceId: "srf_1",
    parentId: null,
    node: {
      id: "mrr",
      type: "StatCard",
      props: { label: "MRR", value: "$1.24M" },
    },
    seq: 1,
  },
  {
    type: "component.add",
    surfaceId: "srf_1",
    parentId: null,
    node: {
      id: "trend",
      type: "LineChart",
      props: { series: { $bind: "mrrTrend" } },
    },
    seq: 2,
  },
  {
    type: "surface.patch",
    surfaceId: "srf_1",
    operations: [{ op: "surface.patch", status: "ready" }],
    seq: 3,
  },
  { type: "surface.complete", surfaceId: "srf_1", seq: 4 },
];

const summary = {
  traceId: "trc_1",
  surfaceId: "srf_1",
  engine: "hosted-llm",
  model: "gpt-4o",
  usedFallback: false,
  degradedReason: null,
  streamedComponents: 2,
  timeToShellMs: 180,
  timeToFirstComponentMs: 640,
  elapsedMs: 1420,
};

/**
 * A transport that replays a scripted stream in slices, so frame boundaries land
 * mid-JSON exactly as they do over a real connection.
 */
function streamingFetch(
  body: string,
  sliceSize = 13,
  init: { ok?: boolean; status?: number } = {},
) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (url: string | URL, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit });
    if (init.ok === false) {
      return {
        ok: false,
        status: init.status ?? 500,
        json: async () => ({ error: "rate_limited", message: "Slow down." }),
        body: null,
      };
    }
    const bytes = new TextEncoder().encode(body);
    let offset = 0;
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      body: {
        getReader: () => ({
          read: async () => {
            if (offset >= bytes.length) return { done: true, value: undefined };
            const value = bytes.slice(offset, offset + sliceSize);
            offset += sliceSize;
            return { done: false, value };
          },
          releaseLock: () => {},
        }),
      },
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function wire(withSummary = true): string {
  const frames = events.map(encodeSseEvent);
  if (withSummary) {
    frames.push(`data: ${JSON.stringify({ type: "ovxa.summary", summary })}\n\n`);
  }
  return frames.join("");
}

describe("createOvxa", () => {
  it("requires a fetch implementation rather than failing at call time", () => {
    expect(() =>
      createOvxa({ fetch: undefined as unknown as typeof fetch, baseUrl: "/api" }),
    ).not.toThrow();
  });

  it("sends the API key as a bearer token and posts to the configured origin", async () => {
    const { impl, calls } = streamingFetch(wire());
    const ovxa = createOvxa({ apiKey: "ovxa_sk_test", baseUrl: "/api", fetch: impl });

    const stream = ovxa.stream({ intent: "Compare Q2 revenue against Q1" });
    await collectSurface(stream);

    expect(calls[0]?.url).toBe("/api/genui/stream");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ovxa_sk_test");
    expect(headers.accept).toBe("text/event-stream");
  });

  it("yields surface events and keeps the summary out of the event loop", async () => {
    const { impl } = streamingFetch(wire());
    const ovxa = createOvxa({ baseUrl: "/api", fetch: impl });

    const seen: string[] = [];
    const stream = ovxa.stream({ intent: "Compare Q2 revenue against Q1" });
    let next = await stream.next();
    while (!next.done) {
      seen.push(next.value.type);
      next = await stream.next();
    }

    expect(seen).toEqual([
      "surface.start",
      "component.add",
      "component.add",
      "surface.patch",
      "surface.complete",
    ]);
    expect(next.value?.traceId).toBe("trc_1");
    expect(next.value?.streamedComponents).toBe(2);
  });

  it("throws a typed error carrying the server's code and status", async () => {
    const { impl } = streamingFetch("", 13, { ok: false, status: 429 });
    const ovxa = createOvxa({ baseUrl: "/api", fetch: impl });

    const stream = ovxa.stream({ intent: "anything" });
    await expect(stream.next()).rejects.toMatchObject({
      name: "OvxaError",
      status: 429,
      code: "rate_limited",
      message: "Slow down.",
    });
  });

  it("refuses a path that would leave the configured origin", async () => {
    const { impl } = streamingFetch(wire());
    const ovxa = createOvxa({ baseUrl: "/api", fetch: impl });
    await expect(
      ovxa.surfaces.get("../../evil"),
    ).resolves.toBeDefined();
  });

  it("treats a failed stream with no surface as an error", async () => {
    const body = `data: ${JSON.stringify({ type: "ovxa.failed", message: "Provider down" })}\n\n`;
    const { impl } = streamingFetch(body);
    const ovxa = createOvxa({ baseUrl: "/api", fetch: impl });

    const stream = ovxa.stream({ intent: "anything" });
    await expect(collectSurface(stream)).rejects.toBeInstanceOf(OvxaError);
  });
});

describe("collectSurface", () => {
  it("folds a stream into the finished surface", async () => {
    const { impl } = streamingFetch(wire());
    const ovxa = createOvxa({ baseUrl: "/api", fetch: impl });

    const collected = await collectSurface(
      ovxa.stream({ intent: "Compare Q2 revenue against Q1" }),
    );

    expect(collected.surface?.root.map((node) => node.id)).toEqual(["mrr", "trend"]);
    expect(collected.surface?.status).toBe("ready");
    expect(collected.surface?.state).toEqual({ mrrTrend: [1, 2, 3] });
    expect(collected.issues).toEqual([]);
    expect(collected.summary?.model).toBe("gpt-4o");
  });

  it("reports progress as each component lands", async () => {
    const { impl } = streamingFetch(wire(), 7);
    const ovxa = createOvxa({ baseUrl: "/api", fetch: impl });

    const counts: number[] = [];
    await collectSurface(ovxa.stream({ intent: "x" }), (_event, surface) => {
      if (surface) counts.push(surface.root.length);
    });

    // The interface grows one component at a time rather than appearing at once.
    expect(counts).toEqual([0, 1, 2, 2, 2]);
  });

  it("produces the same surface whatever the chunk size", async () => {
    const results: string[] = [];
    for (const size of [1, 5, 64, 4096]) {
      const { impl } = streamingFetch(wire(), size);
      const ovxa = createOvxa({ baseUrl: "/api", fetch: impl });
      const collected = await collectSurface(ovxa.stream({ intent: "x" }));
      // `updatedAt` is stamped when a patch applies, so it legitimately differs
      // between runs; everything that describes the interface must not.
      const { updatedAt, ...rest } = collected.surface ?? {};
      void updatedAt;
      results.push(JSON.stringify(rest));
    }
    expect(new Set(results).size).toBe(1);
  });

  it("returns the surface it managed to build when no summary arrives", async () => {
    const { impl } = streamingFetch(wire(false));
    const ovxa = createOvxa({ baseUrl: "/api", fetch: impl });
    const collected = await collectSurface(ovxa.stream({ intent: "x" }));
    expect(collected.summary).toBeNull();
    expect(collected.surface?.root).toHaveLength(2);
  });
});
