import { describe, expect, it } from "vitest";
import { AgentEvent, EventEnvelope } from "../src/index.js";

const valid = {
  request_id: "6f1b1c8e-3f1a-4b6e-9a54-2d0f0b7c1d11",
  agent_id: "claude-code",
  project_id: "vance",
  timestamp: 1_760_000_000,
  action_digest: "a".repeat(64),
  nonce: "0123456789abcdef",
  expires_at: 1_760_000_060,
  policy_version: "0.0.1",
  signer: "host:macbook",
  signature: "sig",
};

describe("事件信封", () => {
  it("接受完整字段", () => {
    expect(EventEnvelope.safeParse(valid).success).toBe(true);
  });

  it("缺少 nonce 时拒绝（防重放的前提）", () => {
    const { nonce: _nonce, ...rest } = valid;
    expect(EventEnvelope.safeParse(rest).success).toBe(false);
  });

  it("action_digest 必须是 sha256 hex", () => {
    expect(EventEnvelope.safeParse({ ...valid, action_digest: "not-a-digest" }).success).toBe(false);
  });

  it("字段集合一旦变化，快照即红", () => {
    expect(Object.keys(EventEnvelope.shape)).toMatchSnapshot();
  });
});

describe("事件联合", () => {
  it("按 type 分派到 approval_request", () => {
    const parsed = AgentEvent.safeParse({
      ...valid,
      type: "approval_request",
      action: "rm -rf src/legacy/",
      risk: "high",
    });
    expect(parsed.success).toBe(true);
  });

  it("未知 type 被拒绝，不会静默通过", () => {
    expect(AgentEvent.safeParse({ ...valid, type: "something_else" }).success).toBe(false);
  });
});
