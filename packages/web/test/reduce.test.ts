import { describe, expect, it } from "vitest";
import { canSend, pendingCount } from "../src/model/selectors";
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

    // 旧任务的时间线不能跟着新会话留下
    s = reduce(s, { type: "msg", msg: { type: "user", text: "旧任务" } });
    expect(s.timeline).toHaveLength(1);

    // 切会话：换 id，先清空时间线；history 随后重建
    s = reduce(s, { type: "msg", msg: { type: "session", session_id: "ses_y", title: "Y", active: false } });
    expect(s.sessionId).toBe("ses_y");
    expect(s.timeline).toHaveLength(0);
  });

  it("审批成功后清掉旧的回执错误", () => {
    let s = run([{ type: "event", event: approval }]);
    s = reduce(s, { type: "decide", requestId: approval.request_id, decision: "allow" });
    s = reduce(s, { type: "decide-timeout", requestId: approval.request_id });
    expect(s.approvals[approval.request_id].error).toBeTruthy();
    s = reduce(s, {
      type: "msg",
      msg: { type: "decision", requestId: approval.request_id, decision: "allow", by: "phone", at: Date.now() },
    });
    expect(s.approvals[approval.request_id].error).toBeUndefined();
  });

  it("服务端接单后立刻清掉等待确认", () => {
    let s = reduce(initialState, { type: "localUser", text: "在吗", at: 1 });
    expect(s.pendingUser).toBe("在吗");
    s = reduce(s, { type: "msg", msg: { type: "turn", state: "running" } });
    expect(s.pendingUser).toBeNull();
  });

  it("计划卡进入待批，批准后变成 allowed", () => {
    const plan: ServerMsg = {
      type: "plan_request",
      plan_id: "plan_1",
      steps: [{ kind: "edit", action_display: "写 a", facts: { writes: ["C:\\a"] } }],
      expires_at: Date.now() + 60_000,
    };
    let s = run([plan]);
    expect(s.plans["plan_1"]?.phase).toBe("offered");
    expect(s.timeline.some((i) => i.kind === "plan")).toBe(true);
    expect(pendingCount(s)).toBe(1);
    expect(canSend(s)).toBe(false);

    s = reduce(s, {
      type: "msg",
      msg: {
        type: "plan_decision",
        plan_id: "plan_1",
        status: "allowed",
        decision: "allow",
        by: "phone",
        at: Date.now(),
      },
    });
    expect(s.plans["plan_1"]?.phase).toBe("allowed");
    expect(pendingCount(s)).toBe(0);
    expect(canSend(s)).toBe(true);
  });
});

describe("移动计划的撤销", () => {
  const movePlan: ServerMsg = {
    type: "plan_request",
    plan_id: "plan_move",
    moves: [{ from: "C:\\tmp\\a.txt", to: "C:\\tmp\\b.txt" }],
    steps: [
      {
        kind: "execute",
        action_display: "移动 a.txt → b.txt",
        facts: { moves: [{ from: "C:\\tmp\\a.txt", to: "C:\\tmp\\b.txt" }] },
      },
    ],
    expires_at: Date.now() + 60_000,
  };

  function allowedPlan(): State {
    let s = run([movePlan]);
    s = reduce(s, {
      type: "msg",
      msg: {
        type: "plan_decision",
        plan_id: "plan_move",
        status: "allowed",
        decision: "allow",
        by: "phone",
        at: Date.now(),
      },
    });
    return s;
  }

  it("撤销中 → 已撤销；完成后再点不会重来", () => {
    let s = allowedPlan();
    s = reduce(s, { type: "undo-plan", planId: "plan_move" });
    expect(s.plans["plan_move"]?.undo?.phase).toBe("running");

    s = reduce(s, { type: "undo-result", planId: "plan_move", moved: 1, failed: [] });
    expect(s.plans["plan_move"]?.undo?.phase).toBe("done");
    expect(s.plans["plan_move"]?.undo?.moved).toBe(1);

    s = reduce(s, { type: "undo-plan", planId: "plan_move" });
    expect(s.plans["plan_move"]?.undo?.phase).toBe("done");
  });

  it("部分失败保留原因，并允许重试", () => {
    let s = allowedPlan();
    s = reduce(s, { type: "undo-plan", planId: "plan_move" });
    s = reduce(s, {
      type: "undo-result",
      planId: "plan_move",
      moved: 1,
      failed: [{ from: "C:\\tmp\\a.txt", to: "C:\\tmp\\b.txt", reason: "target-missing" }],
    });
    expect(s.plans["plan_move"]?.undo?.phase).toBe("partial");
    expect(s.plans["plan_move"]?.undo?.failed[0]?.reason).toBe("target-missing");

    s = reduce(s, { type: "undo-plan", planId: "plan_move" });
    expect(s.plans["plan_move"]?.undo?.phase).toBe("running");
  });

  it("接口报错算失败，可以重试", () => {
    let s = allowedPlan();
    s = reduce(s, { type: "undo-plan", planId: "plan_move" });
    s = reduce(s, {
      type: "undo-result",
      planId: "plan_move",
      moved: 0,
      failed: [],
      error: "撤销失败：HTTP 500",
    });
    expect(s.plans["plan_move"]?.undo?.phase).toBe("failed");
    expect(s.plans["plan_move"]?.undo?.error).toContain("HTTP 500");

    s = reduce(s, { type: "undo-plan", planId: "plan_move" });
    expect(s.plans["plan_move"]?.undo?.phase).toBe("running");
  });

  it("还没批准的计划不能撤销", () => {
    let s = run([movePlan]);
    s = reduce(s, { type: "undo-plan", planId: "plan_move" });
    expect(s.plans["plan_move"]?.undo).toBeUndefined();
  });
});

describe("本地回显", () => {
  it("本地先画的那句，服务端回显只确认、不重复", () => {
    let s = reduce(initialState, { type: "localUser", text: "贪吃蛇吧", at: 1 });
    s = reduce(s, { type: "msg", msg: { type: "user", text: "贪吃蛇吧" } });

    const users = s.timeline.filter((i) => i.kind === "user");
    expect(users).toHaveLength(1);
    expect(s.pendingUser).toBeNull();
  });
});
