import type { CompileTraceEntry, GroundingIssue, UiPlan } from "@ovxa/compiler";
import type { IntelligenceReport } from "@ovxa/intelligence";
import { safeParseSurfaceEvent, type SurfaceEvent } from "@ovxa/protocol";
import type { JsonValue, Surface, SurfacePatchOperation } from "@ovxa/schema";
import { SseDecoder } from "@ovxa/streaming";

/**
 * The transport. Generation is a server concern — the provider credential lives
 * there and the compiler's guarantees are only guarantees if the browser cannot
 * skip them — so this client's whole job is to be an unsurprising way to reach it.
 */

export type OvxaClientOptions = {
  /**
   * A server key. Never ship one to a browser: use a publishable key against
   * your own backend route instead, which is what `baseUrl` is for.
   */
  apiKey?: string;
  /** Defaults to a same-origin `/api`, which is what an embedded app wants. */
  baseUrl?: string;
  /** Extra headers, e.g. a tenant id for a multi-tenant embed. */
  headers?: Record<string, string>;
  /** Applies to non-streaming calls. Streams are bounded by the server. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export type GenerateRequest = {
  /** What the user is trying to accomplish, in their words. */
  intent: string;
  /**
   * Application data the surface may bind to. Authoritative: the model can add
   * keys it needs but can never overwrite what you supply.
   */
  state?: Record<string, JsonValue>;
  locale?: string;
  signal?: AbortSignal;
};

export type VisualizeRequest = {
  /** What the reader should take away. Shapes the interface, not the data. */
  intent: string;
  /** Already-computed data. Sent as state, so it is never re-derived. */
  data: Record<string, JsonValue>;
  locale?: string;
  signal?: AbortSignal;
};

export type GenerateResult = {
  surface: Surface;
  plan: UiPlan;
  issues: GroundingIssue[];
  trace: CompileTraceEntry[];
  intelligence: IntelligenceReport;
  usedFallback: boolean;
  model: string;
  engine: string;
  elapsedMs: number;
};

/** The decision and cost of a finished stream, delivered as its last frame. */
export type StreamSummary = {
  traceId: string;
  surfaceId: string;
  plan: UiPlan;
  engine: string;
  model: string;
  usedFallback: boolean;
  degradedReason: string | null;
  issues: GroundingIssue[];
  trace: CompileTraceEntry[];
  intelligence: IntelligenceReport;
  /** Empty on a clean hosted generation; populated when the model struggled. */
  modelAttempts: Array<{
    stage: "plan" | "generate" | "repair";
    outcome: "ok" | "invalid" | "failed";
    durationMs: number;
    reason?: string;
  }>;
  streamedComponents: number;
  timeToShellMs: number;
  timeToFirstComponentMs: number | null;
  elapsedMs: number;
};

export type SurfaceRecordView = {
  surface: Surface;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ActResult = {
  surface: Surface;
  revision: number;
  message?: string;
  /** Operations the surface refused. Surfaced rather than thrown. */
  rejected: string[];
};

export class OvxaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "OvxaError";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** A path must stay on the configured origin; it is never a full URL. */
function validatePath(path: string): void {
  if (!/^\/[^/]/.test(path)) {
    throw new OvxaError(`Invalid request path "${path}"`, 400, "invalid_path");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The server's error shape, or a generic message if it sent something else. */
function readError(status: number, body: unknown): OvxaError {
  if (isRecord(body)) {
    const message = typeof body.message === "string" ? body.message : "Request failed";
    const code = typeof body.error === "string" ? body.error : "request_failed";
    return new OvxaError(message, status, code);
  }
  return new OvxaError("Request failed", status, "request_failed");
}

export type OvxaClient = {
  /** Compile one surface and return it whole. */
  generate(request: GenerateRequest): Promise<GenerateResult>;
  /**
   * Compile one surface progressively.
   *
   * Yields protocol events in order. Apply them with a `SurfaceStreamReducer`,
   * or let `<OVXASurface>` do it. The final `summary` frame is returned rather
   * than yielded, so the loop only ever sees surface events.
   */
  stream(request: GenerateRequest): AsyncGenerator<SurfaceEvent, StreamSummary | null>;
  /** Turn data you already computed into an interface, without a second prompt. */
  visualize(request: VisualizeRequest): Promise<GenerateResult>;
  surfaces: {
    get(id: string, signal?: AbortSignal): Promise<SurfaceRecordView>;
    /** Patch a stored surface directly, e.g. from your own server events. */
    patch(
      id: string,
      operations: SurfacePatchOperation[],
      signal?: AbortSignal,
    ): Promise<ActResult>;
    /** Run a registered action and get the patched surface back. */
    act(
      id: string,
      actionId: string,
      input?: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<ActResult>;
  };
  /** Component and action names this project allows a model to reference. */
  registry(signal?: AbortSignal): Promise<{
    engine: string;
    components: Array<{ name: string; description: string; intents: string[] }>;
    actions: Array<{ id: string; description: string; risk: string }>;
  }>;
};

export function createOvxa(options: OvxaClientOptions = {}): OvxaClient {
  const base = (options.baseUrl ?? "/api").replace(/\/$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof doFetch !== "function") {
    throw new OvxaError(
      "No fetch implementation available; pass one via createOvxa({ fetch })",
      500,
      "no_fetch",
    );
  }

  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
    ...options.headers,
  });

  /**
   * One request. The path is validated and joined to the configured origin, so a
   * caller cannot redirect a request carrying the API key to another host.
   */
  const send = async <T>(
    path: string,
    init: { method: string; body?: unknown; signal?: AbortSignal },
  ): Promise<T> => {
    validatePath(path);
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
    };
    init.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);

    try {
      const response = await doFetch(`${base}${path}`, {
        method: init.method,
        headers: headers(),
        credentials: "include",
        signal: controller.signal,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw readError(response.status, payload);
      return payload as T;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  };

  return {
    generate: (request) =>
      send<GenerateResult>("/genui/generate", {
        method: "POST",
        body: {
          intent: request.intent,
          ...(request.state ? { state: request.state } : {}),
          ...(request.locale ? { locale: request.locale } : {}),
        },
        ...(request.signal ? { signal: request.signal } : {}),
      }),

    /**
     * Data-first generation.
     *
     * The data is sent as surface state, which is why this costs one model call
     * rather than two: the caller has already done the computing, so the model
     * only has to decide how it should be read.
     */
    visualize: (request) =>
      send<GenerateResult>("/genui/generate", {
        method: "POST",
        body: {
          intent: request.intent,
          state: request.data,
          ...(request.locale ? { locale: request.locale } : {}),
        },
        ...(request.signal ? { signal: request.signal } : {}),
      }),

    async *stream(request) {
      validatePath("/genui/stream");
      const response = await doFetch(`${base}/genui/stream`, {
        method: "POST",
        headers: { ...headers(), accept: "text/event-stream" },
        credentials: "include",
        ...(request.signal ? { signal: request.signal } : {}),
        body: JSON.stringify({
          intent: request.intent,
          ...(request.state ? { state: request.state } : {}),
          ...(request.locale ? { locale: request.locale } : {}),
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw readError(response.status, payload);
      }

      /**
       * The stream carries surface protocol events plus one trailing envelope
       * that is deliberately not part of the protocol — the trace and the
       * decision belong to the SDK, not to the renderer. Both are decoded from
       * the same frames here: events are yielded, the envelope is returned.
       */
      if (!response.body) return null;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const sse = new SseDecoder();
      let summary: StreamSummary | null = null;
      let failure: string | null = null;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const frame of sse.push(decoder.decode(value, { stream: true }))) {
            let payload: unknown;
            try {
              payload = JSON.parse(frame);
            } catch {
              continue;
            }

            const event = safeParseSurfaceEvent(payload);
            if (event) {
              yield event;
              continue;
            }

            if (!isRecord(payload)) continue;
            if (payload.type === "ovxa.summary") {
              summary = payload.summary as StreamSummary;
            } else if (payload.type === "ovxa.failed") {
              failure =
                typeof payload.message === "string" ? payload.message : "Generation failed";
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // A stream that produced no surface at all is an error, not an empty result.
      if (failure && !summary) {
        throw new OvxaError(failure, 502, "generation_failed");
      }
      return summary;
    },

    surfaces: {
      get: (id, signal) =>
        send<SurfaceRecordView>(`/genui/surfaces/${encodeURIComponent(id)}`, {
          method: "GET",
          ...(signal ? { signal } : {}),
        }),
      patch: (id, operations, signal) =>
        send<ActResult>(`/genui/surfaces/${encodeURIComponent(id)}/patch`, {
          method: "POST",
          body: { operations },
          ...(signal ? { signal } : {}),
        }),
      act: (id, actionId, input, signal) =>
        send<ActResult>(`/genui/surfaces/${encodeURIComponent(id)}/actions`, {
          method: "POST",
          body: { actionId, input: input ?? {} },
          ...(signal ? { signal } : {}),
        }),
    },

    registry: (signal) =>
      send("/genui/registry", { method: "GET", ...(signal ? { signal } : {}) }),
  };
}