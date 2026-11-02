/**
 * core —— 事件模型。这是全项目最底层的"字典"。
 *
 * ┌─ 怎么读这个文件 ──────────────────────────────┐
 * │ 1. EventEnvelope：每个事件都必须带的字段        │
 * │ 2. 下面四个 extend(...)：在信封上长出各自的字段  │
 * │ 3. AgentEvent：把四个事件合成一个"联合"         │
 * └─────────────────────────────────────────────┘
 *
 * [学习注] 这个文件里几乎没有"逻辑"，全是「结构声明」。
 * 它做的事是：拿到一段不认识的数据，判断它是不是一个合法事件。
 * 判断不通过，上层就拒绝 —— 所以这里写得越严，产品越安全。
 *
 * 设计依据见 adr/0002-event-envelope.md，三条最容易踩的：
 *   · 批准绑定的是「原始字节」(raw_digest)，不是我们对动作的理解
 *   · 风险等级不在线上格式里，由治理层根据事实计算
 *   · 事件不可变；执行结果另起一条 tool_result
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

/**
 * 风险三级。
 *
 * [重要] 它不是线上字段，不出现在任何事件里 —— 由治理层根据 facts 计算。
 * 发送方（适配器 / Agent）无权声明风险，否则它可以自报 low 换取静默放行。
 */
export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const Decision = z.enum(["DENY", "APPROVAL", "ALLOW"]);
export type Decision = z.infer<typeof Decision>;

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * 原文的存放位置。内容是"不可变对象"：
 * 按 key 取出来的字节，必须与 raw_digest 对得上。
 */
export const RawRef = z.object({
  /** 存储键，通常就是 raw_digest 本身（内容寻址） */
  key: z.string().min(1),
  /** 原始字节长度，用于校验与分页读取 */
  length: z.number().int().nonnegative(),
});

export type RawRef = z.infer<typeof RawRef>;

/**
 * 事件信封。字段增删会让快照测试变红 —— 这是有意的。
 *
 * 顺序即语义：先是谁、什么时候，再是凭什么（原始字节摘要），
 * 最后是防重放与可举证。
 */
export const EventEnvelope = z.object({
  /** 优先使用 Agent 自己的请求 id，不重新编号 */
  request_id: z.string().min(1),
  agent_id: z.string().min(1),
  project_id: z.string().min(1),
  /** 毫秒级 Unix 时间戳，以 Agent Host 为准 */
  timestamp: z.number().int().nonnegative(),
  /**
   * 对「收到的原始 payload 字节」做 sha256。
   * 不规范化、不重排、不解析后重拼 —— 一次批准只对应一次请求。
   */
  raw_digest: z.string().regex(SHA256_HEX),
  /** 原文存在哪、多长；审计时据此取出当时那一串字节 */
  raw_ref: RawRef,
  /** 一次性随机数，防重放 */
  nonce: z.string().min(16),
  /** 授权失效时间（毫秒） */
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

/**
 * 审批请求。
 *
 * [学习注] strict() = 多出一个我们不认识的字段就判为非法。
 * 因为未知字段可能带着没被看见的额外指令，批准它等于
 * 批准一个自己没看全的动作。
 */
export const ApprovalRequest = EventEnvelope.extend({
  type: z.literal("approval_request"),
  /**
   * 仅用于展示。权威内容在 raw_ref 指向的原始字节里。
   * 这条字段不得用于任何判定。
   */
  action_display: z.string().min(1),
  /**
   * 确定性事实层：文件数、行数、是否在 git 跟踪内、是否可恢复……
   * 不含风险等级（风险由治理层算）。
   */
  facts: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  /** 意图层（AI）生成的解释，非权威，仅展示 */
  intent_summary: z.string().optional(),
}).strict();

/**
 * 提问。和审批一样严格 —— 它同样会打断人、要求人做决定。
 */
export const Question = EventEnvelope.extend({
  type: z.literal("question"),
  prompt: z.string().min(1),
  options: z.array(z.string()).default([]),
}).strict();

/**
 * 工具执行结果。
 *
 * 独立成事件，不回头修改 approval_request —— 事件不可变，审计才站得住。
 */
export const ToolResult = EventEnvelope.extend({
  type: z.literal("tool_result"),
  /** 对应哪一次请求的原始字节 */
  for_raw_digest: z.string().regex(SHA256_HEX),
  tool: z.string().min(1),
  exit_code: z.number().int(),
  /** 完整输出存放位置；永不丢弃，只在展示时折叠 */
  output_ref: RawRef,
  /** 展示层是否折叠；不改变数据本身 */
  output_folded: z.boolean().default(false),
});

/**
 * 状态更新。纯汇报，不产生新动作，宽容对待：多出的字段忽略即可。
 */
export const StatusUpdate = EventEnvelope.extend({
  type: z.literal("status_update"),
  state: z.enum(["idle", "running", "waiting", "suspended", "done", "error"]),
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
export type ToolResult = z.infer<typeof ToolResult>;
