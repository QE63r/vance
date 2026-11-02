import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defaultOptions, pickAcpOption, translateAcpLine } from "../src/index.js";

/**
 * 用真实录制下来的 ACP 报文测翻译层。
 * 这些 JSON 就是 opencode 1.19.5 实际发出来的形状。
 */

const opts = { ...defaultOptions("sandbox", 1_700_000_000_000), nonce: () => "fixed-nonce-123456" };

const permissionLine = JSON.stringify({
  jsonrpc: "2.0",
  id: 7,
  method: "session/request_permission",
  params: {
    sessionId: "ses_abc",
    toolCall: {
      toolCallId: "call_00_f8abyb6317ok7dp772katvv5",
      title: 'Remove-Item -LiteralPath "data.csv" -Force',
      kind: "execute",
      status: "pending",
      locations: [{ path: "C:\\Users\\1\\Desktop\\梵境\\sandbox" }],
    },
    options: [
      { optionId: "once", kind: "allow_once", name: "Allow once" },
      { optionId: "always", kind: "allow_always", name: "Always" },
      { optionId: "reject", kind: "reject_once", name: "Reject" },
    ],
  },
});

const toolCallLine = JSON.stringify({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "ses_abc",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call_00_abc",
      title: "bash",
      kind: "execute",
      status: "pending",
    },
  },
});

const completedLine = JSON.stringify({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "ses_abc",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_00_abc",
      status: "completed",
      title: 'Remove-Item -LiteralPath "data.csv"',
    },
  },
});

describe("权限请求 → approval_request", () => {
  it("翻译成审批事件，字段来自原文", () => {
    const r = translateAcpLine(permissionLine, opts);
    expect(r.kind).toBe("approval");
    if (r.kind !== "approval") return;

    expect(r.event.type).toBe("approval_request");
    expect(r.event.action_display).toContain("Remove-Item");
    expect(r.event.facts.kind).toBe("execute");
    expect(r.event.facts.locations).toContain("sandbox");
    expect(r.acpId).toBe(7);
  });

  it("request_id 用 Agent 自己的 toolCallId，不重新编号", () => {
    const r = translateAcpLine(permissionLine, opts);
    if (r.kind !== "approval") throw new Error("expected approval");
    expect(r.event.request_id).toBe("call_00_f8abyb6317ok7dp772katvv5");
  });

  it("raw_digest 等于这一行原文的 sha256（不重排、不规范化）", () => {
    const r = translateAcpLine(permissionLine, opts);
    if (r.kind !== "approval") throw new Error("expected approval");
    const expected = createHash("sha256").update(Buffer.from(permissionLine, "utf8")).digest("hex");
    expect(r.event.raw_digest).toBe(expected);
    expect(r.event.raw_ref.length).toBe(Buffer.byteLength(permissionLine, "utf8"));
  });

  it("同一行解析两次，摘要完全相同（可复现）", () => {
    const a = translateAcpLine(permissionLine, opts);
    const b = translateAcpLine(permissionLine, opts);
    if (a.kind !== "approval" || b.kind !== "approval") throw new Error("expected approval");
    expect(a.event.raw_digest).toBe(b.event.raw_digest);
  });

  it("改一个字符，摘要就变了", () => {
    const r = translateAcpLine(permissionLine.replace("-Force", "-Force "), opts);
    if (r.kind !== "approval") throw new Error("expected approval");
    expect(r.event.raw_digest).not.toBe(
      createHash("sha256").update(Buffer.from(permissionLine, "utf8")).digest("hex"),
    );
  });
});

describe("步骤流 → status_update", () => {
  it("pending 翻译成「待执行」，会话状态 running", () => {
    const r = translateAcpLine(toolCallLine, opts);
    expect(r.kind).toBe("step");
    if (r.kind !== "step") return;
    expect(r.event.step?.status).toBe("pending");
    expect(r.event.state).toBe("running");
    expect(r.event.step?.id).toBe("call_00_abc");
  });

  it("completed 翻译成「完成」，会话状态 done", () => {
    const r = translateAcpLine(completedLine, opts);
    if (r.kind !== "step") throw new Error("expected step");
    expect(r.event.step?.status).toBe("done");
    expect(r.event.state).toBe("done");
    expect(r.event.step?.title).toContain("Remove-Item");
  });

  it("failed 翻译成「失败」，会话状态 error", () => {
    const line = completedLine.replace("completed", "failed");
    const r = translateAcpLine(line, opts);
    if (r.kind !== "step") throw new Error("expected step");
    expect(r.event.step?.status).toBe("failed");
    expect(r.event.state).toBe("error");
  });

  it("缺 title 时回退到 toolCallId，不产生空标题", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s",
        update: { sessionUpdate: "tool_call", toolCallId: "call_xyz", status: "pending" },
      },
    });
    const r = translateAcpLine(line, opts);
    if (r.kind !== "step") throw new Error("expected step");
    expect(r.event.step?.title).toBe("call_xyz");
  });
});

describe("不认识的东西", () => {
  it("非 JSON 直接忽略", () => {
    expect(translateAcpLine("not json at all", opts).kind).toBe("ignored");
  });

  it("无关通知（比如 token 统计）忽略", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "usage_update", used: 1 } },
    });
    const r = translateAcpLine(line, opts);
    expect(r.kind).toBe("ignored");
  });

  it("未知的步骤状态不猜，直接忽略", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call", toolCallId: "x", status: "已完成" } },
    });
    expect(translateAcpLine(line, opts).kind).toBe("ignored");
  });
});

describe("选项映射", () => {
  const options = [
    { optionId: "once", kind: "allow_once" },
    { optionId: "always", kind: "allow_always" },
    { optionId: "reject", kind: "reject_once" },
  ];

  it("允许 → allow_*", () => {
    expect(pickAcpOption(options, "allow")).toBe("once");
  });

  it("拒绝 → reject_*", () => {
    expect(pickAcpOption(options, "reject")).toBe("reject");
  });

  it("没有对应选项时返回 undefined，不瞎选一个", () => {
    expect(pickAcpOption([{ optionId: "once", kind: "allow_once" }], "reject")).toBeUndefined();
  });
});
