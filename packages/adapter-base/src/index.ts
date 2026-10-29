import type { AgentEvent, Decision } from "@vance/core";

export type DenyReason =
  | "disconnected"
  | "malformed"
  | "unknown_event"
  | "expired"
  | "unimplemented";

export type Outcome =
  | { decision: "DENY"; reason: DenyReason }
  | { decision: "APPROVAL"; event: AgentEvent }
  | { decision: "ALLOW"; event: AgentEvent };

export interface AdapterContext {
  /** 秒级时间，注入以便测试 */
  nowSeconds: number;
  connected: boolean;
}

/**
 * 所有适配器的基类。
 *
 * 契约只有一条：子类只负责「翻译」，不负责「判断」。
 * 翻译拿不准（抛错、返回 null、字段缺失）时，一律落到 DENY——
 * 这就是 fail-closed 的实现位置：放在基类，任何适配器绕不过去。
 *
 * TODO(P0-3): 真实策略引擎（Deny > Approval > Allow 的完整规则、
 * risk 分级、policy_version 记录）在治理层实现，不在这里。
 */
export abstract class BaseAdapter {
  abstract readonly agentId: string;

  /** 把原生 payload 翻译成通用事件；返回 null 表示不认识。 */
  protected abstract translate(raw: unknown): AgentEvent | null;

  handle(raw: unknown, ctx: AdapterContext): Outcome {
    if (!ctx.connected) {
      return { decision: "DENY", reason: "disconnected" };
    }

    let event: AgentEvent | null;
    try {
      event = this.translate(raw);
    } catch {
      return { decision: "DENY", reason: "malformed" };
    }

    if (event === null) {
      return { decision: "DENY", reason: "unknown_event" };
    }

    if (event.expires_at <= ctx.nowSeconds) {
      return { decision: "DENY", reason: "expired" };
    }

    return this.route(event);
  }

  /**
   * 治理层的雏形：默认要求人工批准，只有明确无害的事件才放行。
   * 任何不确定的情形都必须落回 APPROVAL 或 DENY。
   */
  protected route(event: AgentEvent): Outcome {
    switch (event.type) {
      case "status_update":
      case "tool_result":
        return { decision: "ALLOW", event };
      default:
        return { decision: "APPROVAL", event };
    }
  }
}

export const decisionOf = (outcome: Outcome): Decision => outcome.decision;
