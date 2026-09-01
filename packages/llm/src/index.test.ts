import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LlmRequestError,
  createLlmAdapter,
  describeLlmConfig,
  parseJsonPayload,
  resolveLlmConfig,
} from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function openAiBody(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  };
}

describe("llm configuration", () => {
  it("stays disabled with a reason when no credential is present", () => {
    const config = resolveLlmConfig({});
    expect(config.status).toBe("disabled");
    expect(describeLlmConfig(config)).toMatchObject({
      engine: "deterministic",
      provider: null,
    });
  });

  it("infers the provider from whichever key is configured", () => {
    const config = resolveLlmConfig({ ANTHROPIC_API_KEY: "sk-test" });
    expect(config).toMatchObject({
      status: "configured",
      provider: "anthropic",
      apiKey: "sk-test",
    });
  });

  it("honours an explicit provider and model", () => {
    const config = resolveLlmConfig({
      OVXA_LLM_PROVIDER: "gemini",
      OVXA_LLM_MODEL: "gemini-2.5-pro",
      GOOGLE_API_KEY: "goog-test",
    });
    expect(config).toMatchObject({
      status: "configured",
      provider: "gemini",
      model: "gemini-2.5-pro",
      auth: "api-key",
    });
    expect(describeLlmConfig(config).engine).toBe("hosted-llm");
  });

  it("defaults Gemini to 2.5 Flash, the same model Nuro uses for chat", () => {
    const config = resolveLlmConfig({
      OVXA_LLM_PROVIDER: "gemini",
      GOOGLE_API_KEY: "goog-test",
    });
    expect(config).toMatchObject({
      status: "configured",
      provider: "gemini",
      model: "gemini-2.5-flash",
    });
  });

  it("uses Vertex ADC on Cloud Run without an API key, like Nuro", () => {
    const config = resolveLlmConfig({
      K_SERVICE: "ovxa",
      GOOGLE_CLOUD_PROJECT: "nuro-459222",
    });
    expect(config).toMatchObject({
      status: "configured",
      provider: "gemini",
      auth: "vertex",
      project: "nuro-459222",
      location: "us-central1",
      model: "gemini-2.5-flash",
    });
    expect(describeLlmConfig(config).detail).toContain("vertex");
  });

  it("does not send a leftover OpenAI secret to Gemini", () => {
    const config = resolveLlmConfig({
      OVXA_LLM_PROVIDER: "gemini",
      OVXA_LLM_API_KEY: "sk-openai-leftover",
      GOOGLE_API_KEY: "AIza-real",
    });
    expect(config).toMatchObject({
      status: "configured",
      provider: "gemini",
      auth: "api-key",
      apiKey: "AIza-real",
    });
  });

  it("refuses an unknown provider instead of silently guessing", () => {
    const config = resolveLlmConfig({
      OVXA_LLM_PROVIDER: "llama",
      OPENAI_API_KEY: "sk-test",
    });
    expect(config).toMatchObject({ status: "disabled" });
  });

  it("reports a selected provider whose key is missing", () => {
    const config = resolveLlmConfig({ OVXA_LLM_PROVIDER: "openai" });
    expect(config.status).toBe("disabled");
    if (config.status === "disabled") {
      expect(config.reason).toMatch(/openai/);
    }
  });
});

describe("json recovery", () => {
  it("reads a fenced json document", () => {
    expect(parseJsonPayload('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("recovers json wrapped in prose", () => {
    expect(parseJsonPayload('Sure! {"a":[1,2]} done')).toEqual({ a: [1, 2] });
  });

  it("throws when there is no json at all", () => {
    expect(() => parseJsonPayload("no payload here")).toThrow(/JSON/);
  });
});

describe("llm adapter", () => {
  it("sends the credential to the provider and parses the completion", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(openAiBody('{"title":"Retention"}')));
    globalThis.fetch = fetchMock;

    const adapter = createLlmAdapter({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
    });
    const response = await adapter.complete<{ title: string }>({
      system: "system",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response.output.title).toBe("Retention");
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/chat/completions");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
  });

  it("keeps the gemini key in a header rather than the query string", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
      }),
    );
    globalThis.fetch = fetchMock;

    const adapter = createLlmAdapter({
      provider: "gemini",
      apiKey: "goog-secret",
      model: "gemini-2.0-flash",
    });
    await adapter.complete({ system: "s", messages: [{ role: "user", content: "u" }] });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("goog-secret");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("goog-secret");
  });

  it("calls Vertex generateContent with a Bearer ADC token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      }),
    );
    globalThis.fetch = fetchMock;

    const adapter = createLlmAdapter({
      provider: "gemini",
      auth: "vertex",
      project: "nuro-459222",
      location: "us-central1",
      model: "gemini-2.5-flash",
      getAccessToken: async () => "ya29.test-token",
    });
    await adapter.complete({ system: "s", messages: [{ role: "user", content: "u" }] });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(
      "us-central1-aiplatform.googleapis.com/v1/projects/nuro-459222",
    );
    expect(String(url)).toContain("publishers/google/models/gemini-2.5-flash:generateContent");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ya29.test-token");
    expect(headers["x-goog-api-key"]).toBeUndefined();
  });

  it("retries a rate limit and then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429))
      .mockResolvedValueOnce(jsonResponse(openAiBody('{"ok":true}')));
    globalThis.fetch = fetchMock;

    const adapter = createLlmAdapter({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
      maxRetries: 1,
    });
    const response = await adapter.complete<{ ok: boolean }>({
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });

    expect(response.output.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a credential rejection", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "bad key" }, 401));
    globalThis.fetch = fetchMock;

    const adapter = createLlmAdapter({
      provider: "anthropic",
      apiKey: "bad",
      model: "claude-sonnet-4-20250514",
      maxRetries: 3,
    });

    await expect(
      adapter.complete({ system: "s", messages: [{ role: "user", content: "u" }] }),
    ).rejects.toBeInstanceOf(LlmRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails when the provider returns an empty completion", async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(openAiBody("   ")));
    const adapter = createLlmAdapter({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
      maxRetries: 0,
    });
    await expect(
      adapter.complete({ system: "s", messages: [{ role: "user", content: "u" }] }),
    ).rejects.toThrow(/empty completion/);
  });
});
