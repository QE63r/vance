import { describe, expect, it } from "vitest";
import { canSend } from "../src/model/selectors";
import { initialState, reduce, type State } from "../src/model/reduce";
import type { ApprovalEvent, ServerMsg, Step } from "../src/model/types";

const digest = "a".repeat(64);

function ev(): Omit<ApprovalEvent, "type" | "action_display" | "facts"> {
  return {
    request_id: "req-1",
    agent_id: "agent",
    project_id: "sandbox",
    timestamp: Date.now(),
    raw_digest: digest,
    raw_ref: { key: digest, length: 120 },
    nonce: "n".repeat(16),
    expires_at: Date.now() + 180_000,
    policy_version: "test",
    signer: "host",
    signature: "sig",
  };
}

const approval: ApprovalEvent = {
  ...ev(),
  type: "approval_request",
  action_display: "rm data.csv",
  facts: { kind: "execute", files: 1 },
};

const step: Step = { id: "s1", title: "soffice ...", kind: "execute", status: "running" };

function stepEvent(s: Step): ServerMsg {
  return { type: "event", event: { ...ev(), request_id: "st-1", type: "status_update", state: "running", step: s } };
}

function run(actions: ServerMsg[]): State {
  let s = reduce(initialState, { type: "connect" });
  s = reduce(s, { type: "open" });
  s = reduce(s, { type: "msg", msg: { type: "hello", project: "sandbox", device: "phone" } });
  for (const msg of actions) s = reduce(s, { type: "msg", msg });
  return s;
}

describe("四轴互不覆盖", () => {
  it("断线只动连接轴：审批仍是 offered，执行仍是 running，设备仍是 trusted", () => {
    let s = run([stepEvent(step), { type: "turn", state: "running" }, { type: "event", event: approval }]);

    expect(s.exec.phase).toBe("running");
    expect(s.approvals["req-1"].phase).toBe("offered");
    expect(s.device.phase).toBe("trusted");

    s = reduce(s, { type: "close", code: 1006 });

    expect(s.link.phase).toBe("reconnecting");
    // 三条没有关系的轴，一个都没被写坏
    expect(s.exec.phase).toBe("running");
    expect(s.device.phase).toBe("trusted");
    expect(s.approvals["req-1"].phase).toBe("offered");
    // 时间线也没被清空
    expect(s.timeline.some((i) => i.kind === "approval")).toBe(true);
  });

  it("设备轴单独变化：device_pending 只把设备挂起，不碰执行与审批", () => {
    let s = run([{ type: "turn", state: "running" }, { type: "event", event: approval }]);
    s = reduce(s, { type: "msg", msg: { type: "device_pending", name: "iPhone" } });

    expect(s.device.phase).toBe("pending");
    expect(s.link.phase).toBe("pairing");
    expect(s.exec.phase).toBe("running");
    expect(s.approvals["req-1"].phase).toBe("offered");
  });

  it("重连后 history 重建：不重复、审批还在、执行态以服务端为准", () => {
    let s = run([stepEvent(step), { type: "turn", state: "running" }, { type: "event", event: approval }]);
    s = reduce(s, { type: "close", code: 1006 });
    s = reduce(s, { type: "open" });
    s = reduce(s, { type: "msg", msg: { type: "hello", project: "sandbox", device: "phone" } });
    s = reduce(s, {
      type: "msg",
      msg: {
        type: "history",
        items: [
          { type: "user", text: "转成 PDF" },
          stepEvent(step),
          { type: "turn", state: "running" },
        ],
      },
    });
    s = reduce(s, { type: "msg", msg: { type: "event", event: approval } });

    expect(s.link.phase).toBe("ready");
    expect(s.timeline.filter((i) => i.kind === "user")).toHaveLength(1);
    expect(s.timeline.filter((i) => i.kind === "step")).toHaveLength(1);
    expect(s.timeline.filter((i) => i.kind === "approval")).toHaveLength(1);
    expect(s.approvals["req-1"].phase).toBe("offered");
    expect(s.exec.phase).toBe("running");
  });

  it("审批轴：ack(false) 是终态 stale，ack(true) 是 resolved", () => {
    let s = run([{ type: "event", event: approval }]);
    expect(s.approvals["req-1"].phase).toBe("offered");

    s = reduce(s, { type: "msg", msg: { type: "ack", requestId: "req-1", accepted: false } });
    expect(s.approvals["req-1"].phase).toBe("stale");

    let t = run([{ type: "event", event: approval }]);
    t = reduce(t, { type: "decide", requestId: "req-1", decision: "allow" });
    expect(t.approvals["req-1"].phase).toBe("submitting");
    t = reduce(t, { type: "msg", msg: { type: "ack", requestId: "req-1", accepted: true } });
    expect(t.approvals["req-1"].phase).toBe("resolved");
  });

  it("倒计时到点只把卡片变过期，不动执行与连接", () => {
    const s = run([{ type: "event", event: approval }, { type: "turn", state: "running" }]);
    const later = reduce(s, { type: "tick", now: approval.expires_at + 1 });
    expect(later.approvals["req-1"].phase).toBe("expired");
    expect(later.exec.phase).toBe("running");
    expect(later.link.phase).toBe("ready");
  });
});

describe("审批提交超时", () => {
  it("提交后没等到回执，退回可操作并提示重试", () => {
    let s = run([{ type: "event", event: approval }]);
    s = reduce(s, { type: "decide", requestId: approval.request_id, decision: "allow" });
    expect(s.approvals[approval.request_id].phase).toBe("submitting");

    s = reduce(s, { type: "decide-timeout", requestId: approval.request_id });
    expect(s.approvals[approval.request_id].phase).toBe("offered");
    expect(s.approvals[approval.request_id].error).toBeTruthy();
  });
});

describe("空会话", () => {
  it("连上但还没有任何一轮时，执行轴是空闲，第一条消息能发", () => {
    let s = reduce(initialState, { type: "connect" });
    s = reduce(s, { type: "open" });
    s = reduce(s, {
      type: "msg",
      msg: { type: "hello", project: "sandbox", device: "phone", session_id: "ses_x" },
    });

    expect(s.exec.phase).toBe("idle");
    expect(canSend(s)).toBe(true);
    expect(s.sessionId).toBe("ses_x");

    // 切会话：只改"在看哪条"
    s = reduce(s, { type: "msg", msg: { type: "session", session_id: "ses_y", title: "Y", active: false } });
    expect(s.sessionId).toBe("ses_y");
  });
});
