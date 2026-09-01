import type { LlmAdapter, LlmProvider, LlmRequest, LlmResponse } from "./types";

export interface LlmAdapterConfig {
  provider: LlmProvider;
  apiKey?: string;
  model: string;
  /** Vertex AI via ADC when set; otherwise a provider API key. */
  auth?: "api-key" | "vertex";
  project?: string;
  location?: string;
  getAccessToken?: () => Promise<string>;
  /** Override for gateways, proxies, and self-hosted OpenAI-compatible hosts. */
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxOutputTokens?: number;
}

const DEFAULT_BASE_URL: Record<LlmProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

const DEFAULT_TIMEOUT_MS = 45_000;
const GEMINI_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

let cachedVertexToken: { token: string; expiresAt: number } | null = null;

/**
 * Cloud Run / GCE Application Default Credentials. Same source Nuro uses on
 * Cloud Run; injected in tests via `getAccessToken`.
 */
export async function vertexAccessToken(): Promise<string> {
  if (cachedVertexToken && cachedVertexToken.expiresAt - Date.now() > 60_000) {
    return cachedVertexToken.token;
  }
  const response = await fetch(METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!response.ok) {
    throw new LlmRequestError(
      `Vertex ADC metadata failed with ${response.status}`,
      "gemini",
      response.status,
    );
  }
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) {
    throw new LlmRequestError("Vertex ADC returned no access token", "gemini");
  }
  const ttlMs =
    typeof body.expires_in === "number"
      ? body.expires_in * 1000
      : 55 * 60 * 1000;
  cachedVertexToken = {
    token: body.access_token,
    expiresAt: Date.now() + ttlMs,
  };
  return body.access_token;
}

/** Status codes worth retrying: rate limits and transient upstream failures. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function backoffMs(attempt: number): number {
  const base = 400 * 2 ** attempt;
  // Full jitter keeps concurrent sessions from retrying in lockstep.
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProvider,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmRequestError";
  }
}

/**
 * Models are asked for raw JSON, but providers still occasionally wrap it in a
 * fenced block or add a leading sentence. Recover the JSON document instead of
 * failing the whole generation.
 */
export function parseJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.search(/[[{]/);
    const end = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
    if (start < 0 || end <= start) {
      throw new Error("Model response did not contain a JSON document");
    }
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function requireApiKey(config: LlmAdapterConfig): string {
  if (!config.apiKey) {
    throw new LlmRequestError(
      `${config.provider} is missing an API key`,
      config.provider,
    );
  }
  return config.apiKey;
}

type ProviderCall = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  readText: (payload: unknown) => string;
  readUsage: (payload: unknown) => { inputTokens: number; outputTokens: number };
  /** Endpoint and body overrides that turn this call into a token stream. */
  stream: {
    url: string;
    body: Record<string, unknown>;
    /** Extracts the text delta from one decoded SSE frame, if it carries one. */
    readDelta: (payload: unknown) => string | null;
  };
};

function buildCall(config: LlmAdapterConfig, request: LlmRequest): ProviderCall {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL[config.provider]).replace(
    /\/$/,
    "",
  );
  const maxTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const temperature = request.temperature ?? 0.2;

  if (config.provider === "openai") {
    const body = {
      model: config.model,
      temperature,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: request.system }, ...request.messages],
    };
    return {
      url: `${baseUrl}/chat/completions`,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${requireApiKey(config)}`,
      },
      body,
      stream: {
        url: `${baseUrl}/chat/completions`,
        body: { ...body, stream: true },
        readDelta: (payload) => {
          if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
          const first = payload.choices[0];
          if (!isRecord(first) || !isRecord(first.delta)) return null;
          return typeof first.delta.content === "string" ? first.delta.content : null;
        },
      },
      readText: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";
        const first = payload.choices[0];
        if (!isRecord(first) || !isRecord(first.message)) return "";
        return typeof first.message.content === "string"
          ? first.message.content
          : "";
      },
      readUsage: (payload) => {
        const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {};
        return {
          inputTokens: readNumber(usage.prompt_tokens),
          outputTokens: readNumber(usage.completion_tokens),
        };
      },
    };
  }

  if (config.provider === "anthropic") {
    const body = {
      model: config.model,
      temperature,
      max_tokens: maxTokens,
      system: request.system,
      messages: request.messages,
    };
    return {
      url: `${baseUrl}/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": requireApiKey(config),
        "anthropic-version": "2023-06-01",
      },
      body,
      stream: {
        url: `${baseUrl}/messages`,
        body: { ...body, stream: true },
        readDelta: (payload) => {
          if (!isRecord(payload) || payload.type !== "content_block_delta") return null;
          if (!isRecord(payload.delta)) return null;
          return typeof payload.delta.text === "string" ? payload.delta.text : null;
        },
      },
      readText: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.content)) return "";
        return payload.content
          .flatMap((part) =>
            isRecord(part) && part.type === "text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
          .join("");
      },
      readUsage: (payload) => {
        const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {};
        return {
          inputTokens: readNumber(usage.input_tokens),
          outputTokens: readNumber(usage.output_tokens),
        };
      },
    };
  }

  const geminiModel = encodeURIComponent(config.model);
  const body = {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  };

  const vertex =
    config.auth === "vertex" && config.project
      ? {
          project: config.project,
          location: config.location ?? "us-central1",
        }
      : null;
  const geminiUrl = vertex
    ? (() => {
        const host =
          vertex.location === "global"
            ? "aiplatform.googleapis.com"
            : `${vertex.location}-aiplatform.googleapis.com`;
        const prefix =
          config.baseUrl ??
          `https://${host}/v1/projects/${encodeURIComponent(vertex.project)}/locations/${encodeURIComponent(vertex.location)}/publishers/google`;
        return {
          complete: `${prefix}/models/${geminiModel}:generateContent`,
          stream: `${prefix}/models/${geminiModel}:streamGenerateContent?alt=sse`,
        };
      })()
    : {
        complete: `${baseUrl}/models/${geminiModel}:generateContent`,
        stream: `${baseUrl}/models/${geminiModel}:streamGenerateContent?alt=sse`,
      };

  return {
    // Vertex uses a Bearer ADC token; the Gemini API key stays in a header, never the URL.
    url: geminiUrl.complete,
    headers: {
      "content-type": "application/json",
      ...(vertex
        ? {}
        : config.apiKey
          ? { "x-goog-api-key": config.apiKey }
          : {}),
    },
    body,
    stream: {
      url: geminiUrl.stream,
      body,
      readDelta: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.candidates)) return null;
        const first = payload.candidates[0];
        if (!isRecord(first) || !isRecord(first.content)) return null;
        const parts = first.content.parts;
        if (!Array.isArray(parts)) return null;
        const text = parts
          .flatMap((part) =>
            isRecord(part) && typeof part.text === "string" ? [part.text] : [],
          )
          .join("");
        return text.length > 0 ? text : null;
      },
    },
    readText: (payload) => {
      if (!isRecord(payload) || !Array.isArray(payload.candidates)) return "";
      const first = payload.candidates[0];
      if (!isRecord(first) || !isRecord(first.content)) return "";
      const parts = first.content.parts;
      if (!Array.isArray(parts)) return "";
      return parts
        .flatMap((part) =>
          isRecord(part) && typeof part.text === "string" ? [part.text] : [],
        )
        .join("");
    },
    readUsage: (payload) => {
      const usage =
        isRecord(payload) && isRecord(payload.usageMetadata)
          ? payload.usageMetadata
          : {};
      return {
        inputTokens: readNumber(usage.promptTokenCount),
        outputTokens: readNumber(usage.candidatesTokenCount),
      };
    },
  };
}

/**
 * Splits an SSE byte stream into decoded frame payloads.
 *
 * Provider chunks land mid-frame and mid-JSON, so a frame is only released on a
 * blank line. `[DONE]` and comment lines are dropped.
 */
function sseFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;

  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary === -1) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("");
    if (data.length > 0 && data !== "[DONE]") frames.push(data);
  }

  return { frames, rest };
}

/**
 * Real HTTP adapter for the three supported providers. Every call is bounded by
 * a timeout and retried with exponential backoff and full jitter; credentials
 * are only ever sent to the provider host.
 */
export function createLlmAdapter(config: LlmAdapterConfig): LlmAdapter {
  const timeoutMs =
    config.timeoutMs ??
    (config.provider === "gemini" ? GEMINI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function authorizedHeaders(
    headers: Record<string, string>,
  ): Promise<Record<string, string>> {
    if (config.auth !== "vertex") return headers;
    const token = await (config.getAccessToken ?? vertexAccessToken)();
    return {
      ...headers,
      authorization: `Bearer ${token}`,
    };
  }

  return {
    provider: config.provider,

    /**
     * Token deltas as they arrive. Deliberately not retried: a caller that has
     * already received and rendered part of a document cannot have it replaced
     * by a second attempt, so a mid-stream failure is surfaced instead of
     * silently restarted.
     */
    async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<string> {
      const call = buildCall(config, request);
      const controller = new AbortController();
      const abort = (): void => {
        controller.abort();
      };
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);

      try {
        const response = await fetch(call.stream.url, {
          method: "POST",
          headers: {
            ...(await authorizedHeaders(call.headers)),
            accept: "text/event-stream",
          },
          body: JSON.stringify(call.stream.body),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new LlmRequestError(
            `${config.provider} stream failed with ${response.status}`,
            config.provider,
            response.status,
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { frames, rest } = sseFrames(buffer);
            buffer = rest;
            for (const frame of frames) {
              let payload: unknown;
              try {
                payload = JSON.parse(frame);
              } catch {
                continue;
              }
              const delta = call.stream.readDelta(payload);
              if (delta !== null && delta.length > 0) yield delta;
            }
          }
        } finally {
          reader.releaseLock();
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
    async complete<T>(request: LlmRequest): Promise<LlmResponse<T>> {
      const call = buildCall(config, request);
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(call.url, {
            method: "POST",
            headers: await authorizedHeaders(call.headers),
            body: JSON.stringify(call.body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const detail = (await response.text()).slice(0, 500);
            const error = new LlmRequestError(
              `${config.provider} request failed with ${response.status}: ${detail}`,
              config.provider,
              response.status,
            );
            if (attempt < maxRetries && isRetryable(response.status)) {
              lastError = error;
              await sleep(backoffMs(attempt));
              continue;
            }
            throw error;
          }

          const payload: unknown = await response.json();
          const text = call.readText(payload);
          if (text.trim().length === 0) {
            throw new LlmRequestError(
              `${config.provider} returned an empty completion`,
              config.provider,
            );
          }
          return {
            provider: config.provider,
            model: config.model,
            output: parseJsonPayload(text) as T,
            usage: call.readUsage(payload),
          };
        } catch (error) {
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          const aborted = normalized.name === "AbortError";
          const retryable =
            attempt < maxRetries &&
            (aborted || !(normalized instanceof LlmRequestError));
          if (!retryable) {
            throw aborted
              ? new LlmRequestError(
                  `${config.provider} request timed out after ${timeoutMs}ms`,
                  config.provider,
                )
              : normalized;
          }
          lastError = normalized;
          await sleep(backoffMs(attempt));
        } finally {
          clearTimeout(timer);
        }
      }

      throw (
        lastError ??
        new LlmRequestError(
          `${config.provider} request failed`,
          config.provider,
        )
      );
    },
  };
}
