/**
 * OpenAI-compatible chat adapter.
 *
 * Works with DeepSeek and Volcengine Ark (Doubao) because both expose the
 * OpenAI `/chat/completions` streaming shape. This is a *chat* adapter: it
 * demonstrates the SDK and the external-agent path. Tool-call approvals are a
 * separate layer and are intentionally not implemented here.
 */

import {
  AdapterError,
  createMessageId,
  defineAdapter,
  isAbortError,
  normalizeBaseUrl,
  type AgentAdapter,
  type AgentAdapterHandlers,
} from "@vance/adapter-sdk";

export interface OpenAICompatibleConfig {
  id?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const PROVIDERS = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  ark: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
  },
} as const;

export class OpenAICompatibleAdapter implements AgentAdapter {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly systemPrompt: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly history: ChatMessage[] = [];
  private started = false;
  private closed = false;
  private running = false;
  private controller: AbortController | null = null;

  constructor(
    private readonly config: OpenAICompatibleConfig,
    private readonly handlers: AgentAdapterHandlers,
  ) {
    this.id = config.id ?? "openai-compatible";
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async start(): Promise<void> {
    if (this.closed) throw new AdapterError("adapter is closed", "closed");
    if (!this.baseUrl) throw new AdapterError("baseUrl is required", "not-started");
    if (!this.model) throw new AdapterError("model is required", "not-started");
    this.started = true;
  }

  async prompt(text: string): Promise<void> {
    if (this.closed) throw new AdapterError("adapter is closed", "closed");
    if (!this.started) throw new AdapterError("start() first", "not-started");
    if (this.running) throw new AdapterError("a turn is already running", "busy");

    const prompt = text.trim();
    if (!prompt) throw new AdapterError("prompt is empty", "protocol");

    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    const messageId = createMessageId(this.id);
    this.history.push({ role: "user", content: prompt });
    this.handlers.onStatus?.("running");

    try {
      const messages = [
        ...(this.systemPrompt ? [{ role: "system" as const, content: this.systemPrompt }] : []),
        ...this.history,
      ];
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, messages, stream: true }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AdapterError(
          `provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
          "http",
        );
      }
      if (!response.body) throw new AdapterError("provider returned no body", "protocol");

      let answer = "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            finished = true;
            break;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            throw new AdapterError("provider sent malformed SSE", "protocol");
          }
          const content = (parsed as { choices?: { delta?: { content?: unknown } }[] })
            .choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) {
            answer += content;
            this.handlers.onChat?.(messageId, content, true);
          }
        }
      }

      if (answer) this.history.push({ role: "assistant", content: answer });
      this.handlers.onStatus?.("done");
    } catch (error) {
      if (isAbortError(error)) {
        this.handlers.onStatus?.("done", "cancelled");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.handlers.onError?.(message);
      this.handlers.onStatus?.("error", message);
      throw error;
    } finally {
      this.running = false;
      this.controller = null;
    }
  }

  cancel(): void {
    this.controller?.abort();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.controller?.abort();
    this.history.length = 0;
  }
}

export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleConfig,
  handlers: AgentAdapterHandlers,
): OpenAICompatibleAdapter {
  return defineAdapter(new OpenAICompatibleAdapter(config, handlers));
}
