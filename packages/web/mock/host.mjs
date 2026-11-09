/**
 * 只给开发用的假 host。
 *
 * 它复刻 packages/host 的线上协议（hello / history / event / chat / turn / notice /
 * ack / decision / artifacts / device_* / 二进制帧），好让前端在没有 opencode、没有
 * ACP 的情况下也能跑起来、能验断线重连。
 *
 * 真前端不依赖这个文件。生产要走 packages/host + tools/host-demo.mjs。
 *
 * 额外的只有两个 dev 控制口（不在协议里）：
 *   GET /__ctl/down?ms=3500   模拟断网：踢掉所有连接，期间拒绝新连接
 *   GET /health
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const SESSION = "mock-session";
const FRAME = readFileSync(new URL("./frame.png", import.meta.url));
const history = [];
const pending = new Map();
const clients = new Set();

let started = false;
let down = false;
let seq = 0;

const hex = (n) =>
  Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

function envelope() {
  seq += 1;
  return {
    request_id: `mock-${seq}`,
    agent_id: "mock-agent",
    project_id: "sandbox",
    timestamp: Date.now(),
    raw_digest: hex(64),
    raw_ref: { key: hex(64), length: 128 },
    nonce: hex(32),
    expires_at: Date.now() + 180_000,
    policy_version: "mock-1",
    signer: "host",
    signature: hex(64),
  };
}

function emit(msg) {
  const tagged = { ...msg, session_id: SESSION };
  history.push(tagged);
  if (history.length > 400) history.splice(0, history.length - 400);
  const data = JSON.stringify(tagged);
  for (const c of clients) if (c.readyState === 1) c.send(data);
}

const notice = (level, text) => emit({ type: "notice", level, text });
const turn = (state) => emit({ type: "turn", state });

function step(id, title, kind, status) {
  return { id, title, kind, status };
}

function statusEvent(s) {
  return {
    type: "event",
    event: { ...envelope(), type: "status_update", state: "running", step: s },
  };
}

function chatStream(messageId, full, gap = 90) {
  const chunks = [];
  let i = 0;
  while (i < full.length) {
    const n = 2 + Math.floor(Math.random() * 4);
    chunks.push(full.slice(i, i + n));
    i += n;
  }
  chunks.forEach((chunk, idx) => {
    setTimeout(() => emit({ type: "chat", role: "agent", messageId, text: chunk }), idx * gap);
  });
}

function approval() {
  const event = {
    ...envelope(),
    type: "approval_request",
    request_id: `req-${Date.now()}`,
    agent_id: "mock-agent",
    project_id: "sandbox",
    action_display: 'write_file  "C:\\Users\\1\\Desktop\\report.pdf"',
    facts: { kind: "edit", files: 1, locations: 1, adds: 12, removes: 3 },
    preview: [
      "--- a/report.pdf",
      "+++ b/report.pdf",
      "@@ 4 pages @@",
      "- report.pdf  (0 字节)",
      "+ report.pdf  (128.4 KB, 4 页)",
      "+ report_p1.png",
      "- report_p2.png",
    ].join("\n"),
  };
  pending.set(event.request_id, event);
  emit({ type: "event", event });
  console.log(`[mock] 审批已推送：${event.action_display}`);
}

/** 先放一轮「已经做完的活」进历史：这样首屏就有时间线、结算条和产出可点 */
function seed() {
  emit({ type: "user", text: "把桌面的报告转成 PDF，再核一下目录。" });
  emit({ type: "notice", level: "auto", text: "已自动放行（免问）：读取项目目录" });
  emit({ type: "turn", state: "running" });
  emit(statusEvent(step("h1", "核对目录页码", "read", "done")));
  emit({ type: "chat", role: "agent", messageId: "seed-1", text: "上一次转换已经完成，这次接着改目录。" });
  emitArtifacts(
    "turn-0",
    ["C:\\Users\\1\\Desktop\\report_old.pdf"],
    ["C:\\Users\\1\\Desktop\\report.docx"],
    ["C:\\Users\\1\\Desktop\\tmp.png"],
    ["report_old.pdf 的目录页码没有校验"],
  );
  emit({ type: "turn", state: "idle" });
}

function startScenario() {
  if (started) return;
  started = true;
  setTimeout(() => turn("running"), 600);
  setTimeout(() => emit(statusEvent(step("s1", "report.docx（4 页）", "read", "running"))), 800);
  setTimeout(() => emit(statusEvent(step("s1", "report.docx（4 页）", "read", "done"))), 1300);
  setTimeout(() => chatStream("m1", "先看一下页数，再转 PDF。"), 1500);
  setTimeout(() => emit(statusEvent(step("s2", "soffice --headless --convert-to pdf", "execute", "running"))), 1900);
  setTimeout(() => approval(), 2600);
}

function onPrompt(text) {
  emit({ type: "user", text });
  turn("running");
  chatStream(`m-${Date.now()}`, "好，我来处理。");
  setTimeout(() => emit(statusEvent(step("p1", "扫描桌面上的文件", "read", "running"))), 500);
  setTimeout(() => emit(statusEvent(step("p1", "扫描桌面上的文件", "read", "done"))), 1200);
  setTimeout(() => emit(statusEvent(step("p2", "整理输出（mock）", "execute", "running"))), 1500);
  setTimeout(() => emit(statusEvent(step("p2", "整理输出（mock）", "execute", "done"))), 2600);
  setTimeout(() => {
    emitArtifacts("turn-" + Date.now(), ["桌面/mock-output.txt"], [], [], []);
    turn("idle");
  }, 2900);
}

function emitArtifacts(turnId, added, changed, removed, warnings) {
  emit({ type: "artifacts", artifacts: { turnId, added, changed, removed, warnings } });
}

function decide(socket, msg) {
  const event = pending.get(msg.requestId);
  if (!event) {
    socket.send(JSON.stringify({ type: "ack", requestId: msg.requestId, accepted: false, session_id: SESSION }));
    return;
  }
  pending.delete(msg.requestId);
  const decision = msg.decision === "remember" ? "remember" : msg.decision === "allow" ? "allow" : "reject";
  socket.send(JSON.stringify({ type: "ack", requestId: msg.requestId, accepted: true, session_id: SESSION }));
  emit({ type: "decision", requestId: msg.requestId, decision, by: "mock-phone", at: Date.now() });

  if (decision === "reject") {
    notice("deny", "已拒绝：覆盖写入 report.pdf（mock-phone）");
    emit(statusEvent(step("s2", "soffice --headless --convert-to pdf", "execute", "failed")));
    turn("idle");
    return;
  }
  notice("auto", "已批准：覆盖写入 report.pdf（mock-phone）");
  emit(statusEvent(step("s2", "soffice --headless --convert-to pdf", "execute", "done")));
  emit(statusEvent(step("s3", "校验 PDF 首字节 %PDF-", "read", "done")));
  emitArtifacts(
    "turn-1",
    ["C:\\Users\\1\\Desktop\\report.pdf", "C:\\Users\\1\\Desktop\\report_p1.png"],
    ["C:\\Users\\1\\Desktop\\report.docx"],
    [],
    ["report.pdf 的目录链接没有校验"],
  );
  notice("auto", "本轮没有产生文件变化以外的异常");
  chatStream("m2", "转换完成：report.pdf（4 页，128.4 KB）。");
  turn("idle");
}

function attach(socket) {
  clients.add(socket);
  console.log(`[mock] 设备接入（共 ${clients.size} 台）`);
  socket.send(
    JSON.stringify({ type: "hello", project: "sandbox", task: "", device: "mock-phone", session_id: SESSION }),
  );
  const past = history.filter((m) => !(m.type === "event" && m.event?.type === "approval_request"));
  if (past.length > 0) socket.send(JSON.stringify({ type: "history", session_id: SESSION, items: past }));
  for (const event of pending.values()) socket.send(JSON.stringify({ type: "event", event, session_id: SESSION }));

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "prompt" && typeof msg.text === "string" && msg.text.trim()) return onPrompt(msg.text.trim());
    if (msg.type === "stop") {
      notice("deny", "已停止（mock）；下一句会开新会话");
      turn("stopped");
      return;
    }
    if (msg.type === "decision") return decide(socket, msg);
    if (msg.type === "resync") {
      const items = history.filter((m) => !(m.type === "event" && m.event?.type === "approval_request"));
      if (items.length) socket.send(JSON.stringify({ type: "history", session_id: SESSION, items }));
      for (const event of pending.values()) socket.send(JSON.stringify({ type: "event", event, session_id: SESSION }));
      return;
    }
    if (msg.type === "device_decision") {
      notice("auto", msg.allow ? "已允许新设备接入（mock）" : "已拒绝新设备接入（mock）");
      return;
    }
  });
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));

  startScenario();
}

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: clients.size, down }));
    return;
  }
  if (url.pathname === "/__ctl/down") {
    const ms = Math.min(Number(url.searchParams.get("ms") ?? 3500) || 3500, 30_000);
    goDown(ms);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, down: true, ms }));
    return;
  }
  if (url.pathname === "/__ctl/reset") {
    // 给截图脚本用：每次跑之前回到「刚连上、审批还没来」的样子
    history.length = 0;
    pending.clear();
    started = false;
    seed();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, items: history.length }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: http, path: "/ws" });

wss.on("connection", (socket) => {
  if (down) {
    socket.close(1013, "down");
    return;
  }
  attach(socket);
});

function goDown(ms) {
  if (down) return;
  down = true;
  console.log(`[mock] 断网 ${ms}ms`);
  for (const c of clients) {
    try {
      c.terminate();
    } catch {
      /* 已经没了 */
    }
  }
  clients.clear();
  setTimeout(() => {
    down = false;
    console.log("[mock] 网络恢复");
  }, ms);
}

// 帧：只有有人在看才发；静止桌面也照发（mock 不做去重）
setInterval(() => {
  if (down || clients.size === 0) return;
  for (const c of clients) if (c.readyState === 1) c.send(FRAME, { binary: true });
}, 1000);

http.listen(PORT, "127.0.0.1", () => {
  seed();
  console.log(`[mock] host 已就绪  http://127.0.0.1:${PORT}  （/ws 是协议口，/__ctl/down 是断网开关）`);
});
