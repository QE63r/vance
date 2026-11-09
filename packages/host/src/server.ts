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

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { homedir, networkInterfaces } from "node:os";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, basename, extname, join, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { AgentEvent } from "@vance/core";

/** 前端构建产物会出现的类型；其余按二进制发，别猜 */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export type Decision = "allow" | "reject" | "remember";

/** 旧流水没有 session_id；读进来统一归到这条只读会话 */
const LEGACY_SESSION = "legacy";
/** 会话就绪前的系统消息；不当作会话展示 */
const UNASSIGNED_SESSION = "unassigned";

interface SessionMeta {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface HistoryEntry {
  session_id: string;
  msg: unknown;
}

/** 权限档位：只读 / 工作区 / 完全 */
export type Profile = "read-only" | "workspace" | "full";

const PROFILES: Profile[] = ["read-only", "workspace", "full"];

/** 「本轮产出」的结构化形状；前端产出区直接消费它，不再解析 notice 文案 */
export interface ArtifactsPayload {
  turnId: string;
  added: string[];
  changed: string[];
  removed: string[];
  warnings: string[];
}

/** 取件单：只对一个文件、60 秒、绑定签发时的 sha256 */
interface ArtifactTicket {
  path: string;
  sha256: string;
  size: number;
  contentType: string;
  expiresAt: number;
  sessionId: string;
}

const ARTIFACT_MIME: Record<string, string> = {  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** 路径比较用：Windows 不区分大小写；解析失败就退化成原串小写 */
function normalizePath(path: string): string {
  try {
    return resolve(path).toLowerCase();
  } catch {
    return path.toLowerCase();
  }
}

/** 规则由启动器持有（~/.vance/rules.json）；host 只提供查询与撤销口 */
export interface RulesProvider {
  list(): string[];
  revoke(key: string): boolean;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HistoryEntry).session_id === "string" &&
    "msg" in (value as object)
  );
}

export interface HostOptions {
  /** 测试用：跳过设备配对，所有设备直接信任 */
  approveAllDevices?: boolean;
  /** 端口，0 表示让系统分配 */
  port?: number;
  /** 配对令牌；手机首次连接必须带上 */
  token: string;
  /** 审批页 HTML 的路径 */
  pagePath: string;
  /**
   * 前端构建产物目录（Vite 的 `packages/web/dist`）。
   *
   * 目录由调用方决定，这里不写死：干净检出时 dist 被 .gitignore 忽略、并不存在，
   * 缺了它只该是 /app/ 404，而不是起不来。
   */
  webDir?: string;
  /**
   * 会话流水文件，默认 `~/.vance/history.jsonl`。
   *
   * 测试指到临时目录：host 的用例不该往用户真实流水里写东西。
   */
  historyFile?: string;
  /** 权限档位文件，默认 ~/.vance/profile.json；重启后保留 */
  profileFile?: string;
  /** 默认权限档位，默认 workspace */
  defaultProfile?: Profile;
  /** 取件单有效期（毫秒），默认 60 秒；测试可以调小 */
  artifactTicketTtlMs?: number;
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
  /** 这台设备正在看哪条会话（默认等于 host 的活动会话） */
  viewSessionId?: string;
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
  private readonly pendingApprovals = new Map<string, { event: AgentEvent; sessionId: string }>();

  /** 规则的持有者；没有注入时 /rules 返回空列表 */
  private rules: RulesProvider | null = null;

  /**
   * 会话流水，按会话分桶。
   *
   * 每条消息都带 session_id；没有 id 的旧行读成 legacy。
   * 只放内存：进程没了就没了——这一版不做持久化。
   */
  private readonly history: HistoryEntry[] = [];

  /** 会话表：id → 元信息；active 由 useSession 选定 */
  private readonly sessions = new Map<string, SessionMeta>();

  /** 当前活动会话；启动到 Agent 就绪之间是 null */
  private activeSessionId: string | null = null;

  /** 已知设备：id → 设备。approved=false 表示还在门口等 */
  private readonly devices = new Map<string, Device>();

  /** 会话流水落盘，重启后还能接上 */
  private readonly historyFile: string;

  /** 权限档位；只影响"要不要问"，不影响硬禁止 */
  private profile: Profile;
  private readonly profileFile: string;

  /** 每个会话最近一次产出；取件只能命中这里列出的文件 */
  private readonly latestArtifacts = new Map<string, ArtifactsPayload>();
  private readonly artifactTickets = new Map<string, ArtifactTicket>();
  private readonly ticketTtlMs: number;

  /** 构建产物目录的绝对路径；没配就是 null（只有测试台，没有真前端） */
  private readonly webDir: string | null;

  constructor(private readonly options: HostOptions) {
    this.tokens = new Set([options.token]);
    this.webDir = options.webDir ? resolve(options.webDir) : null;
    this.historyFile = options.historyFile ?? join(homedir(), ".vance", "history.jsonl");
    this.profileFile = options.profileFile ?? join(homedir(), ".vance", "profile.json");
    this.ticketTtlMs = options.artifactTicketTtlMs ?? 60_000;
    const saved = this.loadProfile();
    // 完全权限是任务级的：重启不应该恢复成 full
    this.profile = saved && saved !== "full" ? saved : options.defaultProfile ?? "workspace";
    this.loadHistory();
  }

  private loadProfile(): Profile | null {
    try {
      if (!existsSync(this.profileFile)) return null;
      const raw = JSON.parse(readFileSync(this.profileFile, "utf8")) as { profile?: unknown };
      return PROFILES.includes(raw.profile as Profile) ? (raw.profile as Profile) : null;
    } catch {
      return null;
    }
  }

  private saveProfile(): void {
    try {
      mkdirSync(dirname(this.profileFile), { recursive: true });
      writeFileSync(this.profileFile, JSON.stringify({ profile: this.profile }) + "\n");
    } catch {}
  }

  /** 当前权限档位（host-demo 判定时读它） */
  get currentProfile(): Profile {
    return this.profile;
  }

  /** 只有人能提档；档位变更进流水并广播 */
  setProfile(profile: Profile, by = "host"): boolean {
    if (!PROFILES.includes(profile)) return false;
    if (profile === this.profile) return true;
    const from = this.profile;
    this.profile = profile;
    this.saveProfile();
    this.emit({ type: "profile", profile, from, by, at: Date.now() });
    return true;
  }

  private loadHistory(): void {
    try {
      if (!existsSync(this.historyFile)) return;
      const lines = readFileSync(this.historyFile, "utf8").split("\n").filter(Boolean).slice(-20000);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as unknown;
          const entry = isHistoryEntry(parsed) ? parsed : { session_id: LEGACY_SESSION, msg: parsed };
          this.history.push(entry);
          // 重启后“最近一次产出”还在，不然历史里的产出点开是 404
          const msg = entry.msg as { type?: string; artifacts?: ArtifactsPayload };
          if (msg?.type === "artifacts" && msg.artifacts) this.latestArtifacts.set(entry.session_id, msg.artifacts);
          this.touch(entry.session_id);
        } catch {}
      }
      this.mergeChatChunks();
      this.trimHistory();
      console.log(`[host] 恢复历史 ${this.history.length} 条（${this.sessions.size} 条会话）`);
    } catch {}
  }

  /**
   * 流式 chat 是"传输细节"：一条回复会被拆成几十个片段。
   * 若每个片段都算一条历史，400 条上限会把一次对话从中间切断。
   * 这里把同一 messageId 的连续片段并回一条（只在内存里；落盘仍是追加）。
   */
  private mergeChatChunks(): void {
    const out: HistoryEntry[] = [];
    for (const entry of this.history) {
      const prev = out[out.length - 1];
      const m = entry.msg as any;
      const p = prev?.msg as any;
      if (
        prev &&
        prev.session_id === entry.session_id &&
        m?.type === "chat" &&
        p?.type === "chat" &&
        p.messageId === m.messageId
      ) {
        p.text = String(p.text ?? "") + String(m.text ?? "");
        continue;
      }
      out.push(entry);
    }
    this.history.length = 0;
    this.history.push(...out);
  }

  /** 记住一条会话并刷新它的 updated_at；标题只由启动器给，host 不猜 */
  private touch(sessionId: string, title?: string): SessionMeta {
    const at = Date.now();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (title && title !== existing.title) existing.title = title;
      existing.updated_at = at;
      return existing;
    }
    const meta: SessionMeta = {
      id: sessionId,
      title: title ?? (sessionId === LEGACY_SESSION ? "迁移前流水（无会话 id）" : sessionId),
      created_at: at,
      updated_at: at,
    };
    this.sessions.set(sessionId, meta);
    return meta;
  }

  /** 每条会话最多留 400 条；超出从最旧的开始丢 */
  private trimHistory(): void {
    const counts = new Map<string, number>();
    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i]!;
      const n = (counts.get(entry.session_id) ?? 0) + 1;
      counts.set(entry.session_id, n);
      if (n > 400) this.history.splice(i, 1);
    }
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

  /** 注入规则读写口：启动器是规则的唯一持有者，host 不碰文件 */
  onRules(provider: RulesProvider): void {
    this.rules = provider;
  }

  /** 一轮结束后的产出：结构化广播，同时落进流水 */
  broadcastArtifacts(payload: ArtifactsPayload): void {
    const sid = this.activeSessionId ?? "unassigned";
    this.latestArtifacts.set(sid, payload);
    this.emit({ type: "artifacts", artifacts: payload });
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

  /**
   * 当前活动会话就绪 / 切换。
   *
   * 为什么由启动器调用而不是构造函数：ACP 的 `ses_...` 要等 Agent 起来才知道。
   * 已经有设备在线时补一条 `session` 通知，免得它一直显示空会话。
   */
  useSession(id: string, title?: string): void {
    if (!id) return;
    const meta = this.touch(id, title);
    this.activeSessionId = id;
    this.sendAll({ type: "session", session_id: id, title: meta.title, active: true });
  }

  /** 先把消息记进流水（带会话归属），再推给所有在线的手机 */
  private emit(message: unknown, sessionId?: string): void {
    const sid = sessionId ?? this.activeSessionId ?? UNASSIGNED_SESSION;
    const tagged = { ...(message as Record<string, unknown>), session_id: sid };

    // 会话就绪前的系统消息不落流水：它们不属于任何会话，回放出来只会让人困惑
    if (sid !== UNASSIGNED_SESSION) {
      const last = this.history[this.history.length - 1];
      const m = tagged as any;
      const p = last?.msg as any;
      const sameChat =
        last &&
        last.session_id === sid &&
        m?.type === "chat" &&
        p?.type === "chat" &&
        p.messageId === m.messageId;
      if (sameChat) p.text = String(p.text ?? "") + String(m.text ?? "");
      else this.history.push({ session_id: sid, msg: tagged });
      this.trimHistory();
      try {
        mkdirSync(dirname(this.historyFile), { recursive: true });
        appendFileSync(this.historyFile, JSON.stringify({ session_id: sid, msg: tagged }) + "\n");
      } catch {}
      this.touch(sid);
    }

    this.sendAll(tagged);
  }

  private sendAll(payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(text);
    }
  }

  /** 把一条事件推给所有已连接的手机 */
  broadcast(event: AgentEvent): void {
    const sid = this.activeSessionId ?? UNASSIGNED_SESSION;
    if (event.type === "approval_request") {
      this.pendingApprovals.set(event.request_id, { event, sessionId: sid });
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

  /**
   * /app/* 静态托管：把 Vite 的构建产物发给手机。
   *
   * 三条规则（顺序固定）：
   *   /app/assets/*        带内容哈希 → 一年不可变缓存
   *   /app、无扩展名的路由   → index.html（no-store，路由由前端自己处理）
   *   带扩展名但文件不存在    → 404
   *
   * 最后一条必须守住：把 404 也回成 index.html，浏览器会把 HTML 当 JS 执行，
   * 控制台只报一句语法错误、页面白屏——比明确 404 难查得多。
   */
  private serveWeb(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
      res.end("method not allowed");
      return;
    }

    const notFound = (why: string): void => {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(`not found: ${why}`);
    };

    if (!this.webDir) return notFound("web build not configured");

    // 先解码再拼路径：%2e%2e 这类转义只有解完才看得见
    let rel: string;
    try {
      rel = decodeURIComponent(pathname.slice("/app".length)).replace(/^\/+/, "");
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("bad path");
      return;
    }

    const webDir = this.webDir;
    const inside = (p: string): boolean =>
      p === webDir || p.startsWith(webDir.endsWith(sep) ? webDir : webDir + sep);
    const isFile = (p: string): boolean => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    };

    const inAssets = rel.startsWith("assets/");
    const wantsIndex = rel === "" || rel === "index.html" || extname(rel) === "";

    if (wantsIndex && !inAssets) {
      const index = join(webDir, "index.html");
      if (!inside(index) || !isFile(index)) return notFound("index.html");
      this.sendFile(req, res, index, "no-store");
      return;
    }

    const target = resolve(webDir, rel);
    if (!inside(target) || !isFile(target)) return notFound(rel);
    this.sendFile(req, res, target, inAssets ? "public, max-age=31536000, immutable" : "no-cache");
  }

  private authorized(req: IncomingMessage): boolean {
    return this.tokens.has(String(req.headers["x-vance-token"] ?? ""));
  }

  private sendFile(req: IncomingMessage, res: ServerResponse, path: string, cacheControl: string): void {    let body: Buffer;
    try {
      body = readFileSync(path);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(body.length),
      "cache-control": cacheControl,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  start(): Promise<{ port: number; urls: string[] }> {
    const hostname = this.options.hostname ?? "0.0.0.0";

    const http = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // 顺序固定：/health → /sessions → /app/assets/* → /app fallback → 其余 404。
      // /ws 走 upgrade 事件，不经过这条链。
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, devices: this.deviceCount }));
        return;
      }

      // 权限档位：GET 查询 / POST 切换。必须带 token——它会放宽或收紧审批。
      if (url.pathname === "/profile") {
        if (!this.authorized(req)) {
          res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
          return;
        }
        if (req.method === "GET" || req.method === "HEAD") {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(req.method === "HEAD" ? undefined : JSON.stringify({ profile: this.profile }));
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "GET, HEAD, POST" });
          res.end("method not allowed");
          return;
        }
        let raw = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          raw += chunk;
          if (raw.length > 16_000) req.destroy();
        });
        req.on("end", () => {
          let profile = "";
          try {
            profile = String((JSON.parse(raw) as { profile?: unknown })?.profile ?? "");
          } catch {
            /* 坏 body 按未知档位处理 */
          }
          const ok = this.setProfile(profile as Profile, "phone");
          res.writeHead(ok ? 200 : 400, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify({ ok, profile: this.profile }));
        });
        return;
      }

      // 取件单：只允许「当前会话最近一次产出」里的文件，60 秒、单文件
      if (url.pathname === "/artifacts/ticket") {
        if (!this.authorized(req)) {
          res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST" });
          res.end("method not allowed");
          return;
        }
        let raw = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          raw += chunk;
          if (raw.length > 16_000) req.destroy();
        });
        req.on("end", () => {
          const send = (status: number, body: unknown) => {
            res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify(body));
          };
          let body: { path?: unknown; session_id?: unknown } = {};
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            send(400, { ok: false, error: "bad-json" });
            return;
          }
          const requested = typeof body.path === "string" ? body.path : "";
          if (!requested) {
            send(400, { ok: false, error: "path-required" });
            return;
          }
          const sid = typeof body.session_id === "string" ? body.session_id : this.activeSessionId ?? "unassigned";
          const latest = this.latestArtifacts.get(sid);
          if (!latest) {
            send(404, { ok: false, error: "no-artifacts" });
            return;
          }
          const allowed = [...latest.added, ...latest.changed].map((p) => normalizePath(p));
          if (!allowed.includes(normalizePath(requested))) {
            send(404, { ok: false, error: "not-an-artifact" });
            return;
          }

          let bytes: Buffer;
          try {
            if (!statSync(requested).isFile()) throw new Error("not-file");
            bytes = readFileSync(requested);
          } catch {
            send(404, { ok: false, error: "missing" });
            return;
          }
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const ticket = randomBytes(24).toString("base64url");
          const expiresAt = Date.now() + this.ticketTtlMs;
          this.artifactTickets.set(ticket, {
            path: requested,
            sha256,
            size: bytes.length,
            contentType: ARTIFACT_MIME[extname(requested).toLowerCase()] ?? "application/octet-stream",
            expiresAt,
            sessionId: sid,
          });
          send(200, {
            ticket,
            path: requested,
            sha256,
            size: bytes.length,
            content_type: ARTIFACT_MIME[extname(requested).toLowerCase()] ?? "application/octet-stream",
            expires_at: expiresAt,
          });
        });
        return;
      }

      // 凭票据取原件：票据本身就是短期凭证，不再要主 token
      if (url.pathname.startsWith("/artifacts/") && url.pathname !== "/artifacts/accept") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, { allow: "GET, HEAD" });
          res.end("method not allowed");
          return;
        }
        const ticket = url.pathname.slice("/artifacts/".length);
        const entry = this.artifactTickets.get(ticket);
        if (!entry) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("not found");
          return;
        }
        if (entry.expiresAt <= Date.now()) {
          this.artifactTickets.delete(ticket);
          res.writeHead(410, { "content-type": "text/plain; charset=utf-8" });
          res.end("ticket expired");
          return;
        }
        let bytes: Buffer;
        try {
          bytes = readFileSync(entry.path);
        } catch {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("not found");
          return;
        }
        const inline = /^(image\/|application\/pdf|text\/)/.test(entry.contentType);
        const name = basename(entry.path);
        // Content-Disposition 头只能是 ASCII：中文名用 RFC 5987 的 filename* 带上
        const asciiName = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
        res.writeHead(200, {
          "content-type": entry.contentType,
          "content-length": String(bytes.length),
          "cache-control": "no-store",
          "content-disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        });
        res.end(req.method === "HEAD" ? undefined : bytes);
        return;
      }

      // 验收：重新算哈希，和票里的不一致就 409——你确认的必须是你看到的字节
      if (url.pathname === "/artifacts/accept") {
        if (!this.authorized(req)) {
          res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST" });
          res.end("method not allowed");
          return;
        }
        let raw = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          raw += chunk;
          if (raw.length > 16_000) req.destroy();
        });
        req.on("end", () => {
          const send = (status: number, body: unknown) => {
            res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify(body));
          };
          let body: { ticket?: unknown; decision?: unknown; note?: unknown } = {};
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            send(400, { ok: false, error: "bad-json" });
            return;
          }
          const ticket = typeof body.ticket === "string" ? body.ticket : "";
          const decision = body.decision === "reject" ? "reject" : body.decision === "accept" ? "accept" : "";
          if (!ticket || !decision) {
            send(400, { ok: false, error: "ticket-and-decision-required" });
            return;
          }
          const entry = this.artifactTickets.get(ticket);
          if (!entry) {
            send(404, { ok: false, error: "unknown-ticket" });
            return;
          }
          let bytes: Buffer;
          try {
            bytes = readFileSync(entry.path);
          } catch {
            send(404, { ok: false, error: "missing" });
            return;
          }
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          if (sha256 !== entry.sha256) {
            send(409, { ok: false, error: "file-changed", sha256 });
            return;
          }
          const note = typeof body.note === "string" ? body.note.trim() : "";
          this.emit({
            type: "artifact_decision",
            path: entry.path,
            sha256,
            decision,
            by: "phone",
            at: Date.now(),
            note: note || undefined,
          });
          this.artifactTickets.delete(ticket);
          if (decision === "reject" && note) {
            this.promptHandler?.(`交付物未通过：${note}`);
          }
          send(200, { ok: true, decision, path: entry.path, sha256 });
        });
        return;
      }

      // 只读会话列表：手机刷新 / 重开之后靠它知道"还有哪些事摆着"
      if (url.pathname === "/sessions") {        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, { allow: "GET, HEAD" });
          res.end("method not allowed");
          return;
        }
        const sessions = [...this.sessions.values()]
          .map((s) => ({ ...s, active: s.id === this.activeSessionId }))
          .sort((a, b) => b.updated_at - a.updated_at);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(req.method === "HEAD" ? undefined : JSON.stringify({ sessions }));
        return;
      }

      // 规则：只读列表 + 撤销。规则文件由启动器持有，host 不碰磁盘。
      if (url.pathname === "/rules") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, { allow: "GET, HEAD" });
          res.end("method not allowed");
          return;
        }
        const rules = this.rules?.list() ?? [];
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(req.method === "HEAD" ? undefined : JSON.stringify({ rules }));
        return;
      }

      if (url.pathname === "/rules/revoke") {
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST" });
          res.end("method not allowed");
          return;
        }
        let raw = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          raw += chunk;
          if (raw.length > 64_000) req.destroy();
        });
        req.on("end", () => {
          let key = "";
          try {
            key = String((JSON.parse(raw) as { key?: unknown })?.key ?? "");
          } catch {
            /* 坏 body 就当没给 key */
          }
          const ok = key !== "" && (this.rules?.revoke(key) ?? false);
          res.writeHead(ok ? 200 : 404, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify({ ok, key }));
        });
        return;
      }
      if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
        this.serveWeb(req, res, url.pathname);
        return;
      }
      if (url.pathname === "/") {
        console.log(`[host] 页面请求来自 ${req.socket.remoteAddress}`);
        // 每次请求都读文件：改页面不用重启服务，正在用的人刷新一下就是新的
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(readFileSync(this.options.pagePath, "utf8"));
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

      // 指定 ?session= 就是"看这条会话"；没指定就跟活动会话。
      // 未知 id 不静默切换：保留连接、给解释，仍回活动会话的流水。
      const wantedSession = params.get("session") ?? "";
      let viewSession = this.activeSessionId;
      let missingSession = "";
      if (wantedSession) {
        if (this.sessions.has(wantedSession)) viewSession = wantedSession;
        else missingSession = wantedSession;
      }

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
      device.viewSessionId = viewSession ?? UNASSIGNED_SESSION;
      this.devices.set(deviceId, device);

      if (!device.approved) {
        // ③ 在门口等着：不给历史、不给画面
        socket.send(JSON.stringify({ type: "device_pending", name: device.name }));
        this.askExisting(device);
        return;
      }

      this.attach(device);

      if (missingSession) {
        socket.send(
          JSON.stringify({
            type: "notice",
            level: "deny",
            session_id: device.viewSessionId,
            text: `会话 ${missingSession} 不存在，已回到当前会话`,
          }),
        );
      }
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

  /** 某条会话的流水；审批请求不重放（它们该以 pending 形式单独补发） */
  private historyFor(sessionId: string): unknown[] {
    return this.history
      .filter((h) => h.session_id === sessionId)
      .map((h) => h.msg)
      .filter((m) => !((m as any)?.type === "event" && (m as any)?.event?.type === "approval_request"));
  }

  /** 真正把一台设备接进来：发 hello + 历史 + 待办，并挂上消息处理 */
  private attach(device: Device): void {
    const socket = device.socket;
    if (device.attached) return;
    device.attached = true;
    this.clients.add(socket);

    console.log(`[host] 设备已连接：${device.name}（${device.ip}，共 ${this.clients.size} 台）`);

    const view = device.viewSessionId ?? this.activeSessionId ?? UNASSIGNED_SESSION;

    socket.send(
      JSON.stringify({
        type: "hello",
        project: this.options.projectName ?? "vance",
        task: this.options.task ?? "",
        device: device.name,
        session_id: view,
        // 手机倒计时需要跟服务端同一个时钟；缺了它只能信手机本地时间
        server_time: Date.now(),
        profile: this.profile,
      }),
    );

    const past = this.historyFor(view);
    if (past.length > 0) socket.send(JSON.stringify({ type: "history", session_id: view, items: past }));
    for (const pending of this.pendingApprovals.values()) {
      if (pending.sessionId !== view) continue;
      socket.send(JSON.stringify({ type: "event", event: pending.event, session_id: view }));
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
      const view = device.viewSessionId ?? this.activeSessionId ?? UNASSIGNED_SESSION;
      const past = this.historyFor(view);
      if (past.length > 0) socket.send(JSON.stringify({ type: "history", session_id: view, items: past }));
      for (const pending of this.pendingApprovals.values()) {
        if (pending.sessionId !== view) continue;
        socket.send(JSON.stringify({ type: "event", event: pending.event, session_id: view }));
      }
      return;
    }
    if (msg?.type === "session/attach" && typeof msg.sessionId === "string") {
      const target = this.sessions.get(msg.sessionId);
      if (!target) {
        socket.send(
          JSON.stringify({
            type: "notice",
            level: "deny",
            session_id: device.viewSessionId,
            text: `会话 ${msg.sessionId} 不存在`,
          }),
        );
        return;
      }
      device.viewSessionId = target.id;
      socket.send(
        JSON.stringify({
          type: "session",
          session_id: target.id,
          title: target.title,
          active: target.id === this.activeSessionId,
        }),
      );
      const past = this.historyFor(target.id);
      if (past.length > 0) socket.send(JSON.stringify({ type: "history", session_id: target.id, items: past }));
      for (const pending of this.pendingApprovals.values()) {
        if (pending.sessionId !== target.id) continue;
        socket.send(JSON.stringify({ type: "event", event: pending.event, session_id: target.id }));
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
      this.pendingApprovals.delete(msg.requestId);
      // 决定本身就是审计记录：谁、什么时候、批还是拒。落流水，所有设备都收到。
      this.emit({
        type: "decision",
        requestId: msg.requestId,
        decision,
        by: device.name,
        at: Date.now(),
      });
    }
    socket.send(
      JSON.stringify({ type: "ack", requestId: msg.requestId, accepted, session_id: device.viewSessionId }),
    );
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
