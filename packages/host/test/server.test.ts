import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { HostServer, type Decision } from "../src/index.js";

const PAGE = fileURLToPath(new URL("../public/index.html", import.meta.url));

let server: HostServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

/** 连上并把收到的消息收进数组，直到满足条件或超时 */
function listen(port: number, token: string, want: number, ms = 3000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
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
    server = new HostServer({ port: 0, token: "t1", pagePath: PAGE, projectName: "sandbox", task: "把 data.csv 删掉" });
    const { port } = await server.start();

    const [hello] = await listen(port, "t1", 1);
    expect(hello.type).toBe("hello");
    expect(hello.project).toBe("sandbox");
    expect(hello.task).toBe("把 data.csv 删掉");
  });

  it("晚连上的设备也能收到还没处理的审批（补发）", async () => {
    server = new HostServer({ port: 0, token: "t2", pagePath: PAGE });
    const { port } = await server.start();

    // 先广播——此时没有任何设备在线
    server.broadcast(approval);

    // 后连上的手机：hello → （可能有 history）→ 待办审批以独立事件补发
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
    server = new HostServer({ port: 0, token: "right", pagePath: PAGE });
    const { port } = await server.start();

    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong`);
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => resolve(-1));
    });
    expect(code).toBe(4001);
  });

  it("手机的决定会被转出去，并回一个 ack", async () => {
    server = new HostServer({ port: 0, token: "t3", pagePath: PAGE });
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
    server = new HostServer({ port: 0, token: "t4", pagePath: PAGE });
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
});
