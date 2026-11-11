/**
 * 状态机：四轴分开，互不覆盖。
 *
 *   link    连接（WS 通没通、要不要重连）
 *   device  设备（这台手机被不被信任）
 *   approvals 审批（每条请求各自一份）
 *   exec    执行（这一轮跑到哪了）
 *
 * 硬规矩：任何一条消息最多改一条轴，外加往 timeline 追加一条。
 * 断线只动 link；关掉一条审批只动 approvals；步骤只动 timeline / exec。
 * 这样断线时审批卡还在、执行态还在，屏幕上不会互相抹掉。
 */
import type {
  AgentEvent,
  ApprovalEvent,
  ArtifactsPayload,
  Decision,
  DeviceRequest,
  Profile,
  ServerMsg,
  Step,
} from "./types";

export type LinkPhase = "connecting" | "open" | "ready" | "pairing" | "denied" | "rejected" | "reconnecting";
export type DevicePhase = "unknown" | "trusted" | "pending" | "denied";
export type ExecPhase = "unknown" | "idle" | "running" | "stopped" | "error";
export type ApprovalPhase = "offered" | "submitting" | "resolved" | "expired" | "stale";

export interface ApprovalEntry {
  event: ApprovalEvent;
  phase: ApprovalPhase;
  by?: string;
  decision?: Decision;
  at?: number;
  /** 提交后没等到回执：就地提示，让人重试 */
  error?: string;
}

export type TimelineItem =
  | { id: string; kind: "user"; at: number; text: string }
  | { id: string; kind: "agent"; at: number; text: string; streaming: boolean }
  | { id: string; kind: "step"; at: number; step: Step }
  | { id: string; kind: "approval"; at: number; requestId: string }
  | { id: string; kind: "notice"; at: number; level: "deny" | "auto" | "info"; text: string }
  | { id: string; kind: "artifacts"; at: number; data: ArtifactsPayload }
  | { id: string; kind: "image"; at: number; dataUrl: string };

export interface State {
  link: { phase: LinkPhase; attempts: number; detail?: string };
  device: { phase: DevicePhase; name: string; incoming: DeviceRequest[] };
  exec: { phase: ExecPhase; detail?: string; lastAt?: number };
  approvals: Record<string, ApprovalEntry>;
  timeline: TimelineItem[];
  project: string;
  task: string;
  /** 当前正在看哪条会话；hello / session 都会更新它 */
  sessionId: string;
  /** 权限档位；hello / profile 都会更新它 */
  profile: Profile;
  /** 本地先画、还没等到服务端回显的那句话；回显时只确认，不重复 */
  pendingUser: string | null;
  lastEventAt: number | null;
  replaying: boolean;
  seq: number;
}

export const initialState: State = {
  link: { phase: "connecting", attempts: 0 },
  device: { phase: "unknown", name: "", incoming: [] },
  exec: { phase: "unknown" },
  approvals: {},
  timeline: [],
  project: "",
  task: "",
  sessionId: "",
  profile: "workspace",
  pendingUser: null,
  lastEventAt: null,
  replaying: false,
  seq: 0,
};

export type Action =
  | { type: "connect" }
  | { type: "open" }
  | { type: "close"; code?: number }
  | { type: "msg"; msg: ServerMsg; replay?: boolean }
  | { type: "tick"; now: number }
  | { type: "localUser"; text: string; at: number }
  | { type: "decide"; requestId: string; decision: Decision }
  | { type: "decide-timeout"; requestId: string }
  | { type: "localProfile"; profile: Profile }
  | { type: "device-decided"; deviceId: string };

const MAX_ITEMS = 400;

function nextId(s: State, prefix: string): [string, number] {
  const n = s.seq + 1;
  return [`${prefix}:${n}`, n];
}

function append(s: State, item: TimelineItem): State {
  const timeline = [...s.timeline, item];
  if (timeline.length > MAX_ITEMS) timeline.splice(0, timeline.length - MAX_ITEMS);
  return { ...s, timeline };
}

/** 已批准/失效后，之前“没收到回执”的旧错误不能留在卡上 */
function clearApprovalError(a: ApprovalEntry): ApprovalEntry {
  if (!a.error) return a;
  const next = { ...a };
  delete next.error;
  return next;
}

function mapApprovals(s: State, fn: (a: ApprovalEntry) => ApprovalEntry): State {
  const entries = Object.entries(s.approvals);
  let changed = false;
  const next: Record<string, ApprovalEntry> = {};
  for (const [id, a] of entries) {
    const b = fn(a);
    if (b !== a) changed = true;
    next[id] = b;
  }
  return changed ? { ...s, approvals: next } : s;
}

/** 一轮结束：把流式气泡收尾，避免光标一直闪 */
function sealStreaming(s: State): State {
  if (!s.timeline.some((i) => i.kind === "agent" && i.streaming)) return s;
  return {
    ...s,
    timeline: s.timeline.map((i) => (i.kind === "agent" && i.streaming ? { ...i, streaming: false } : i)),
  };
}

function upsertStep(s: State, step: Step, at: number): State {
  const idx = s.timeline.findIndex((i) => i.kind === "step" && i.step.id === step.id);
  if (idx >= 0) {
    const timeline = [...s.timeline];
    timeline[idx] = { ...(timeline[idx] as Extract<TimelineItem, { kind: "step" }>), step, at };
    return { ...s, timeline };
  }
  return append(s, { id: `step:${step.id}`, kind: "step", at, step });
}

function appendAgentChunk(s: State, messageId: string, text: string, at: number): State {
  const id = `chat:${messageId}`;
  const idx = s.timeline.findIndex((i) => i.kind === "agent" && i.id === id);
  if (idx >= 0) {
    const timeline = [...s.timeline];
    const item = timeline[idx] as Extract<TimelineItem, { kind: "agent" }>;
    timeline[idx] = { ...item, text: item.text + text, at };
    return { ...s, timeline };
  }
  return append(s, { id, kind: "agent", at, text, streaming: true });
}

function applyEvent(s: State, event: AgentEvent, at: number): State {
  if (event.type === "approval_request") {
    let next = s;
    const existing = s.approvals[event.request_id];
    if (!existing) {
      next = { ...next, approvals: { ...next.approvals, [event.request_id]: { event, phase: "offered" } } };
    }
    if (!next.timeline.some((i) => i.kind === "approval" && i.requestId === event.request_id)) {
      const [id, seq] = nextId(next, "approval");
      next = { ...next, seq };
      next = append(next, { id, kind: "approval", at, requestId: event.request_id });
    }
    return next;
  }

  if (event.type === "status_update") {
    let next = s;
    if (event.step) next = upsertStep(next, event.step, at);
    // 执行轴：只认服务端说的状态；waiting 不是新状态，是「在跑但停在等人」
    const phase: ExecPhase | null =
      event.state === "running" || event.state === "waiting"
        ? "running"
        : event.state === "idle" || event.state === "done" || event.state === "suspended"
          ? "idle"
          : event.state === "error"
            ? "error"
            : null;
    if (phase) next = { ...next, exec: { phase, detail: event.state === "waiting" ? "waiting" : event.detail, lastAt: at } };
    return next;
  }

  // question / tool_result：协议里有，这一轮不渲染成卡片（没有后端发它）
  return s;
}

function applyMsg(s: State, msg: ServerMsg, at: number): State {
  switch (msg.type) {
    case "hello":
      // 连接与设备两条轴同时被这条消息确认，但它们是两个字段，不互相覆盖
      return {
        ...s,
        project: msg.project || s.project,
        task: msg.task ?? s.task,
        sessionId: msg.session_id ?? s.sessionId,
        profile: msg.profile ?? s.profile,
        link: { phase: "ready", attempts: 0 },
        device: { ...s.device, phase: "trusted", name: msg.device || s.device.name },
        // 还没见过任何一轮 = 空会话，等同于空闲；否则第一条消息永远发不出去
        exec: s.exec.phase === "unknown" ? { phase: "idle" } : s.exec,
      };

    case "history": {
      // 回放：清空后重放，避免两份流水叠在一起
      let next: State = {
        ...s,
        timeline: [],
        approvals: {},
        exec: { phase: "unknown" },
        lastEventAt: null,
        replaying: true,
      };
      for (const item of msg.items) next = reduce(next, { type: "msg", msg: item, replay: true });
      return {
        ...next,
        replaying: false,
        link: { phase: "ready", attempts: 0 },
        // 回放完还没有任何"轮"的消息（空会话 / 旧账）：等同于空闲
        exec: next.exec.phase === "unknown" ? { phase: "idle" } : next.exec,
      };
    }

    case "event":
      return { ...applyEvent(s, msg.event, at), lastEventAt: at };

    case "chat":
      return { ...appendAgentChunk(s, msg.messageId, msg.text, at), lastEventAt: at };

    case "user": {
      // 本地已经先画了同一句：服务端回显只当确认，不再加一条
      if (s.pendingUser !== null && msg.text.trim() === s.pendingUser) {
        return { ...s, pendingUser: null, lastEventAt: at };
      }
      const [id, seq] = nextId(s, "user");
      return { ...append({ ...s, seq }, { id, kind: "user", at, text: msg.text }), lastEventAt: at };
    }

    case "turn": {
      const phase: ExecPhase = msg.state === "running" ? "running" : msg.state === "stopped" ? "stopped" : "idle";
      // 服务端已经接单（无论 running 还是已经结束）：本地“等待确认”必须收掉。
      const next = { ...s, exec: { phase, lastAt: at }, lastEventAt: at, pendingUser: null };
      return msg.state === "running" ? next : sealStreaming(next);
    }

    case "notice": {
      const [id, seq] = nextId(s, "notice");
      return { ...append({ ...s, seq }, { id, kind: "notice", at, level: msg.level, text: msg.text }), lastEventAt: at };
    }

    case "artifacts": {
      const [id, seq] = nextId(s, "artifacts");
      return { ...append({ ...s, seq }, { id, kind: "artifacts", at, data: msg.artifacts }), lastEventAt: at };
    }

    case "image": {
      const [id, seq] = nextId(s, "image");
      return { ...append({ ...s, seq }, { id, kind: "image", at, dataUrl: msg.dataUrl }), lastEventAt: at };
    }

    case "ack":
      return mapApprovals(s, (a) => {
        if (a.event.request_id !== msg.requestId) return a;
        return clearApprovalError(
          msg.accepted
            ? { ...a, phase: "resolved", at }
            : { ...a, phase: "stale", at },
        );
      });

    case "decision":
      return mapApprovals(s, (a) => {
        if (a.event.request_id !== msg.requestId || a.phase === "resolved" || a.phase === "stale") return a;
        return clearApprovalError({ ...a, phase: "resolved", by: msg.by, decision: msg.decision, at: msg.at });
      });

    case "device_request":
      if (s.device.incoming.some((d) => d.deviceId === msg.deviceId)) return s;
      return {
        ...s,
        device: {
          ...s.device,
          incoming: [...s.device.incoming, { deviceId: msg.deviceId, name: msg.name, ip: msg.ip, at: msg.at }],
        },
      };

    case "device_pending":
      return {
        ...s,
        link: { ...s.link, phase: "pairing" },
        device: { ...s.device, phase: "pending", name: msg.name || s.device.name },
      };

    case "device_approved":
      return { ...s, device: { ...s.device, phase: "trusted" } };

    // 会话就绪/切换：换的是"正在看哪条"。先清空，等 history 重建；
    // 新建任务没有 history，不清就会把上一条的时间线留在新任务里。
    case "session": {
      if (s.sessionId === msg.session_id) return s;
      return {
        ...s,
        sessionId: msg.session_id,
        timeline: [],
        approvals: {},
        exec: { phase: "unknown" },
        lastEventAt: null,
      };
    }

    case "profile":
      return { ...s, profile: msg.profile };

    default:
      // 服务端以后加新消息类型时，老页面应该忽略，而不是把 state 变成 undefined 白屏
      return s;
  }
}

export function reduce(s: State, action: Action): State {
  switch (action.type) {
    case "connect":
      return { ...s, link: { phase: s.link.attempts === 0 ? "connecting" : "reconnecting", attempts: s.link.attempts } };

    case "open":
      return { ...s, link: { ...s.link, phase: "open" } };

    case "close": {
      if (action.code === 4001) return { ...s, link: { phase: "rejected", attempts: s.link.attempts } };
      if (action.code === 4004) return { ...s, link: { phase: "denied", attempts: s.link.attempts } };
      return { ...s, link: { phase: "reconnecting", attempts: s.link.attempts + 1 } };
    }

    case "localUser": {
      const [id, seq] = nextId(s, "user");
      const next = append(
        { ...s, seq, pendingUser: action.text.trim() },
        { id, kind: "user", at: action.at, text: action.text },
      );
      return { ...next, lastEventAt: action.at };
    }

    case "msg":
      return applyMsg(s, action.msg, Date.now());

    case "localProfile":
      return { ...s, profile: action.profile };

    case "tick": {
      const now = action.now;
      return mapApprovals(s, (a) =>
        a.phase === "offered" && a.event.expires_at > 0 && a.event.expires_at <= now ? { ...a, phase: "expired" } : a,
      );
    }

    case "decide":
      return mapApprovals(s, (a) => {
        if (a.event.request_id !== action.requestId || a.phase !== "offered") return a;
        const next = { ...a, phase: "submitting" as const, decision: action.decision };
        delete next.error;
        return next;
      });

    case "decide-timeout":
      // 电脑没回执：先 resync 核对；动作可能已经执行，不要吓用户重复批准
      return mapApprovals(s, (a) =>
        a.event.request_id === action.requestId && a.phase === "submitting"
          ? { ...a, phase: "offered", error: "没收到电脑回执，正在核对…" }
          : a,
      );

    case "device-decided": {
      // 只把这张请求卡收掉；本机是不是可信，等服务端说了算（不在这里假装）
      const incoming = s.device.incoming.filter((d) => d.deviceId !== action.deviceId);
      return incoming.length === s.device.incoming.length ? s : { ...s, device: { ...s.device, incoming } };
    }
  }
}
