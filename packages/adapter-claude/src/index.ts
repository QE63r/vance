import type { AgentEvent } from "@vance/core";
import { BaseAdapter } from "@vance/adapter-base";

/**
 * Claude Code 适配器（P2 里程碑）。
 *
 * 待办：
 * 1. 接 PreToolUse Hook，录制 ≥8 个真实 payload 作为 fixture
 * 2. 把 hook 的 tool_name / tool_input 归一化成 ApprovalRequest
 * 3. question 通道监听，未知事件产出 diagnostic
 */
export class ClaudeAdapter extends BaseAdapter {
  readonly agentId = "claude-code";

  protected translate(_raw: unknown): AgentEvent | null {
    // TODO(P3-1): 协议侦察完成前，一律返回 null —— 即 fail-closed 拒绝。
    return null;
  }
}
