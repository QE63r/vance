/**
 * Adapter SDK — the stable, tiny surface every Vance agent adapter implements.
 *
 * The SDK deliberately does not contain an agent loop, a model client, or a
 * policy engine. It only defines how an agent exposes text/status to the
 * console and how the console cancels it. Approval decisions are the host's
 * job (see @vance/core / adapter-base).
 */

import { randomUUID } from "node:crypto";

export type AdapterStatus = "running" | "done" | "error";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  /** Stable machine-readable error code when ok=false. */
  code?: string;
}

export interface AgentAdapterHandlers {
  /** Streaming assistant text. `delta` is true for an incremental chunk. */
  onChat?: (messageId: string, text: string, delta: boolean) => void;
  /** Session-level status; `detail` is optional human-readable context. */
  onStatus?: (state: AdapterStatus, detail?: string) => void;
  /** Transport/protocol errors; the adapter must also reject `prompt()`. */
  onError?: (message: string) => void;
  /**
   * A model requested a tool call. The adapter must wait for this promise and
   * return the tool result to the model. The handler owns approval/execution.
   */
  onToolCall?: (call: ToolCall) => Promise<ToolResult>;
}

/**
 * One live agent process/session.
 *
 * Implementations should be single-turn-at-a-time. Calling `prompt()` while a
 * turn is running is a programming error and must reject.
 */
export interface AgentAdapter {
  readonly id: string;
  start(): Promise<void>;
  prompt(text: string): Promise<void>;
  cancel(): void;
  close(): Promise<void>;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code: "not-started" | "busy" | "http" | "protocol" | "closed",
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export function defineAdapter<T extends AgentAdapter>(adapter: T): T {
  return adapter;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function createMessageId(prefix = "msg"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
