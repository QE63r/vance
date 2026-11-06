import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { HostServer, type Decision, type HostOptions } from "../src/index.js";

const PAGE = fileURLToPath(new URL("../public/index.html", import.meta.url));

let server: HostServer | null = null;
const tempDirs: string[] = [];

afterEach(async () => {
  await server?.close();
  server = null;
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

/**
 * 造一个假的前端构建产物。
 *
 * 为什么不直接用 packages/web/dist：dist/ 在 .gitignore 里，干净检出时不存在，
 * 而且 @vance/host 的测试只依赖上游 build、不构建 web。测试不该靠"先手动 build"。
 */
function webFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "vance-web-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><html><body><div id="root">SESSION-VIEW</div></body></html>',
  );
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log('session view')");
  writeFileSync(join(dir, "favicon.ico"), Buffer.from([0, 0, 1, 0]));
  return dir;
}

/** 每个用例独立的流水文件：host 的测试不该读写用户真实的 ~/.vance/history.jsonl */
function historyFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "vance-history-"));
  tempDirs.push(dir);
  return join(dir, "history.jsonl");
}

function makeServer(options: Omit<HostOptions, "historyFile"> & { historyFile?: string }): HostServer {
  return new HostServer({ ...options, historyFile: options.historyFile ?? historyFile() });
}

/** 连上并把收到的消息收进数组，直到满足条件或超时 */
function listen(
  port: number,
  token: string,
  want: number,
  device = "",
  ms = 3000,
  session = "",
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const d = device ? `&device=${device}` : "";
    const s = session ? `&session=${encodeURIComponent(session)}` : "";
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}${d}${s}`);
    const got: any[] = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout, got ${got.length}/${want}`));
    }, ms);

    ws.on("message", (raw) => {
      got.push(JSON.parse(String(raw)));
      if (got.length >= want) {
        clearTimeout(timer);
        ws.close();
        resolve(got);
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const approval = {
  type: "approval_request",
  request_id: "call_1",
  action_display: 'Remove-Item -LiteralPath "data.csv"',
  facts: { kind: "execute", files: "data.csv" },
  raw_digest: "a".repeat(64),
  raw_ref: { key: "a".repeat(64), length: 120 },
  expires_at: Date.now() + 60_000,
} as any;

describe("HostServer", () => {
  it("连上先收到 hello，带项目名和任务原话", async () => {
    server = makeServer({ port: 0, token: "t1", pagePath: PAGE, approveAllDevices: true, projectName: "sandbox", task: "把 data.csv 删掉" });
    const { port } = await server.start();

    const [hello] = await listen(port, "t1", 1);
    expect(hello.type).toBe("hello");
    expect(hello.project).toBe("sandbox");
    expect(hello.task).toBe("把 data.csv 删掉");
  });

  it("晚连上的设备也能收到还没处理的审批（补发）", async () => {
    server = makeServer({ port: 0, token: "t2", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_t2", "补发");
    const { port } = await server.start();

    // 先广播——此时没有任何设备在线。
    // 先有一条普通消息，history 才会被发出来，用来验"审批不进历史"。
    server.broadcastChat("m1", "先看一眼");
    server.broadcast(approval);

    // 后连上的手机：hello → history → 待办审批以独立事件补发
    const msgs = await listen(port, "t2", 3);
    expect(msgs[0].type).toBe("hello");

    // 历史里不允许再出现审批请求：它们早就作废，重放会像「现在要你批」
    const historyMsg = msgs.find((m: any) => m.type === "history");
    const items = historyMsg?.items ?? [];
    expect(
      items.some((m: any) => m.type === "event" && m.event?.type === "approval_request"),
    ).toBe(false);

    // 真正还在等决定的那条，以独立事件补发
    const pendingEvent = msgs.find((m: any) => m.type === "event" && m.event?.request_id === "call_1");
    expect(pendingEvent).toBeTruthy();
  });

  it("口令不对直接断开", async () => {
    server = makeServer({ port: 0, token: "right", pagePath: PAGE, approveAllDevices: true });
    const { port } = await server.start();

    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong`);
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => resolve(-1));
    });
    expect(code).toBe(4001);
  });

  it("手机的决定会被转出去，并回一个 ack", async () => {
    server = makeServer({ port: 0, token: "t3", pagePath: PAGE, approveAllDevices: true });
    const { port } = await server.start();

    const seen: Decision[] = [];
    server.onDecision(({ decision }) => {
      seen.push(decision);
      return true;
    });
    server.broadcast(approval);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=t3`);
    await new Promise((r) => ws.on("open", r));

    const ack = new Promise<any>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === "ack") resolve(msg);
      });
    });
    ws.send(JSON.stringify({ type: "decision", requestId: "call_1", decision: "reject" }));

    const msg = await ack;
    expect(msg.accepted).toBe(true);
    expect(seen).toEqual(["reject"]);
    ws.close();
  });

  it("处理过的审批不再补发给后来的设备", async () => {
    server = makeServer({ port: 0, token: "t4", pagePath: PAGE, approveAllDevices: true });
    const { port } = await server.start();
    server.onDecision(() => true);

    server.broadcast(approval);

    // 第二台设备处理掉这条
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=t4`);
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "decision", requestId: "call_1", decision: "allow" }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();

    // 第三台设备连上，只该收到 hello
    const msgs = await listen(port, "t4", 1);
    expect(msgs.filter((m) => m.type === "event")).toHaveLength(0);
  });

  it("第一台设备自动通过，第二台要被批准才能看到历史", async () => {
    server = makeServer({ port: 0, token: "p1", pagePath: PAGE });
    const { port } = await server.start();

    // 第一台：直接连上，收到 hello
    const first = await listen(port, "p1", 1, "dev-a");
    expect(first[0].type).toBe("hello");

    // 第二台：只收到 device_pending，拿不到历史
    const second = await listen(port, "p1", 1, "dev-b");
    expect(second[0].type).toBe("device_pending");
  });

  it("拒绝接入会断开对方", async () => {
    server = makeServer({ port: 0, token: "p2", pagePath: PAGE });
    const { port } = await server.start();
    await listen(port, "p2", 1, "dev-a");

    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=p2&device=dev-b`);
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "device_pending") {
          // 模拟已有设备拒绝
          const owner = new WebSocket(`ws://127.0.0.1:${port}/ws?token=p2&device=dev-a`);
          owner.on("open", () => {
            owner.send(JSON.stringify({ type: "device_decision", deviceId: "dev-b", allow: false }));
          });
        }
      });
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => resolve(-1));
    });
    expect(code).toBe(4004);
  });
});

describe("host 静态托管 /app", () => {
  it("/app/ 回的是构建出的 index.html（no-store），不是测试台页面", async () => {
    const webDir = webFixture();
    server = makeServer({ port: 0, token: "s1", pagePath: PAGE, webDir, approveAllDevices: true });
    const { port } = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/app/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("SESSION-VIEW");
  });

  it("/app/assets/* 带内容哈希，给一年 immutable 缓存和正确的 content-type", async () => {
    const webDir = webFixture();
    server = makeServer({ port: 0, token: "s2", pagePath: PAGE, webDir, approveAllDevices: true });
    const { port } = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/app/assets/app-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toContain("session view");
  });

  it("无扩展名的 /app 路由回落到 index.html（/app 本身也算）", async () => {
    const webDir = webFixture();
    server = makeServer({ port: 0, token: "s3", pagePath: PAGE, webDir, approveAllDevices: true });
    const { port } = await server.start();

    for (const path of ["/app", "/app/", "/app/settings"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(await res.text(), path).toContain("SESSION-VIEW");
    }
  });

  it("带扩展名但文件不存在时是 404，不把 index.html 当救兵", async () => {
    const webDir = webFixture();
    server = makeServer({ port: 0, token: "s4", pagePath: PAGE, webDir, approveAllDevices: true });
    const { port } = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/app/nope.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).not.toContain("SESSION-VIEW");
  });

  it("非 assets 的静态文件给 no-cache，仍按扩展名发类型", async () => {
    const webDir = webFixture();
    server = makeServer({ port: 0, token: "s5", pagePath: PAGE, webDir, approveAllDevices: true });
    const { port } = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/app/favicon.ico`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    expect(res.headers.get("content-length")).toBe("4");
  });

  it("没有配置 webDir 时 /app/ 是 404，而不是 500 或崩溃", async () => {
    server = makeServer({ port: 0, token: "s6", pagePath: PAGE, approveAllDevices: true });
    const { port } = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/app/`);
    expect(res.status).toBe(404);
  });
});

describe("会话身份（session_id）", () => {
  it("会话里的消息带 session_id，hello 报当前会话", async () => {
    server = makeServer({ port: 0, token: "ss1", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_A", "会话 A");
    const { port } = await server.start();
    server.broadcast(approval);

    const msgs = await listen(port, "ss1", 2);
    const hello = msgs.find((m) => m.type === "hello");
    expect(hello.session_id).toBe("ses_A");

    const event = msgs.find((m) => m.type === "event");
    expect(event.session_id).toBe("ses_A");
    expect(event.event.request_id).toBe("call_1");
  });

  it("两条会话的 history 互不串", async () => {
    server = makeServer({ port: 0, token: "ss2", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_A", "A");
    const { port } = await server.start();
    server.broadcastTurn("running");

    server.useSession("ses_B", "B");
    server.broadcastTurn("idle");

    const a = await listen(port, "ss2", 2, "dev-a", 3000, "ses_A");
    const b = await listen(port, "ss2", 2, "dev-b", 3000, "ses_B");

    const aHistory = a.find((m) => m.type === "history");
    const bHistory = b.find((m) => m.type === "history");
    expect(aHistory.session_id).toBe("ses_A");
    expect(aHistory.items.map((m: any) => m.state)).toEqual(["running"]);
    expect(bHistory.session_id).toBe("ses_B");
    expect(bHistory.items.map((m: any) => m.state)).toEqual(["idle"]);
  });

  it("旧流水没有 session_id 时归到 legacy，仍可回放", async () => {
    const file = historyFile();
    writeFileSync(file, JSON.stringify({ type: "chat", role: "agent", messageId: "old", text: "旧消息" }) + "\n");

    server = makeServer({ port: 0, token: "ss3", pagePath: PAGE, approveAllDevices: true, historyFile: file });
    const { port } = await server.start();

    const body = (await (await fetch(`http://127.0.0.1:${port}/sessions`)).json()) as any;
    const legacy = body.sessions.find((s: any) => s.id === "legacy");
    expect(legacy).toBeTruthy();
    expect(legacy.title).toContain("迁移前");

    const msgs = await listen(port, "ss3", 2, "", 3000, "legacy");
    expect(msgs[0].session_id).toBe("legacy");
    const history = msgs.find((m) => m.type === "history");
    expect(history.items[0].text).toBe("旧消息");
  });

  it("/sessions 列出会话，并标出谁是 active", async () => {
    server = makeServer({ port: 0, token: "ss4", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_A", "A");
    const { port } = await server.start();
    server.useSession("ses_B", "B");

    const body = (await (await fetch(`http://127.0.0.1:${port}/sessions`)).json()) as any;
    expect(body.sessions).toHaveLength(2);
    const active = body.sessions.find((s: any) => s.active);
    expect(active.id).toBe("ses_B");
    expect(active.title).toBe("B");
  });

  it("待办审批只补给同一条会话", async () => {
    server = makeServer({ port: 0, token: "ss5", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_A", "A");
    const { port } = await server.start();
    server.broadcast(approval);
    server.useSession("ses_B", "B");

    const b = await listen(port, "ss5", 1, "dev-b", 3000, "ses_B");
    expect(b.filter((m) => m.type === "event")).toHaveLength(0);

    const a = await listen(port, "ss5", 2, "dev-a", 3000, "ses_A");
    expect(a.find((m) => m.type === "event")?.event.request_id).toBe("call_1");
  });

  it("未知会话 id 不静默切换，给解释并回到当前会话", async () => {
    server = makeServer({ port: 0, token: "ss6", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_A", "A");
    const { port } = await server.start();

    const msgs = await listen(port, "ss6", 2, "", 3000, "ses_nope");
    const hello = msgs.find((m) => m.type === "hello");
    expect(hello.session_id).toBe("ses_A");

    const notice = msgs.find((m) => m.type === "notice");
    expect(notice.level).toBe("deny");
    expect(notice.text).toContain("ses_nope");
  });
});
