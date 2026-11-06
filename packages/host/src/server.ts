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
import { homedir, networkInterfaces } from "node:os";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { AgentEvent } from "@vance/core";

export type Decision = "allow" | "reject" | "remember";

export interface HostOptions {
  /** 测试用：跳过设备配对，所有设备直接信任 */
  approveAllDevices?: boolean;
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

/** 一台设备（手机或电脑） */
interface Device {
  id: string;
  name: string;
  ip: string;
  at: number;
  socket: WebSocket;
  approved: boolean;
  attached?: boolean;
}

export interface DecisionRecord {
  requestId: string;
  decision: Decision;
  /** 是谁点的；审计里必须有这个 */
  by: string;
}

type DecisionHandler = (record: DecisionRecord) => boolean;

export class HostServer {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private handler: DecisionHandler | null = null;
  private promptHandler: ((text: string) => void) | null = null;
  private stopHandler: (() => void) | null = null;
  private shotHandler: (() => Promise<string | null>) | null = null;
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

  /** 已知设备：id → 设备。approved=false 表示还在门口等 */
  private readonly devices = new Map<string, Device>();

  /** 会话流水落盘，重启后还能接上 */
  private readonly historyFile = join(homedir(), ".vance", "history.jsonl");

  constructor(private readonly options: HostOptions) {
    this.tokens = new Set([options.token]);
    this.loadHistory();
  }

  private loadHistory(): void {
    try {
      if (!existsSync(this.historyFile)) return;
      const lines = readFileSync(this.historyFile, "utf8").split("\n").filter(Boolean).slice(-400);
      for (const line of lines) {
        try { this.history.push(JSON.parse(line)); } catch {}
      }
      console.log(`[host] 恢复历史 ${this.history.length} 条`);
    } catch {}
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

  /** 手机要看一眼屏幕；返回 data URL，失败返回 null */
  onScreenshot(handler: () => Promise<string | null>): void {
    this.shotHandler = handler;
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
    try {
      mkdirSync(dirname(this.historyFile), { recursive: true });
      appendFileSync(this.historyFile, JSON.stringify(message) + "\n");
    } catch {}
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

  /** 广播一帧屏幕画面（二进制 JPEG，不走 JSON，省 33% 体积） */
  broadcastFrame(frame: Buffer): void {
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(frame, { binary: true });
    }
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
        console.log(`[host] 页面请求来自 ${req.socket.remoteAddress}`);
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
      const params = new URL(req.url ?? "/", "http://x").searchParams;
      const token = params.get("token") ?? "";
      if (!this.tokens.has(token)) {
        console.log(`[host] 拒绝连接：口令不对（收到 "${token.slice(0, 12)}"）`);
        socket.close(4001, "bad token");
        return;
      }

      const ip = req.socket.remoteAddress ?? "?";
      const ua = String(req.headers["user-agent"] ?? "");
      const kind = /iphone|android|mobile/i.test(ua) ? "手机" : "电脑";
      const deviceId = params.get("device") || `anon-${Math.random().toString(16).slice(2, 10)}`;

      // 第一台设备自动信任，否则谁都进不来
      const firstEver =
        this.options.approveAllDevices === true || ![...this.devices.values()].some((d) => d.approved);
      const device: Device = this.devices.get(deviceId) ?? {
        id: deviceId,
        name: `${kind}-${deviceId.slice(0, 4)}`,
        ip,
        at: Date.now(),
        socket,
        approved: firstEver,
      };
      device.socket = socket;
      device.attached = false;
      this.devices.set(deviceId, device);

      if (!device.approved) {
        // ③ 在门口等着：不给历史、不给画面
        socket.send(JSON.stringify({ type: "device_pending", name: device.name }));
        this.askExisting(device);
        return;
      }

      this.attach(device);
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


  /** ①③ 让已连设备决定要不要放新设备进来 */
  private askExisting(device: Device): void {
    for (const d of this.devices.values()) {
      if (d.approved && d.socket.readyState === d.socket.OPEN) {
        d.socket.send(
          JSON.stringify({
            type: "device_request",
            deviceId: device.id,
            name: device.name,
            ip: device.ip,
            at: device.at,
          }),
        );
      }
    }
  }

  /** 真正把一台设备接进来：发 hello + 历史 + 待办，并挂上消息处理 */
  private attach(device: Device): void {
    const socket = device.socket;
    if (device.attached) return;
    device.attached = true;
    this.clients.add(socket);

    console.log(`[host] 设备已连接：${device.name}（${device.ip}，共 ${this.clients.size} 台）`);

    socket.send(
      JSON.stringify({
        type: "hello",
        project: this.options.projectName ?? "vance",
        task: this.options.task ?? "",
        device: device.name,
      }),
    );

    const past = this.history.filter(
      (m) => !((m as any)?.type === "event" && (m as any)?.event?.type === "approval_request"),
    );
    if (past.length > 0) socket.send(JSON.stringify({ type: "history", items: past }));
    for (const pending of this.pendingApprovals.values()) {
      socket.send(JSON.stringify({ type: "event", event: pending }));
    }

    // ① 告诉其他设备：又来了一台（看得见才叫可信）
    for (const d of this.devices.values()) {
      if (d.approved && d.id !== device.id && d.socket.readyState === d.socket.OPEN) {
        d.socket.send(
          JSON.stringify({
            type: "notice",
            level: "auto",
            text: `另一台设备接入：${device.name}（${device.ip}）`,
          }),
        );
      }
    }

    socket.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.handleMessage(socket, device, msg);
    });
    socket.on("close", () => this.clients.delete(socket));
    socket.on("error", () => this.clients.delete(socket));
  }

  private handleMessage(socket: WebSocket, device: Device, msg: any): void {
    // ③ 已有设备对新设备点头/摇头
    if (msg?.type === "device_decision" && typeof msg.deviceId === "string") {
      const target = this.devices.get(msg.deviceId);
      if (!target) return;
      if (msg.allow) {
        target.approved = true;
        target.socket.send(JSON.stringify({ type: "device_approved" }));
        this.attach(target);
        this.emit({
          type: "notice",
          level: "auto",
          text: `已允许接入：${target.name}（${device.name} 批准）`,
        });
      } else {
        this.devices.delete(target.id);
        try { target.socket.close(4004, "denied"); } catch {}
        this.emit({
          type: "notice",
          level: "deny",
          text: `已拒绝接入：${target.name}（${device.name} 拒绝）`,
        });
      }
      return;
    }

    if (msg?.type === "resync") {
      const past = this.history.filter(
        (m) => !((m as any)?.type === "event" && (m as any)?.event?.type === "approval_request"),
      );
      if (past.length > 0) socket.send(JSON.stringify({ type: "history", items: past }));
      for (const pending of this.pendingApprovals.values()) {
        socket.send(JSON.stringify({ type: "event", event: pending }));
      }
      return;
    }
    if (msg?.type === "prompt" && typeof msg.text === "string" && msg.text.trim()) {
      this.emit({ type: "user", text: msg.text });
      this.promptHandler?.(msg.text.trim());
      return;
    }
    if (msg?.type === "stop") {
      this.stopHandler?.();
      return;
    }
    if (msg?.type === "screenshot") {
      void (async () => {
        try {
          const url = (await this.shotHandler?.()) ?? null;
          if (url) socket.send(JSON.stringify({ type: "image", dataUrl: url }));
          else socket.send(JSON.stringify({ type: "notice", level: "deny", text: "截图失败" }));
        } catch {
          socket.send(JSON.stringify({ type: "notice", level: "deny", text: "截图失败" }));
        }
      })();
      return;
    }
    if (msg?.type !== "decision" || typeof msg.requestId !== "string") return;

    const decision: Decision =
      msg.decision === "allow" ? "allow" : msg.decision === "remember" ? "remember" : "reject";

    // ② 批准记录里必须带上"是谁点的"
    const accepted = this.handler?.({ requestId: msg.requestId, decision, by: device.name }) ?? false;
    if (accepted) {
      const resolved = this.pendingApprovals.get(msg.requestId) as any;
      this.pendingApprovals.delete(msg.requestId);
      const verb = decision === "reject" ? "已拒绝" : "已批准";
      this.emit({
        type: "notice",
        level: "auto",
        text: `${verb}：${String(resolved?.action_display ?? "").slice(0, 60)}（${device.name}）`,
      });
    }
    socket.send(JSON.stringify({ type: "ack", requestId: msg.requestId, accepted }));
  }

  close(): Promise<void> {
    for (const c of this.clients) c.close();
    this.clients.clear();
    this.devices.clear();
    this.wss?.close();
    return new Promise((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
  }
}

export interface LanEntry {
  iface: string;
  address: string;
  url: string;
}

/** 列出本机所有可能的局域网地址，附带网卡名，方便挑「真正那张」 */
export function lanEntries(port: number): LanEntry[] {
  const out: LanEntry[] = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        out.push({ iface: name, address: net.address, url: `http://${net.address}:${port}` });
      }
    }
  }
  return out;
}

/** 兼容旧调用 */
export function lanUrls(port: number): string[] {
  return lanEntries(port).map((e) => e.url);
}
