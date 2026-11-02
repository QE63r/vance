/**
 * Agent Host 的最小实现：一个网页 + 一条 WebSocket。
 *
 * 它只做搬运：
 *   事件 → 广播给已连接的手机
 *   手机的决定 → 交给注册的回调（再由它转给 Agent）
 *
 * 不解析事件内容、不判断对错、不存业务状态。
 *
 * ⚠️ 这是局域网原型：走 ws:// 明文，靠一次性 token 拦住"谁都能连"。
 *    端到端加密在 P5，别把这个拿去做公网部署。
 */

import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import type { AgentEvent } from "@vance/core";

export type Decision = "allow" | "reject" | "remember";

export interface HostOptions {
  /** 端口，0 表示让系统分配 */
  port?: number;
  /** 配对令牌；手机首次连接必须带上 */
  token: string;
  /** 审批页 HTML 的路径 */
  pagePath: string;
  /** 监听地址，默认 0.0.0.0（局域网可访问） */
  hostname?: string;
  /** 项目名，展示用 */
  projectName?: string;
  /**
   * 用户交代给 Agent 的原话。
   *
   * 为什么放在 Host 而不是事件里：它不是 Agent 产生的事实，是"人说的话"。
   * 但它是判断"这一步该不该做"最重要的上下文——所以要原样送到手机上。
   */
  task?: string;
}

export interface DecisionRecord {
  requestId: string;
  decision: Decision;
}

type DecisionHandler = (record: DecisionRecord) => boolean;

export class HostServer {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private handler: DecisionHandler | null = null;
  private promptHandler: ((text: string) => void) | null = null;
  private stopHandler: (() => void) | null = null;
  private readonly tokens: Set<string>;
  /**
   * 尚未被处理掉的审批请求。
   *
   * 为什么要在服务端留一份：手机可能在请求发出之后才连上
   * （锁屏、切后台、刚打开页面）。不补发，人就永远看不到这条请求，
   * 而 Agent 还在那头等着。
   */
  private readonly pendingApprovals = new Map<string, AgentEvent>();

  /**
   * 会话流水。手机刷新、换设备、锁屏回来，都靠它把上下文接回去。
   * 只放内存：进程没了就没了——这一版不做持久化。
   */
  private readonly history: unknown[] = [];

  constructor(private readonly options: HostOptions) {
    this.tokens = new Set([options.token]);
  }

  /** 谁来决定；返回 false 表示"这条请求已经失效或不存在" */
  onDecision(handler: DecisionHandler): void {
    this.handler = handler;
  }

  /** 手机发来一句新指令（让它接着干下一件事） */
  onPrompt(handler: (text: string) => void): void {
    this.promptHandler = handler;
  }

  /** 手机要求停下来 */
  onStop(handler: () => void): void {
    this.stopHandler = handler;
  }

  /** 告诉所有设备：这一轮跑完了 / 又开始跑了 */
  broadcastTurn(state: "running" | "idle" | "stopped"): void {
    this.emit({ type: "turn", state });
  }

  /** 系统提示：被策略拦截、静默放行之类，不是 Agent 说的话 */
  broadcastNotice(level: "deny" | "auto", text: string): void {
    this.emit({ type: "notice", level, text });
  }

  /** 转发 Agent 说的一句话（流式片段，原样） */
  broadcastChat(messageId: string, text: string): void {
    this.emit({ type: "chat", role: "agent", messageId, text });
  }

  /** 先把消息记进流水，再推给所有在线的手机 */
  private emit(message: unknown): void {
    this.history.push(message);
    if (this.history.length > 400) this.history.splice(0, this.history.length - 400);
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  /** 把一条事件推给所有已连接的手机 */
  broadcast(event: AgentEvent): void {
    if (event.type === "approval_request") {
      this.pendingApprovals.set(event.request_id, event);
    }
    this.emit({ type: "event", event });
  }

  /** 主动忘掉一条请求（超时、Agent 自己撤回等情况） */
  forget(requestId: string): void {
    this.pendingApprovals.delete(requestId);
  }

  /** 当前连了几台设备 */
  get deviceCount(): number {
    return this.clients.size;
  }

  start(): Promise<{ port: number; urls: string[] }> {
    const hostname = this.options.hostname ?? "0.0.0.0";

    const http = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname === "/") {
        // 每次请求都读文件：改页面不用重启服务，正在用的人刷新一下就是新的
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(readFileSync(this.options.pagePath, "utf8"));
        return;
      }
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, devices: this.deviceCount }));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    const wss = new WebSocketServer({ server: http, path: "/ws" });
    this.wss = wss;

    wss.on("connection", (socket, req) => {
      const token = new URL(req.url ?? "/", "http://x").searchParams.get("token") ?? "";
      if (!this.tokens.has(token)) {
        console.log(`[host] 拒绝连接：口令不对（收到 "${token.slice(0, 12)}"）`);
        socket.close(4001, "bad token");
        return;
      }
      console.log(`[host] 设备已连接（当前 ${this.clients.size + 1} 台）`);
      this.clients.add(socket);
      socket.send(
        JSON.stringify({
          type: "hello",
          project: this.options.projectName ?? "vance",
          task: this.options.task ?? "",
        }),
      );
      // 补发历史：刷新、换设备、锁屏回来都能接上
      if (this.history.length > 0) {
        socket.send(JSON.stringify({ type: "history", items: this.history }));
      }
      // 待审批的请求已经包含在 history 里，不再单独补发，避免重复

      socket.on("message", (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg?.type === "prompt" && typeof msg.text === "string" && msg.text.trim()) {
          this.promptHandler?.(msg.text.trim());
          return;
        }
        if (msg?.type === "stop") {
          this.stopHandler?.();
          return;
        }
        if (msg?.type !== "decision" || typeof msg.requestId !== "string") return;
        const decision: Decision =
          msg.decision === "allow" ? "allow" : msg.decision === "remember" ? "remember" : "reject";
        const accepted = this.handler?.({ requestId: msg.requestId, decision }) ?? false;
        if (accepted) this.pendingApprovals.delete(msg.requestId);
        socket.send(JSON.stringify({ type: "ack", requestId: msg.requestId, accepted }));
      });

      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));
    });

    this.http = http;
    return new Promise((resolve) => {
      http.listen(this.options.port ?? 0, hostname, () => {
        const address = http.address();
        const port = typeof address === "object" && address ? address.port : 0;
        resolve({ port, urls: lanUrls(port) });
      });
    });
  }

  close(): Promise<void> {
    for (const c of this.clients) c.close();
    this.clients.clear();
    this.wss?.close();
    return new Promise((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
  }
}

/** 列出本机所有可能的局域网地址，手机会从这里面挑一个能通的 */
export function lanUrls(port: number): string[] {
  const urls: string[] = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}
