import { describe, expect, it } from "vitest";
import {
  OpenAICompatibleAdapter,
  PROVIDERS,
  createOpenAICompatibleAdapter,
} from "../src/index.js";

function sse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

function content(value: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: value } }] })}\n\n`;
}

describe("OpenAI-compatible adapter", () => {
  it("streams content deltas and reports running/done", async () => {
    const chats: string[] = [];
    const statuses: string[] = [];
    const adapter = new OpenAICompatibleAdapter(
      {
        baseUrl: "https://api.example.com/",
        apiKey: "test-key",
        model: "test-model",
        systemPrompt: "be brief",
        fetchImpl: async () =>
          sse([content("你"), content("好"), "data: [DONE]\n\n"]),
      },
      {
        onChat: (_id, text) => chats.push(text),
        onStatus: (state) => statuses.push(state),
      },
    );

    await adapter.start();
    await adapter.prompt("  hello  ");

    expect(chats).toEqual(["你", "好"]);
    expect(statuses).toEqual(["running", "done"]);
    await adapter.close();
  });

  it("passes model, history and stream=true to the provider", async () => {
    let body: any = null;
    let url = "";
    const adapter = new OpenAICompatibleAdapter(
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "k",
        model: "m",
        systemPrompt: "sys",
        fetchImpl: async (input, init) => {
          url = String(input);
          body = JSON.parse(String(init?.body));
          return sse([content("ok"), "data: [DONE]\n\n"]);
        },
      },
      {},
    );

    await adapter.start();
    await adapter.prompt("first");
    await adapter.prompt("second");

    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(body.model).toBe("m");
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
    ]);
    await adapter.close();
  });

  it("rejects HTTP errors and reports them", async () => {
    const errors: string[] = [];
    const adapter = new OpenAICompatibleAdapter(
      {
        baseUrl: "https://api.example.com",
        apiKey: "k",
        model: "m",
        fetchImpl: async () => new Response("bad key", { status: 401 }),
      },
      { onError: (message) => errors.push(message) },
    );

    await adapter.start();
    await expect(adapter.prompt("hi")).rejects.toThrow(/HTTP 401/);
    expect(errors[0]).toMatch(/HTTP 401/);
    await adapter.close();
  });

  it("cancels an in-flight request", async () => {
    const statuses: string[] = [];
    const adapter = new OpenAICompatibleAdapter(
      {
        baseUrl: "https://api.example.com",
        apiKey: "k",
        model: "m",
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      },
      { onStatus: (state, detail) => statuses.push(detail ? `${state}:${detail}` : state) },
    );

    await adapter.start();
    const turn = adapter.prompt("hi");
    adapter.cancel();
    await turn;
    expect(statuses).toEqual(["running", "done:cancelled"]);
    await adapter.close();
  });

  it("exposes provider presets and a factory", async () => {
    expect(PROVIDERS.deepseek.model).toBe("deepseek-chat");
    const adapter = createOpenAICompatibleAdapter(
      {
        baseUrl: PROVIDERS.deepseek.baseUrl,
        apiKey: "k",
        model: PROVIDERS.deepseek.model,
        fetchImpl: async () => sse(["data: [DONE]\n\n"]),
      },
      {},
    );
    await adapter.start();
    await adapter.prompt("hi");
    await adapter.close();
  });
});
