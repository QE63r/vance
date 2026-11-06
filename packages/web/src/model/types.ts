/**
 * 线上协议的类型镜像。
 *
 * 为什么不直接 import @vance/core：
 * 前端只消费 JSON，不需要 zod 运行时，也不想让 dev server 依赖 core 的构建产物。
 * 字段与 packages/core/src/events.ts 一一对应；core 改了这里必须跟着改（有快照测试兜底）。
 * 这不是「另一套事件结构」，是同一份契约的只读副本。
 */

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface Step {
  id: string;
  title: string;
  kind?: string;
  status: StepStatus;
}

export interface EventEnvelope {
  request_id: string;
  agent_id: string;
  project_id: string;
  timestamp: number;
  raw_digest: string;
  raw_ref: { key: string; length: number };
  nonce: string;
  expires_at: number;
  policy_version: string;
  signer: string;
  signature: string;
  parent_plan_id?: string;
}

export interface ApprovalEvent extends EventEnvelope {
  type: "approval_request";
  action_display: string;
  facts: Record<string, string | number | boolean>;
  preview?: string;
}

export interface QuestionEvent extends EventEnvelope {
  type: "question";
  prompt: string;
  options: string[];
}

export interface ToolResultEvent extends EventEnvelope {
  type: "tool_result";
  for_raw_digest: string;
  tool: string;
  exit_code: number;
  output_ref: { key: string; length: number };
  output_folded: boolean;
}

export interface StatusUpdateEvent extends EventEnvelope {
  type: "status_update";
  state: "idle" | "running" | "waiting" | "suspended" | "done" | "error";
  detail?: string;
  step?: Step;
}

export type AgentEvent = ApprovalEvent | QuestionEvent | ToolResultEvent | StatusUpdateEvent;

export interface ArtifactsPayload {
  turnId: string;
  added: string[];
  changed: string[];
  removed: string[];
  warnings: string[];
}

export type Decision = "allow" | "reject" | "remember";

export interface DeviceRequest {
  deviceId: string;
  name: string;
  ip: string;
  at: number;
}

/** host → 手机 */
export type ServerMsg =
  | { type: "hello"; project: string; task?: string; device: string; session_id?: string; server_time?: number }
  | { type: "history"; items: ServerMsg[]; session_id?: string }
  | { type: "event"; event: AgentEvent }
  | { type: "chat"; role: "agent"; messageId: string; text: string }
  | { type: "user"; text: string }
  | { type: "turn"; state: "running" | "idle" | "stopped" }
  | { type: "notice"; level: "deny" | "auto" | "info"; text: string }
  | { type: "image"; dataUrl: string }
  | { type: "ack"; requestId: string; accepted: boolean }
  | { type: "decision"; requestId: string; decision: Decision; by: string; at: number; session_id?: string }
  | { type: "artifacts"; artifacts: ArtifactsPayload }
  | { type: "session"; session_id: string; title: string; active: boolean }
  | { type: "device_request"; deviceId: string; name: string; ip: string; at: number }
  | { type: "device_pending"; name: string }
  | { type: "device_approved" };

/** 手机 → host */
export type ClientMsg =
  | { type: "prompt"; text: string }
  | { type: "stop" }
  | { type: "decision"; requestId: string; decision: Decision }
  | { type: "resync" }
  | { type: "session/attach"; sessionId: string }
  | { type: "screenshot" }
  | { type: "device_decision"; deviceId: string; allow: boolean };
