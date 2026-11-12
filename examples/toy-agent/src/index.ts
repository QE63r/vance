/**
 * A deliberately small agent loop for the Vance examples.
 *
 * It owns the loop, tool dispatch, and approval gate. It is not a model client:
 * `ToyModel` supplies one action at a time, so the same loop can be driven by a
 * scripted fixture (tests) or a real model later.
 */

import type { ToolCall, ToolDefinition, ToolResult } from "@vance/adapter-sdk";
import { createBuiltinTools, type ToolRegistry, type ToolRisk } from "@vance/tool-registry";

export interface ChatTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface ModelReply {
  content?: string;
  toolCalls?: Array<{ id?: string; name: string; arguments: string }>;
}

export interface ToyModel {
  next(messages: ChatTurn[], tools: ToolDefinition[]): Promise<ModelReply>;
}

export type ModelAction =
  | { type: "tool"; name: string; arguments: Record<string, unknown> }
  | { type: "final"; text: string };

/** Deterministic model used by fixtures; no network, no key. */
export class ScriptedModel implements ToyModel {
  private index = 0;

  constructor(private readonly actions: ModelAction[]) {}

  async next(): Promise<ModelReply> {
    const action = this.actions[this.index++];
    if (!action) return { content: "No more scripted actions." };
    if (action.type === "final") return { content: action.text };
    return {
      toolCalls: [
        {
          id: `call_${this.index}`,
          name: action.name,
          arguments: JSON.stringify(action.arguments),
        },
      ],
    };
  }
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  risk: ToolRisk | "unknown";
  allowed: boolean;
  result: ToolResult;
}

export interface ToyResult {
  final: string;
  steps: number;
  approvals: number;
  trace: ToolTrace[];
}

export interface ToyAgentOptions {
  model: ToyModel;
  workspaceRoot: string;
  tools?: ToolRegistry;
  approve?: (call: ToolCall, risk: ToolRisk) => Promise<boolean> | boolean;
  maxSteps?: number;
}

export class ToyAgent {
  private readonly tools: ToolRegistry;
  private readonly approve: (call: ToolCall, risk: ToolRisk) => Promise<boolean> | boolean;
  private readonly maxSteps: number;

  constructor(private readonly options: ToyAgentOptions) {
    this.tools = options.tools ?? createBuiltinTools();
    this.approve = options.approve ?? (() => false);
    this.maxSteps = options.maxSteps ?? 8;
  }

  async run(task: string): Promise<ToyResult> {
    const messages: ChatTurn[] = [{ role: "user", content: task }];
    const trace: ToolTrace[] = [];
    let approvals = 0;

    for (let step = 0; step < this.maxSteps; step++) {
      const reply = await this.options.model.next(messages, this.tools.definitions());
      if (reply.toolCalls && reply.toolCalls.length > 0) {
        for (const call of reply.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
          } catch {
            const result = { ok: false, content: "Invalid tool arguments" };
            trace.push({ name: call.name, args, risk: "unknown", allowed: false, result });
            messages.push({
              role: "tool",
              content: result.content,
              toolCallId: call.id ?? call.name,
            });
            continue;
          }

          const spec = this.tools.get(call.name);
          const risk: ToolRisk | "unknown" = spec?.risk ?? "unknown";
          let allowed = true;
          if (risk === "write") {
            approvals += 1;
            allowed = await this.approve(
              { id: call.id ?? call.name, name: call.name, arguments: call.arguments },
              "write",
            );
          }

          const result = allowed
            ? await this.tools.execute(call.name, args, { workspaceRoot: this.options.workspaceRoot })
            : { ok: false, content: "Denied by user" };
          trace.push({ name: call.name, args, risk, allowed, result });
          messages.push({
            role: "tool",
            content: result.content,
            toolCallId: call.id ?? call.name,
          });
        }
        continue;
      }

      if (typeof reply.content === "string") {
        return { final: reply.content, steps: step + 1, approvals, trace };
      }
      return { final: "", steps: step + 1, approvals, trace };
    }

    throw new Error(`agent loop exceeded ${this.maxSteps} steps`);
  }
}

export * from "./fixtures.js";
