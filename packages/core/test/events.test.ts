import { describe, expect, it } from "vitest";
import { AgentEvent, ApprovalRequest, EventEnvelope, StatusUpdate } from "../src/index.js";

/**
 * 这些测试不是"证明代码对"，而是把 adr/0002 的六条决定钉死。
 * 谁改了 schema，先看这里是哪一条红了。
 */

const valid = {
  request_id: "req_abc123",
  agent_id: "claude-code",
  project_id: "vance",
  timestamp: 1_760_000_000_000,
  raw_digest: "a".repeat(64),
  raw_ref: { key: "a".repeat(64), length: 128 },
  nonce: "0123456789abcdef",
  expires_at: 1_760_000_060_000,
  policy_version: "0.0.1",
  signer: "host:macbook",
  signature: "sig",
};

describe("信封", () => {
  it("接受完整字段", () => {
    expect(EventEnvelope.safeParse(valid).success).toBe(true);
  });

  it("缺少 raw_digest 时拒绝（D1：没有原文摘要就没有批准对象）", () => {
    const { raw_digest: _omit, ...rest } = valid;
    expect(EventEnvelope.safeParse(rest).success).toBe(false);
  });

  it("raw_digest 必须是 sha256 hex", () => {
    expect(EventEnvelope.safeParse({ ...valid, raw_digest: "not-a-digest" }).success).toBe(false);
  });

  it("时间必须是整数毫秒（D4）", () => {
    expect(EventEnvelope.safeParse({ ...valid, timestamp: 1_760_000_000_000.5 }).success).toBe(false);
  });

  it("字段集合一旦变化，快照即红", () => {
    expect(Object.keys(EventEnvelope.shape)).toMatchSnapshot();
  });
});

describe("审批请求", () => {
  const approval = {
    ...valid,
    type: "approval_request",
    action_display: "rm -rf src/legacy/",
  };

  it("正常事件通过", () => {
    expect(ApprovalRequest.safeParse(approval).success).toBe(true);
  });

  it("D2：发送方无权声明 risk —— 带上就直接判非法", () => {
    const withRisk = { ...approval, risk: "low" };
    expect(ApprovalRequest.safeParse(withRisk).success).toBe(false);
  });

  it("D5：审批类出现未知字段时拒绝", () => {
    const withUnknown = { ...approval, something_new: 1 };
    expect(ApprovalRequest.safeParse(withUnknown).success).toBe(false);
  });

  it("缺少 action_display 时拒绝（展示层至少要有个东西可显示）", () => {
    const { action_display: _omit, ...rest } = approval;
    expect(ApprovalRequest.safeParse(rest).success).toBe(false);
  });
});

describe("状态更新（D5 的另一半：宽容）", () => {
  it("未知字段被忽略，不导致失败", () => {
    const parsed = StatusUpdate.safeParse({
      ...valid,
      type: "status_update",
      state: "running",
      something_new: "ignored",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("something_new" in parsed.data).toBe(false);
    }
  });
});

describe("事件联合", () => {
  it("按 type 分派", () => {
    const parsed = AgentEvent.safeParse({
      ...valid,
      type: "approval_request",
      action_display: "rm -rf src/legacy/",
    });
    expect(parsed.success).toBe(true);
  });

  it("未知 type 被拒绝，不会静默通过", () => {
    expect(AgentEvent.safeParse({ ...valid, type: "something_else" }).success).toBe(false);
  });
});
