/**
 * core —— 事件模型。这是全项目最底层的"字典"。
 *
 * ┌─ 怎么读这个文件 ──────────────────────────────┐
 * │ 1. EventEnvelope：每个事件都必须带的 11 个字段   │
 * │ 2. 下面四个 extend(...)：在信封上长出各自的字段  │
 * │ 3. AgentEvent：把四个事件合成一个"联合"         │
 * └─────────────────────────────────────────────┘
 *
 * [学习注] 这个文件里几乎没有"逻辑"，全是「结构声明」。
 * 它做的事是：拿到一段不认识的数据，判断它是不是一个合法事件。
 * 判断不通过，上层就拒绝 —— 所以这里写得越严，产品越安全。
 */

import { z } from "zod";


/**
 * 四类事件：approval_request / question / tool_result / status_update。
 * 这是所有包之间唯一的跨包契约。
 */
export const EVENT_TYPES = [
  "approval_request",
  "question",
  "tool_result",
  "status_update",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE = z.enum(EVENT_TYPES);

/** 风险三级。高风险不可被静默放行，这条约束在治理层强制。 */
export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const Decision = z.enum(["DENY", "APPROVAL", "ALLOW"]);
export type Decision = z.infer<typeof Decision>;

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * 事件信封。字段增删会让快照测试变红——这是有意的。
 * 顺序即语义：先是谁、什么时候，再是凭什么（摘要），最后是防重放与可举证。
 */
export const EventEnvelope = z.object({
  request_id: z.string().uuid(),
  agent_id: z.string().min(1),
  project_id: z.string().min(1),
  /** 秒级 Unix 时间戳 */
  timestamp: z.number().int().nonnegative(),
  /** 动作规范化后的 sha256，授权绑定的就是这个值 */
  action_digest: z.string().regex(SHA256_HEX),
  /** 执行后回填的实际效果摘要；未执行前为空 */
  effect_digest: z.string().regex(SHA256_HEX).optional(),
  /** 一次性随机数，防重放 */
  nonce: z.string().min(16),
  /** 授权失效时间（秒） */
  expires_at: z.number().int().nonnegative(),
  /** 判定时所用的策略版本，事后举证用 */
  policy_version: z.string().min(1),
  /** 签名者：host key 或 device key */
  signer: z.string().min(1),
  signature: z.string().min(1),
  /** 所属计划，供计划级批量批准 */
  parent_plan_id: z.string().optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelope>;

export const ApprovalRequest = EventEnvelope.extend({
  type: z.literal("approval_request"),
  /** 精确动作，规范化后的展示形式 */
  action: z.string().min(1),
  risk: RiskLevel,
  /** 确定性事实层的结论：文件数、行数、是否可恢复等 */
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** 意图层（AI）生成的解释，非权威 */
  intent_summary: z.string().optional(),
});

export const Question = EventEnvelope.extend({
  type: z.literal("question"),
  prompt: z.string().min(1),
  options: z.array(z.string()).default([]),
});

export const ToolResult = EventEnvelope.extend({
  type: z.literal("tool_result"),
  tool: z.string().min(1),
  ok: z.boolean(),
  /** 截断后的输出，避免大帧进中继 */
  output_excerpt: z.string().max(8192).optional(),
});

export const StatusUpdate = EventEnvelope.extend({
  type: z.literal("status_update"),
  state: z.enum(["idle", "running", "waiting", "done", "error"]),
  detail: z.string().optional(),
});

export const AgentEvent = z.discriminatedUnion("type", [
  ApprovalRequest,
  Question,
  ToolResult,
  StatusUpdate,
]);

export type AgentEvent = z.infer<typeof AgentEvent>;
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;
