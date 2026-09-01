import type { LlmProvider } from "./types";

/** Provider defaults, overridable with `OVXA_LLM_MODEL`. */
const DEFAULT_MODEL: Record<LlmProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.5-flash",
};

/** Provider-specific key names, checked after the generic `OVXA_LLM_API_KEY`. */
const KEY_ENV: Record<LlmProvider, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

const PROVIDERS: readonly LlmProvider[] = ["openai", "anthropic", "gemini"];

export type LlmAuth = "api-key" | "vertex";

export type LlmConfiguration =
  | {
      status: "configured";
      provider: LlmProvider;
      model: string;
      auth: LlmAuth;
      apiKey?: string;
      project?: string;
      location?: string;
      baseUrl?: string;
    }
  | { status: "disabled"; reason: string };

export type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isProvider(value: string): value is LlmProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function isCloudRun(env: Env): boolean {
  return Boolean(read(env, "K_SERVICE"));
}

export function resolveGcpProject(env: Env): string | undefined {
  if (isCloudRun(env)) {
    return read(env, "GOOGLE_CLOUD_PROJECT") ?? read(env, "GCP_PROJECT");
  }
  return (
    read(env, "GCP_PROJECT") ??
    read(env, "SECRET_MANAGER_PROJECT") ??
    read(env, "GOOGLE_CLOUD_PROJECT")
  );
}

/**
 * Same rule as Nuro: Vertex AI via ADC when a GCP project is known and either
 * `VERTEX_ENABLED` is on or the process is running on Cloud Run.
 */
export function vertexEnabled(env: Env): boolean {
  const project = resolveGcpProject(env);
  if (!project) return false;
  const flag = read(env, "VERTEX_ENABLED")?.toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return isCloudRun(env);
}

export function vertexLocation(env: Env): string {
  return read(env, "GCP_LOCATION") ?? "us-central1";
}

function findKey(env: Env, provider: LlmProvider): string | undefined {
  const generic = read(env, "OVXA_LLM_API_KEY");
  // A leftover OpenAI secret must not be sent to Gemini as if it were an API key.
  if (generic && !(provider === "gemini" && generic.startsWith("sk-"))) {
    return generic;
  }
  for (const name of KEY_ENV[provider]) {
    const value = read(env, name);
    if (value) return value;
  }
  return undefined;
}

function geminiModel(env: Env): string {
  return (
    read(env, "OVXA_LLM_MODEL") ??
    read(env, "GEMINI_MODEL") ??
    DEFAULT_MODEL.gemini
  );
}

/**
 * Resolve the hosted AI configuration from the environment. Google (Gemini) is
 * the default, matching Nuro: Vertex ADC on Cloud Run, otherwise a Gemini API
 * key. When no credential is present the runtime stays on the deterministic
 * model rather than failing.
 */
export function resolveLlmConfig(env: Env): LlmConfiguration {
  const requested = read(env, "OVXA_LLM_PROVIDER")?.toLowerCase();
  if (requested && !isProvider(requested)) {
    return {
      status: "disabled",
      reason: `OVXA_LLM_PROVIDER "${requested}" is not one of ${PROVIDERS.join(", ")}`,
    };
  }

  const useVertex = vertexEnabled(env);
  const provider =
    requested && isProvider(requested)
      ? requested
      : useVertex || findKey(env, "gemini")
        ? "gemini"
        : PROVIDERS.find((candidate) => findKey(env, candidate));

  if (!provider) {
    return {
      status: "disabled",
      reason: "No AI provider credential is configured",
    };
  }

  const apiKey = findKey(env, provider);
  const model =
    provider === "gemini"
      ? geminiModel(env)
      : (read(env, "OVXA_LLM_MODEL") ?? DEFAULT_MODEL[provider]);
  const baseUrl = read(env, "OVXA_LLM_BASE_URL");

  if (provider === "gemini" && useVertex) {
    const project = resolveGcpProject(env);
    if (!project) {
      return {
        status: "disabled",
        reason: "Vertex is selected but GCP_PROJECT / GOOGLE_CLOUD_PROJECT is missing",
      };
    }
    return {
      status: "configured",
      provider,
      model,
      auth: "vertex",
      project,
      location: vertexLocation(env),
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  }

  if (!apiKey) {
    return {
      status: "disabled",
      reason: `${provider} is selected but its API key is missing`,
    };
  }

  return {
    status: "configured",
    provider,
    model,
    auth: "api-key",
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

/** Safe description for health checks and the studio settings page. */
export function describeLlmConfig(config: LlmConfiguration): {
  engine: "hosted-llm" | "deterministic";
  provider: LlmProvider | null;
  model: string | null;
  detail: string;
} {
  if (config.status === "configured") {
    const via = config.auth === "vertex" ? " · vertex" : "";
    return {
      engine: "hosted-llm",
      provider: config.provider,
      model: config.model,
      detail: `${config.provider} · ${config.model}${via}`,
    };
  }
  return {
    engine: "deterministic",
    provider: null,
    model: null,
    detail: config.reason,
  };
}
