import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

/** 设备批准文件也放临时目录：测试不碰用户真实的 ~/.vance/devices.json */
function deviceStore(): string {
  const dir = mkdtempSync(join(tmpdir(), "vance-devices-"));
  tempDirs.push(dir);
  return join(dir, "devices.json");
}

function makeServer(options: Omit<HostOptions, "historyFile"> & { historyFile?: string }): HostServer {
  const history = options.historyFile ?? historyFile();
  return new HostServer({
    ...options,
    historyFile: history,
    profileFile: join(dirname(history), "profile.json"),
  });
}

/** 等一条满足条件的消息（不关连接，用来测中途切换） */
function waitForMessage(ws: WebSocket, predicate: (m: any) => boolean, ms = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("timeout waiting message"));
    }, ms);
    const onMessage = (raw: unknown) => {
      let m: any;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!predicate(m)) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(m);
    };
    ws.on("message", onMessage);
  });
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

  it("已批准设备会写盘，重启后同一台免审批接回", async () => {
    const store = deviceStore();
    server = makeServer({ port: 0, token: "d1", pagePath: PAGE, deviceStorePath: store });
    const { port } = await server.start();

    const first = await listen(port, "d1", 1, "phone-a");
    expect(first[0].type).toBe("hello");
    const saved = JSON.parse(readFileSync(store, "utf8"));
    expect(saved).toEqual([{ id: "phone-a", name: expect.any(String), approved: true }]);

    await server.close();
    server = null;

    // 重启：新进程没有内存里的设备，只靠 devices.json
    server = makeServer({ port: 0, token: "d1", pagePath: PAGE, deviceStorePath: store });
    const { port: port2 } = await server.start();
    const again = await listen(port2, "d1", 1, "phone-a");
    expect(again[0].type).toBe("hello");
    expect(again[0].device).toBe(first[0].device);
  });

  it("重启后新设备仍然要已有设备点头", async () => {
    const store = deviceStore();
    server = makeServer({ port: 0, token: "d2", pagePath: PAGE, deviceStorePath: store });
    const { port } = await server.start();
    await listen(port, "d2", 1, "phone-a");
    await server.close();
    server = null;

    server = makeServer({ port: 0, token: "d2", pagePath: PAGE, deviceStorePath: store });
    const { port: port2 } = await server.start();
    const other = await listen(port2, "d2", 1, "phone-b");
    expect(other[0].type).toBe("device_pending");
  });

  it("同一台设备断开重连会重新收到 hello", async () => {
    server = makeServer({ port: 0, token: "d3", pagePath: PAGE, approveAllDevices: true });
    const { port } = await server.start();

    const first = await listen(port, "d3", 1, "phone-r");
    expect(first[0].type).toBe("hello");
    await new Promise((r) => setTimeout(r, 80));

    // 旧实现不把 attached 复位，第二次连接什么都收不到
    const again = await listen(port, "d3", 1, "phone-r");
    expect(again[0].type).toBe("hello");
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

describe("审计与产出", () => {
  it("hello 带 server_time，且和本机时钟对得上", async () => {
    server = makeServer({ port: 0, token: "a1", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_t", "T");
    const { port } = await server.start();

    const [hello] = await listen(port, "a1", 1);
    expect(typeof hello.server_time).toBe("number");
    expect(Math.abs(Date.now() - hello.server_time)).toBeLessThan(5000);
  });

  it("决定广播给所有设备，并作为审计写进流水", async () => {
    server = makeServer({ port: 0, token: "a2", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_d", "D");
    const { port } = await server.start();
    server.onDecision(() => true);
    server.broadcast(approval as any);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=a2&device=dev-a`);
    await new Promise((r) => ws.on("open", r));

    const decisionMsg = new Promise<any>((resolve) => {
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "decision") resolve(m);
      });
    });
    ws.send(JSON.stringify({ type: "decision", requestId: "call_1", decision: "allow" }));

    const decision = await decisionMsg;
    expect(decision.requestId).toBe("call_1");
    expect(decision.decision).toBe("allow");
    expect(decision.session_id).toBe("ses_d");
    expect(typeof decision.by).toBe("string");
    expect(decision.by.length).toBeGreaterThan(0);
    ws.close();

    // 晚连的设备能从流水里看到这条决定（审计，不靠 notice 文案）
    const late = await listen(port, "a2", 2, "dev-b", 3000, "ses_d");
    const history = late.find((m) => m.type === "history");
    expect(history.items.some((m: any) => m.type === "decision" && m.requestId === "call_1")).toBe(true);
  });

  it("产出发结构化消息，带会话归属并落流水", async () => {
    server = makeServer({ port: 0, token: "a3", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_a", "A");
    const { port } = await server.start();

    const payload = {
      turnId: "turn-1",
      added: ["a.txt"],
      changed: ["b.txt"],
      removed: ["c.txt"],
      warnings: ["w"],
    };
    server.broadcastArtifacts(payload);

    const msgs = await listen(port, "a3", 2, "", 3000, "ses_a");
    const history = msgs.find((m) => m.type === "history");
    expect(history.session_id).toBe("ses_a");
    const item = history.items.find((m: any) => m.type === "artifacts");
    expect(item.artifacts).toEqual(payload);
  });

  it("/rules 能列出规则并撤销，未知 key 404", async () => {
    const rules = ["remove-item|desktop", "new-item|desktop"];
    server = makeServer({ port: 0, token: "a4", pagePath: PAGE, approveAllDevices: true });
    server.onRules({
      list: () => [...rules],
      revoke: (key) => {
        const i = rules.indexOf(key);
        if (i < 0) return false;
        rules.splice(i, 1);
        return true;
      },
    });
    const { port } = await server.start();

    const before = (await (await fetch(`http://127.0.0.1:${port}/rules`)).json()) as any;
    expect(before.rules).toEqual(["remove-item|desktop", "new-item|desktop"]);

    const missing = await fetch(`http://127.0.0.1:${port}/rules/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "nope" }),
    });
    expect(missing.status).toBe(404);

    const ok = await fetch(`http://127.0.0.1:${port}/rules/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "remove-item|desktop" }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).ok).toBe(true);

    const after = (await (await fetch(`http://127.0.0.1:${port}/rules`)).json()) as any;
    expect(after.rules).toEqual(["new-item|desktop"]);
  });
});

describe("切会话（session/attach）", () => {  it("切到 legacy 只回它的流水，切回来只回当前会话的", async () => {
    const file = historyFile();
    writeFileSync(file, JSON.stringify({ type: "chat", role: "agent", messageId: "old", text: "旧消息" }) + "\n");

    server = makeServer({ port: 0, token: "at1", pagePath: PAGE, approveAllDevices: true, historyFile: file });
    server.useSession("ses_live", "live");
    const { port } = await server.start();
    server.broadcastChat("m1", "新消息");

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=at1&device=dev-at`);
    await new Promise((r) => ws.on("open", r));

    const legacy = waitForMessage(ws, (m) => m.type === "history" && m.session_id === "legacy");
    ws.send(JSON.stringify({ type: "session/attach", sessionId: "legacy" }));
    const oldHistory = await legacy;
    expect(oldHistory.items[0].text).toBe("旧消息");

    const live = waitForMessage(ws, (m) => m.type === "history" && m.session_id === "ses_live");
    ws.send(JSON.stringify({ type: "session/attach", sessionId: "ses_live" }));
    const newHistory = await live;
    expect(newHistory.items[0].text).toBe("新消息");
    ws.close();
  });

  it("切到不存在的会话只给 notice，不静默切换", async () => {
    server = makeServer({ port: 0, token: "at2", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_live", "live");
    const { port } = await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=at2&device=dev-at`);
    await new Promise((r) => ws.on("open", r));

    const sessions: any[] = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "session") sessions.push(m);
    });
    const notice = waitForMessage(ws, (m) => m.type === "notice");
    ws.send(JSON.stringify({ type: "session/attach", sessionId: "nope" }));
    const n = await notice;
    expect(n.text).toContain("nope");
    expect(sessions).toHaveLength(0);
    ws.close();
  });
});

describe("流式片段不切碎历史", () => {
  it("同一 messageId 的片段在回放里合并成一条", async () => {
    server = makeServer({ port: 0, token: "mg1", pagePath: PAGE, approveAllDevices: true });
    server.useSession("ses_m", "M");
    const { port } = await server.start();

    server.broadcastChat("m1", "你");
    server.broadcastChat("m1", "好");
    server.broadcastChat("m2", "再见");

    const msgs = await listen(port, "mg1", 2, "", 3000, "ses_m");
    const history = msgs.find((m) => m.type === "history");
    const chats = history.items.filter((i: any) => i.type === "chat");
    expect(chats.map((c: any) => c.text)).toEqual(["你好", "再见"]);
  });

  it("落盘的片段在重启后也会合并", async () => {
    const file = historyFile();
    writeFileSync(
      file,
      [
        JSON.stringify({ session_id: "ses_f", msg: { type: "chat", role: "agent", messageId: "m1", text: "你" } }),
        JSON.stringify({ session_id: "ses_f", msg: { type: "chat", role: "agent", messageId: "m1", text: "好" } }),
        JSON.stringify({ session_id: "ses_f", msg: { type: "chat", role: "agent", messageId: "m2", text: "再见" } }),
      ].join("\n") + "\n",
    );

    server = makeServer({ port: 0, token: "mg2", pagePath: PAGE, approveAllDevices: true, historyFile: file });
    const { port } = await server.start();

    const msgs = await listen(port, "mg2", 2, "", 3000, "ses_f");
    const history = msgs.find((m) => m.type === "history");
    const chats = history.items.filter((i: any) => i.type === "chat");
    expect(chats.map((c: any) => c.text)).toEqual(["你好", "再见"]);
  });
});

describe("权限档位（host）", () => {
  it("/profile 需要 token，默认 workspace", async () => {
    server = makeServer({ port: 0, token: "pf1", pagePath: PAGE, approveAllDevices: true });
    const { port } = await server.start();

    const denied = await fetch(`http://127.0.0.1:${port}/profile`);
    expect(denied.status).toBe(401);

    const ok = await fetch(`http://127.0.0.1:${port}/profile`, {
      headers: { "x-vance-token": "pf1" },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).profile).toBe("workspace");
  });

  it("切换档位后 hello 带新档位", async () => {
    server = makeServer({ port: 0, token: "pf2", pagePath: PAGE, approveAllDevices: true });
    const { port } = await server.start();

    const res = await fetch(`http://127.0.0.1:${port}/profile`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vance-token": "pf2" },
      body: JSON.stringify({ profile: "full" }),
    });
    expect(res.status).toBe(200);

    const [hello] = await listen(port, "pf2", 1);
    expect(hello.profile).toBe("full");
  });
});

describe("任务生命周期（session/new 与 session/switch）", () => {
  it("手机能新建任务，也能真正切回旧任务", async () => {
    const s = makeServer({ port: 0, token: "life1", pagePath: PAGE, approveAllDevices: true });
    server = s;
    let switched = "";
    s.onSessionNew(async () => "ses_new");
    s.onSessionSwitch(async (id) => {
      switched = id;
    });
    s.useSession("ses_old", "旧任务");
    const { port } = await s.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=life1&device=life-test`);
    await waitForMessage(ws, (m) => m.type === "hello");

    const made = waitForMessage(ws, (m) => m.type === "session" && m.session_id === "ses_new");
    ws.send(JSON.stringify({ type: "session/new" }));
    const newEvent = await made;
    expect(newEvent.active).toBe(true);

    const back = waitForMessage(ws, (m) => m.type === "session" && m.session_id === "ses_old");
    ws.send(JSON.stringify({ type: "session/switch", sessionId: "ses_old" }));
    const oldEvent = await back;
    expect(oldEvent.active).toBe(true);
    expect(switched).toBe("ses_old");
    ws.close();
  });
});

describe("交付物仓库（索引 / 状态 / 历史取件）", () => {
  const setup = async () => {
    const dir = mkdtempSync(join(tmpdir(), "vance-repo-"));
    tempDirs.push(dir);
    const file = join(dir, "方案.docx");
    writeFileSync(file, "repo artifact");
    const store = join(dir, "artifacts.json");
    const hist = historyFile();
    const s = makeServer({
      port: 0,
      token: "repo1",
      pagePath: PAGE,
      approveAllDevices: true,
      historyFile: hist,
      artifactStoreFile: store,
    });
    server = s;
    s.useSession("ses_repo", "仓库");
    const { port } = await s.start();
    s.broadcastArtifacts({ turnId: "t1", added: [file], changed: [], removed: [], warnings: [] });
    return { s, port, file, store, hist };
  };

  it("GET /artifacts 列出待验收记录和 sha256", async () => {
    const { port, file } = await setup();
    const res = await fetch(`http://127.0.0.1:${port}/artifacts?session_id=ses_repo`, {
      headers: { "x-vance-token": "repo1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.artifacts).toHaveLength(1);
    expect(body.artifacts[0]).toMatchObject({
      path: file,
      session_id: "ses_repo",
      status: "pending",
      exists: true,
      changed: false,
    });
    expect(body.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("验收后状态变成 accepted，并落盘到重启后", async () => {
    const { s, port, file, store } = await setup();
    const ticket = (await (
      await fetch(`http://127.0.0.1:${port}/artifacts/ticket`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": "repo1" },
        body: JSON.stringify({ path: file, session_id: "ses_repo" }),
      })
    ).json()) as any;
    const accepted = await fetch(`http://127.0.0.1:${port}/artifacts/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vance-token": "repo1" },
      body: JSON.stringify({ ticket: ticket.ticket, decision: "accept" }),
    });
    expect(accepted.status).toBe(200);

    await s.close();
    server = null;
    const s2 = makeServer({
      port: 0,
      token: "repo1",
      pagePath: PAGE,
      approveAllDevices: true,
      artifactStoreFile: store,
    });
    server = s2;
    const { port: port2 } = await s2.start();
    const res = await fetch(`http://127.0.0.1:${port2}/artifacts?session_id=ses_repo`, {
      headers: { "x-vance-token": "repo1" },
    });
    const body = (await res.json()) as any;
    expect(body.artifacts[0].status).toBe("accepted");
    expect(body.artifacts[0].decided_at).toBeTypeOf("number");
  });

  it("最新一轮换了文件，旧文件仍能凭历史记录取件", async () => {
    const { s, port, file } = await setup();
    const other = join(dirname(file), "b.txt");
    writeFileSync(other, "second turn");
    s.broadcastArtifacts({ turnId: "t2", added: [other], changed: [], removed: [], warnings: [] });

    const ticket = await fetch(`http://127.0.0.1:${port}/artifacts/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vance-token": "repo1" },
      body: JSON.stringify({ path: file, session_id: "ses_repo" }),
    });
    expect(ticket.status).toBe(200);
    const body = (await ticket.json()) as any;
    expect(body.path).toBe(file);
  });
});

describe("交付物检阅（ticket / accept）", () => {
  const setup = async (ttl = 60_000) => {
    const dir = mkdtempSync(join(tmpdir(), "vance-art-"));
    tempDirs.push(dir);
    const file = join(dir, "交付说明.txt");
    writeFileSync(file, "hello artifact");
    const other = join(dir, "b.txt");
    writeFileSync(other, "not in the list");

    const hist = historyFile();
    const s = makeServer({ port: 0, token: "art1", pagePath: PAGE, approveAllDevices: true, historyFile: hist, artifactTicketTtlMs: ttl });
    s.useSession("ses_art", "产出");
    const { port } = await s.start();
    s.broadcastArtifacts({ turnId: "t1", added: [file], changed: [], removed: [], warnings: [] });
    return { s, port, file, other, hist };
  };

  it("签发取件单要 token", async () => {
    const { port, file } = await setup();
    const res = await fetch(`http://127.0.0.1:${port}/artifacts/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: file }),
    });
    expect(res.status).toBe(401);
  });

  it("只允许产出清单里的路径", async () => {
    const { port, other } = await setup();
    const res = await fetch(`http://127.0.0.1:${port}/artifacts/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vance-token": "art1" },
      body: JSON.stringify({ path: other }),
    });
    expect(res.status).toBe(404);
  });

  it("票据能取到原件，且不需要主 token", async () => {
    const { port, file } = await setup();
    const body = (await (
      await fetch(`http://127.0.0.1:${port}/artifacts/ticket`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": "art1" },
        body: JSON.stringify({ path: file }),
      })
    ).json()) as any;
    expect(body.sha256).toMatch(/^[a-f0-9]{64}$/);

    const got = await fetch(`http://127.0.0.1:${port}/artifacts/${body.ticket}`);
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("hello artifact");
  });

  it("票据过期后 410", async () => {
    const { port, file } = await setup(5);
    const body = (await (
      await fetch(`http://127.0.0.1:${port}/artifacts/ticket`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": "art1" },
        body: JSON.stringify({ path: file }),
      })
    ).json()) as any;
    await new Promise((r) => setTimeout(r, 30));
    const got = await fetch(`http://127.0.0.1:${port}/artifacts/${body.ticket}`);
    expect(got.status).toBe(410);
  });

  it("文件变了，验收 409", async () => {
    const { port, file } = await setup();
    const body = (await (
      await fetch(`http://127.0.0.1:${port}/artifacts/ticket`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": "art1" },
        body: JSON.stringify({ path: file }),
      })
    ).json()) as any;
    writeFileSync(file, "changed after review");

    const res = await fetch(`http://127.0.0.1:${port}/artifacts/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vance-token": "art1" },
      body: JSON.stringify({ ticket: body.ticket, decision: "accept" }),
    });
    expect(res.status).toBe(409);
  });

  it("验收成功写 artifact_decision，含 sha256", async () => {
    const { port, file, hist } = await setup();
    const body = (await (
      await fetch(`http://127.0.0.1:${port}/artifacts/ticket`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": "art1" },
        body: JSON.stringify({ path: file }),
      })
    ).json()) as any;

    const res = await fetch(`http://127.0.0.1:${port}/artifacts/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vance-token": "art1" },
      body: JSON.stringify({ ticket: body.ticket, decision: "accept" }),
    });
    expect(res.status).toBe(200);

    const line = readFileSync(hist, "utf8").trim().split("\n").pop() ?? "";
    const entry = JSON.parse(line);
    expect(entry.msg.type).toBe("artifact_decision");
    expect(entry.msg.sha256).toBe(body.sha256);
    expect(entry.msg.decision).toBe("accept");
  });
});
