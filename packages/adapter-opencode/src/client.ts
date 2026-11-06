/**
 * ACP 客户端：起一个 opencode 进程，用 JSON-RPC 跟它说话。
 *
 * 这一层只负责"管道"：进程、读写、协议序号。
 * 所有判断都在 translate.ts 里，这个文件不做任何解释性的决定。
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import type { ApprovalRequest, StatusUpdate } from "@vance/core";
import { defaultOptions, pickAcpOption, translateAcpLine } from "./translate.js";

export interface ClientOptions {
  /** Agent 的工作目录 */
  cwd: string;
  /** 项目名，写进事件 */
  projectId?: string;
  /** 可执行文件，默认 opencode */
  command?: string;
  /** 参数，默认 ["acp"] */
  args?: string[];
  /** 时钟，注入以便测试 */
  now?: () => number;
}

export interface ClientHandlers {
  /** 每推进一步 */
  onStep?: (event: StatusUpdate) => void;
  /**
   * Agent 自己说的话（流式）。这是"原内容"——不是我们生成的摘要，
   * 是它在回复里本来就会输出的文本。
   */
  onChat?: (messageId: string, text: string) => void;
  /**
   * 需要人决定。调用 reply("allow" | "reject") 把决定回给 Agent。
   * 不调 reply 就等于一直挂着——直到超时由外层处置。
   */
  onApproval: (event: ApprovalRequest, reply: (decision: "allow" | "reject") => void) => void;
  onLog?: (line: string) => void;
}

export class AcpClient {
  private child: ChildProcess | null = null;
  private buf = "";
  private nextId = 1;
  private sessionId: string | null = null;
  private opts: Required<Omit<ClientOptions, "now">> & { now: () => number };
  private settled: ((reason: string) => void) | null = null;
  /** 当前这一轮 session/prompt 的 JSON-RPC id；用它来收尾 */
  private turnId: number | null = null;

  constructor(
    options: ClientOptions,
    private readonly handlers: ClientHandlers,
  ) {
    this.opts = {
      cwd: options.cwd,
      projectId: options.projectId ?? "default",
      command: options.command ?? "opencode",
      args: options.args ?? ["acp"],
      now: options.now ?? (() => Date.now()),
    };
  }

  private send(obj: unknown): void {
    this.child?.stdin?.write(JSON.stringify(obj) + "\n");
  }

  private log(line: string): void {
    this.handlers.onLog?.(line);
  }

  /** 启动并建立会话；返回 sessionId */
  start(): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.command, this.opts.args, {
        cwd: this.opts.cwd,
        shell: process.platform === "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;

      child.on("error", reject);
      child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
      child.stderr?.on("data", (chunk: Buffer) => {
        const s = chunk.toString("utf8").trim();
        if (s) this.log(s);
      });

      this.onSessionReady = resolve;
      this.onSessionFailed = reject;
      this.send({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: { protocolVersion: 1, clientCapabilities: {} },
      });
    });
  }

  private onSessionReady: ((id: string) => void) | null = null;
  private onSessionFailed: ((e: Error) => void) | null = null;

  /** 发一条指令，等这一轮结束 */
  runTurn(text: string): Promise<string> {
    if (!this.sessionId) throw new Error("session not started");
    return new Promise((resolve) => {
      this.settled = resolve;
      const id = this.nextId++;
      this.turnId = id;
      this.send({
        jsonrpc: "2.0",
        id,
        method: "session/prompt",
        params: { sessionId: this.sessionId, prompt: [{ type: "text", text }] },
      });
    });
  }

  /**
   * 强制终止 Agent 进程。
   * cancel 只是"请求"，Agent 完全可以不理；这个才是真的按住它。
   * Windows 上直接 taskkill /T，连子进程一起收掉。
   */
  kill(reason = "force stop"): void {
    const pid = this.child?.pid;
    if (!pid) return;
    this.log(`[acp] 强制终止 Agent 进程 (pid ${pid}, ${reason})`);
    try {
      if (process.platform === "win32") {
        const taskkill = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\taskkill.exe`;
        execSync(`"${taskkill}" /PID ${pid} /T /F`, { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch {}
    // 进程没了，这一轮必须收尾，否则界面永远停在"正在执行"
    this.settled?.("killed");
    this.settled = null;
    this.turnId = null;
    this.child = null;
  }

  /** 让 Agent 停下来（ACP 的 session/cancel） */
  cancel(): void {
    if (!this.sessionId) return;
    this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } });
    this.log("[acp] 已发送取消");
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.trim().startsWith("{")) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // 响应：协议自身的握手
    if (msg.id !== undefined && msg.method === undefined) {
      // 这一轮的应答（不管成功还是失败）都必须收尾，
      // 否则界面会永远停在"正在执行"，人也发不出下一句。
      if (this.turnId !== null && msg.id === this.turnId) {
        if (msg.error) this.log(`[acp] prompt 失败：${JSON.stringify(msg.error).slice(0, 140)}`);
        this.settled?.(msg.error ? "error" : String(msg.result?.stopReason ?? "end_turn"));
        this.settled = null;
        this.turnId = null;
        return;
      }

      if (msg.error) {
        this.onSessionFailed?.(new Error(JSON.stringify(msg.error)));
        return;
      }
      const result = msg.result ?? {};
      if (this.sessionId === null && result.agentInfo) {
        this.send({
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "session/new",
          params: { cwd: this.opts.cwd, mcpServers: [] },
        });
        return;
      }
      if (this.sessionId === null && result.sessionId) {
        this.sessionId = result.sessionId;
        this.onSessionReady?.(result.sessionId);
        return;
      }
      // 其余响应视为"这一轮结束"
      this.settled?.(String(result.stopReason ?? "end_turn"));
      this.settled = null;
      return;
    }

    // 通知与请求
    // Agent 的回复文本：原样转发，不加工
    if (
      msg.method === "session/update" &&
      (msg.params?.update?.sessionUpdate === "agent_message_chunk" ||
        msg.params?.update?.sessionUpdate === "agent_thought_chunk")
    ) {
      const u = msg.params.update;
      const text = typeof u.content?.text === "string" ? u.content.text : "";
      if (text) this.handlers.onChat?.(String(u.messageId ?? "msg"), text);
      return;
    }

    const translated = translateAcpLine(line, defaultOptions(this.opts.projectId, this.opts.now()));

    if (translated.kind === "step") {
      this.handlers.onStep?.(translated.event);
      return;
    }

    if (translated.kind === "approval") {
      const options = (msg.params?.options ?? []) as Array<{ optionId?: string; kind?: string }>;
      this.handlers.onApproval(translated.event, (decision) => {
        const optionId = pickAcpOption(options, decision);
        if (!optionId) {
          // 拿不到选项时绝不能什么都不做 —— 那会让 Agent 干等到天荒地老
          this.log(`[acp] 没有可用的 ${decision} 选项，回 cancelled 让 Agent 停下`);
          this.send({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "cancelled" } } });
          return;
        }
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          result: { outcome: { outcome: "selected", optionId } },
        });
      });
      return;
    }

    this.log(`[acp] 忽略：${translated.reason}`);
  }
}
