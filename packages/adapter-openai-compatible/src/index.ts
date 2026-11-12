/**
 * OpenAI-compatible adapter.
 *
 * Works with DeepSeek and Volcengine Ark (Doubao) because both expose the
 * OpenAI `/chat/completions` streaming shape. It supports optional tool calls;
 * the host decides whether a tool may run (approval/policy) and returns a
 * result. The adapter never executes tools itself.
 */

import {
  AdapterError,
  createMessageId,
  defineAdapter,
  isAbortError,
  normalizeBaseUrl,
  type AgentAdapter,
  type AgentAdapterHandlers,
  type ToolCall,
  type ToolDefinition,
} from "@vance/adapter-sdk";

export interface OpenAICompatibleConfig {
  id?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface ToolCallPayload {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCallPayload[];
  tool_call_id?: string;
}

interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
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
  private readonly tools: ToolDefinition[];
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
    this.tools = config.tools ?? [];
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
      for (let round = 0; round < 5; round++) {
        const result = await this.streamOnce(messageId, controller.signal);
        if (result.toolCalls.length > 0) {
          this.history.push({
            role: "assistant",
            content: result.content || null,
            tool_calls: result.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          });

          for (const call of result.toolCalls) {
            let toolResult;
            try {
              toolResult = this.handlers.onToolCall
                ? await this.handlers.onToolCall(call)
                : { ok: false, content: "Tool calls are not enabled in this host." };
            } catch (error) {
              toolResult = {
                ok: false,
                content: `Tool handler failed: ${error instanceof Error ? error.message : String(error)}`,
              };
            }
            this.history.push({
              role: "tool",
              tool_call_id: call.id,
              content: toolResult.content,
            });
          }
          continue;
        }

        if (result.content) this.history.push({ role: "assistant", content: result.content });
        this.handlers.onStatus?.("done");
        return;
      }
      throw new AdapterError("tool loop exceeded 5 rounds", "protocol");
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

  private async streamOnce(messageId: string, signal: AbortSignal): Promise<StreamResult> {
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
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        ...(this.tools.length > 0 ? { tools: this.tools } : {}),
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AdapterError(
        `provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
        "http",
      );
    }
    if (!response.body) throw new AdapterError("provider returned no body", "protocol");

    let content = "";
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
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
        const delta = (
          parsed as {
            choices?: {
              delta?: {
                content?: unknown;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }[];
          }
        ).choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content) {
          content += delta.content;
          this.handlers.onChat?.(messageId, delta.content, true);
        }
        for (const part of delta?.tool_calls ?? []) {
          const index = typeof part.index === "number" ? part.index : 0;
          const call = calls.get(index) ?? { id: "", name: "", arguments: "" };
          if (part.id) call.id = part.id;
          if (part.function?.name) call.name += part.function.name;
          if (part.function?.arguments) call.arguments += part.function.arguments;
          calls.set(index, call);
        }
      }
    }

    const toolCalls = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        id: call.id || `tool_${messageId}_${index}`,
        name: call.name,
        arguments: call.arguments,
      }))
      .filter((call) => call.name !== "");

    return { content, toolCalls };
  }
}

export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleConfig,
  handlers: AgentAdapterHandlers,
): OpenAICompatibleAdapter {
  return defineAdapter(new OpenAICompatibleAdapter(config, handlers));
}
