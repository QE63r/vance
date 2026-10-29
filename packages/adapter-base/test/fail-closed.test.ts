import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@vance/core";
import { BaseAdapter, type AdapterContext } from "../src/index.js";

const NOW = 1_760_000_000;

const baseEvent = {
  request_id: "6f1b1c8e-3f1a-4b6e-9a54-2d0f0b7c1d11",
  agent_id: "test",
  project_id: "vance",
  timestamp: NOW,
  action_digest: "a".repeat(64),
  nonce: "0123456789abcdef",
  expires_at: NOW + 60,
  policy_version: "0.0.1",
  signer: "host:test",
  signature: "sig",
  type: "approval_request",
  action: "rm -rf /tmp/x",
  risk: "high",
  facts: {},
} as unknown as AgentEvent;

class TestAdapter extends BaseAdapter {
  readonly agentId = "test";
  constructor(private readonly behaviour: "ok" | "null" | "throw") {
    super();
  }
  protected translate(): AgentEvent | null {
    if (this.behaviour === "throw") throw new Error("bad payload");
    if (this.behaviour === "null") return null;
    return baseEvent;
  }
}

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  nowSeconds: NOW,
  connected: true,
  ...over,
});

describe("fail-closed 基类", () => {
  it("未连接时拒绝", () => {
    const out = new TestAdapter("ok").handle({}, ctx({ connected: false }));
    expect(out).toEqual({ decision: "DENY", reason: "disconnected" });
  });

  it("翻译抛错时拒绝，且不向外抛", () => {
    expect(() => new TestAdapter("throw").handle({}, ctx())).not.toThrow();
    expect(new TestAdapter("throw").handle({}, ctx())).toEqual({
      decision: "DENY",
      reason: "malformed",
    });
  });

  it("不认识的事件拒绝，而不是静默放行", () => {
    expect(new TestAdapter("null").handle({}, ctx())).toEqual({
      decision: "DENY",
      reason: "unknown_event",
    });
  });

  it("过期即拒绝", () => {
    const out = new TestAdapter("ok").handle({}, ctx({ nowSeconds: NOW + 61 }));
    expect(out).toEqual({ decision: "DENY", reason: "expired" });
  });

  it("审批请求默认要求人工批准，不会自动放行", () => {
    expect(new TestAdapter("ok").handle({}, ctx()).decision).toBe("APPROVAL");
  });
});
