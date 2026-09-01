export type LlmProvider = "openai" | "anthropic" | "gemini";

export interface LlmRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
}

export interface LlmResponse<T = unknown> {
  provider: LlmProvider;
  model: string;
  output: T;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LlmAdapter {
  readonly provider: LlmProvider;
  complete<T>(request: LlmRequest): Promise<LlmResponse<T>>;
  /**
   * The same completion delivered as text deltas. Optional so that a
   * bring-your-own provider only has to implement `complete`; generation then
   * streams structurally instead of by token, with no caller-side branching.
   *
   * Callers must treat the chunks as an unfinished document: nothing downstream
   * may assume a chunk boundary falls anywhere meaningful.
   */
  stream?(request: LlmRequest, signal?: AbortSignal): AsyncIterable<string>;
}

export class ProviderIndependentLlmGateway {
  private readonly adapters = new Map<LlmProvider, LlmAdapter>();

  register(adapter: LlmAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  async complete<T>(
    provider: LlmProvider,
    request: LlmRequest,
  ): Promise<LlmResponse<T>> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`LLM provider "${provider}" is not configured`);
    }
    return adapter.complete<T>(request);
  }

  configuredProviders(): LlmProvider[] {
    return [...this.adapters.keys()];
  }
}
