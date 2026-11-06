/**
 * ACP 消息 → 梵境事件的翻译层。
 *
 * 这里只做纯函数：给一行原始文本，返回一个事件或"忽略"。
 * 不碰进程、不碰网络、不碰时钟——所以可以拿真实录制的 payload 直接测。
 *
 * 两条铁律（ADR-0002 / ADR-0004）：
 *   1. raw_digest 算的是**收到的那一行原始字节**，不是重新序列化的结果。
 *   2. 没有 AI 摘要。只翻译事实：动作、类别、状态。
 */

import { randomUUID } from "node:crypto";
import {
  ApprovalRequest,
  StatusUpdate,
  computeRawDigest,
  type RawRef,
  type Step,
  type StepStatus,
} from "@vance/core";
import { classifyCommand, dangerOf } from "./command.js";

export interface TranslateOptions {
  /** 适配器名，写进 agent_id */
  agentId: string;
  /** 项目名，写进 project_id */
  projectId: string;
  /** 当前毫秒时间；注入以便测试 */
  now: number;
  /** 审批有效期（毫秒） */
  ttlMs: number;
  /** 策略版本，事后举证用 */
  policyVersion: string;
  /** 生成 nonce；注入以便测试可复现 */
  nonce: () => string;
}

export type Translated =
  | { kind: "step"; event: StatusUpdate }
  | { kind: "approval"; event: ApprovalRequest; acpId: string | number }
  | { kind: "ignored"; reason: string };

/** ACP 的步骤状态 → 我们的四态 */
function mapStepStatus(raw: unknown): StepStatus | null {
  switch (raw) {
    case "pending":
      return "pending";
    case "in_progress":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/** 步骤状态 → 会话状态 */
function mapSessionState(status: StepStatus): "running" | "done" | "error" {
  if (status === "done") return "done";
  if (status === "failed") return "error";
  return "running";
}

/**
 * 造信封。注意 request_id 由调用方给——优先用 Agent 自己的 id，
 * 不重新编号（ADR-0002 D1）。
 */
function envelope(rawLine: string, requestId: string, opts: TranslateOptions) {
  const bytes = Buffer.byteLength(rawLine, "utf8");
  const digest = computeRawDigest(Buffer.from(rawLine, "utf8"));
  const raw_ref: RawRef = { key: digest, length: bytes };

  return {
    request_id: requestId,
    agent_id: opts.agentId,
    project_id: opts.projectId,
    timestamp: opts.now,
    raw_digest: digest,
    raw_ref,
    nonce: opts.nonce(),
    expires_at: opts.now + opts.ttlMs,
    policy_version: opts.policyVersion,
    signer: "host:local",
    // 签名尚未实现（见 docs/event-model.md 待定项）；先显式标记，不假装签过
    signature: "unsigned",
  };
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * 把 unified diff 里没用的头部砍掉，只留 hunk。
 * 不改变任何一行的内容——只是去掉"Index:/===/---/+++"这四行噪音。
 */
export function trimDiff(diff: string): string {
  const lines = diff.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  const body = (start >= 0 ? lines.slice(start) : lines).join("\n").trimEnd();
  return body.slice(0, 4000);
}

/**
 * 从命令里提取"涉及哪些文件"。
 *
 * 只认被引号括起来的路径——这是命令里唯一能确定的东西。
 * 不做语义分析：拿不到就是空，绝不猜。
 */
export function extractPaths(text: string): string {
  const found = new Set<string>();
  const re = /"([^"]{1,200})"|'([^']{1,200})'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[1] ?? m[2];
    if (value && !value.startsWith("-")) found.add(value);
  }
  return [...found].slice(0, 4).join(", ");
}

/** 命令的第一个 token，作为"跑了哪个程序"的事实；不认识就空着 */
function programOf(text: string): string {
  const cleaned = text.trim().replace(/^&\s*/, "");
  const m = cleaned.match(/^"?([^\s"|;]+)"?/);
  const head = m?.[1] ?? "";
  return head.split(/[\\/]/).pop() ?? "";
}

/** 如果要跑的是一个脚本文件，把路径作为事实；这是"工作区内脚本"判断的依据 */
export function extractScript(text: string): string {
  const quoted = text.match(/-File\s+"([^"]+\.(?:ps1|cmd|bat|sh))"/i);
  if (quoted?.[1]) return quoted[1];
  const bare = text.match(/-File\s+([^\s]+\.(?:ps1|cmd|bat|sh))/i);
  if (bare?.[1]) return bare[1];
  const first = text.trim().replace(/^&\s*/, "").match(/^"?([^\s"]+\.(?:ps1|cmd|bat|sh))"?/i);
  return first?.[1] ?? "";
}

/**
 * 翻译一行 ACP 消息。
 *
 * @param rawLine 原样收到的那一行（含或不含换行都行，换行会在计算前去掉）
 */
export function translateAcpLine(rawLine: string, opts: TranslateOptions): Translated {
  const line = rawLine.replace(/\r?\n$/, "");

  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return { kind: "ignored", reason: "not-json" };
  }

  // ── 1. 权限请求：需要人做决定，翻译成 approval_request ──
  if (msg?.method === "session/request_permission") {
    const params = msg.params ?? {};
    const toolCall = params.toolCall ?? {};
    const toolCallId = asString(toolCall.toolCallId, asString(params.sessionId, "unknown-tool-call"));

    const locationsList = Array.isArray(toolCall.locations)
      ? toolCall.locations
          .map((l: any) => (typeof l?.path === "string" ? l.path : null))
          .filter((p: string | null): p is string => Boolean(p))
      : [];
    const locations = locationsList.join(", ");

    const title = asString(toolCall.title, toolCallId);
    const kind = asString(toolCall.kind, "unknown");

    // 编辑类：Agent 会在 rawInput.diff 里给出 unified diff。
    // 这是"要改什么"的唯一可靠来源，原样截取。
    const rawDiff = typeof toolCall.rawInput?.diff === "string" ? toolCall.rawInput.diff : "";
    const preview = rawDiff ? trimDiff(rawDiff) : undefined;

    let adds = 0;
    let removes = 0;
    for (const line of rawDiff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) adds += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) removes += 1;
    }

    // 事实层：控制面只认这些，不认命令方言。
    // effect 是"这次动作看起来读还是写"；拿不准就是 unknown，让策略问人。
    const commandText = asString(toolCall.rawInput?.command, "");
    const text = commandText || title;
    const effect =
      kind === "edit"
        ? "write"
        : kind === "read" || kind === "other"
          ? "read"
          : kind === "execute" && classifyCommand(text).auto
            ? "read"
            : "unknown";
    const danger = dangerOf(text);
    const program = kind === "execute" ? programOf(text) : "";
    const script = kind === "execute" ? extractScript(text) : "";
    const writePath = kind === "edit" ? asString(toolCall.rawInput?.filepath, locationsList[0] ?? "") : "";

    const candidate = {
      ...envelope(line, toolCallId, opts),
      type: "approval_request" as const,
      action_display: title,
      ...(preview ? { preview } : {}),
      facts: {
        kind,
        status: asString(toolCall.status, "pending"),
        locations,
        files: kind === "edit" ? asString(toolCall.rawInput?.filepath, title) : extractPaths(title),
        effect,
        ...(program ? { program } : {}),
        ...(script ? { script } : {}),
        ...(kind === "edit" && writePath ? { writes: [writePath] } : {}),
        ...((kind === "read" || kind === "other") && locationsList.length ? { reads: locationsList } : {}),
        ...(danger ? { danger } : {}),
        ...(kind === "edit" ? { adds, removes } : {}),
      },
    };

    const parsed = ApprovalRequest.safeParse(candidate);
    if (!parsed.success) {
      return { kind: "ignored", reason: "approval-invalid" };
    }
    return { kind: "approval", event: parsed.data, acpId: msg.id ?? null };
  }

  // ── 2. 步骤流：Agent 每推进一步，翻译成 status_update ──
  if (msg?.method === "session/update") {
    const update = msg.params?.update ?? {};
    const kind = update.sessionUpdate;

    if (kind !== "tool_call" && kind !== "tool_call_update") {
      return { kind: "ignored", reason: `update:${String(kind)}` };
    }

    const status = mapStepStatus(update.status);
    if (!status) {
      return { kind: "ignored", reason: "step-status-unknown" };
    }

    const toolCallId = asString(update.toolCallId, "unknown-step");
    const step: Step = {
      id: toolCallId,
      title: asString(update.title, toolCallId),
      status,
      ...(typeof update.kind === "string" ? { kind: update.kind } : {}),
    };

    const candidate = {
      ...envelope(line, `${toolCallId}:${status}`, opts),
      type: "status_update" as const,
      state: mapSessionState(status),
      step,
    };

    const parsed = StatusUpdate.safeParse(candidate);
    if (!parsed.success) {
      return { kind: "ignored", reason: "step-invalid" };
    }
    return { kind: "step", event: parsed.data };
  }

  return { kind: "ignored", reason: "unsupported-method" };
}

/**
 * 人做了决定之后，该回给 Agent 哪个选项。
 *
 * ACP 里选项由 Agent 给，常见是 once / always / reject。
 * 我们只认两类：允许（allow_*）与拒绝（reject_*）。
 */
export function pickAcpOption(
  options: Array<{ optionId?: string; kind?: string }> | undefined,
  decision: "allow" | "reject",
): string | undefined {
  const list = options ?? [];
  const kind = (o: { kind?: string }) => String(o.kind ?? "").toLowerCase();
  const id = (o: { optionId?: string }) => String(o.optionId ?? "").toLowerCase();

  if (decision === "reject") {
    return (
      list.find((o) => kind(o).startsWith("reject")) ??
      list.find((o) => id(o).includes("reject") || id(o).includes("deny"))
    )?.optionId;
  }

  // 允许：按宽松度递增地找，最后退到"任何不是拒绝的选项"
  return (
    list.find((o) => kind(o).startsWith("allow")) ??
    list.find((o) => /allow|approve|yes|once/.test(id(o))) ??
    list.find((o) => !kind(o).startsWith("reject") && !/reject|deny/.test(id(o)))
  )?.optionId;
}

/** 默认选项构造器（生产用），测试里可以注入固定值 */
export function defaultOptions(projectId: string, now: number): TranslateOptions {
  return {
    agentId: "opencode",
    projectId,
    now,
    ttlMs: 180_000,
    policyVersion: "0.0.1",
    nonce: () => randomUUID(),
  };
}
