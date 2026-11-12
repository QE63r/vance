import { describe, expect, it } from "vitest";
import {
  AdapterError,
  createMessageId,
  defineAdapter,
  isAbortError,
  normalizeBaseUrl,
  type AgentAdapter,
} from "../src/index.js";

describe("adapter SDK", () => {
  it("normalizes provider base URLs", () => {
    expect(normalizeBaseUrl("https://api.deepseek.com/")).toBe("https://api.deepseek.com");
    expect(normalizeBaseUrl("  https://ark.example.com/api/v3/// ")).toBe("https://ark.example.com/api/v3");
  });

  it("creates stable, prefixed message ids", () => {
    const id = createMessageId("deepseek");
    expect(id).toMatch(/^deepseek_[a-f0-9]{16}$/);
    expect(createMessageId("x")).not.toBe(createMessageId("x"));
  });

  it("defines an adapter without changing it", () => {
    const adapter: AgentAdapter = {
      id: "test",
      start: async () => undefined,
      prompt: async () => undefined,
      cancel: () => undefined,
      close: async () => undefined,
    };
    expect(defineAdapter(adapter)).toBe(adapter);
  });

  it("detects abort errors and exposes a typed AdapterError", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("nope"))).toBe(false);
    expect(new AdapterError("busy", "busy").code).toBe("busy");
  });
});
