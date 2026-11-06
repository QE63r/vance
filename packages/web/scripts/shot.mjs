/**
 * 给验收用的截图脚本（headless Edge + CDP），不参与产品运行。
 *
 *   node scripts/shot.mjs <输出目录>
 *
 * 它做四件事：
 *   1. 用 390×844 的手机视口打开页面，等连上
 *   2. 截图（三块区域）
 *   3. 让 mock host 断网 3.5 秒，截「已断开，重连中」
 *   4. 等它自己接上，再截一张，并把四条轴的状态写进 proof.json
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2] ?? join(process.cwd(), "shots");
const APP = process.env.APP_URL ?? "http://127.0.0.1:5173/#token=dev";
const HOST = process.env.HOST_URL ?? "http://127.0.0.1:8787";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9222;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, init) {
  const res = await fetch(url, init);
  return res.json();
}

async function waitForVersion() {
  for (let i = 0; i < 60; i++) {
    try {
      return await json(`http://127.0.0.1:${PORT}/json/version`);
    } catch {
      await wait(200);
    }
  }
  throw new Error("Edge 没起来（9222 连不上）");
}

async function waitForPage() {
  for (let i = 0; i < 60; i++) {
    const list = await json(`http://127.0.0.1:${PORT}/json/list`);
    const page = list.find((t) => t.type === "page");
    if (page?.webSocketDebuggerUrl) return page;
    await wait(200);
  }
  throw new Error("没找到页面 target");
}

const profile = mkdtempSync(join(tmpdir(), "vance-shot-"));
const edge = spawn(
  EDGE,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "--remote-allow-origins=*",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
const pending = new Map();
let msgId = 0;

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const { result } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result?.value;
}

async function waitForText(text, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const body = await evaluate("document.body.innerText");
    if (typeof body === "string" && body.includes(text)) return true;
    await wait(200);
  }
  throw new Error(`等不到「${text}」`);
}

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = join(OUT, name);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log("  截图：" + file);
}

const AXES = `(() => {
  const s = window.__vance && window.__vance();
  if (!s) return null;
  return {
    link: s.link.phase,
    attempts: s.link.attempts,
    device: s.device.phase,
    exec: s.exec.phase,
    approvals: Object.values(s.approvals).map((a) => ({ phase: a.phase })),
    timeline: s.timeline.length,
    header: (document.querySelector(".hdr")?.innerText ?? "").replace(/\\n/g, " | "),
    hint: document.querySelector(".hint")?.innerText ?? "",
  };
})()`;

async function axes() {
  return evaluate(AXES);
}

try {
  await waitForVersion();
  const page = await waitForPage();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  };

  mkdirSync(OUT, { recursive: true });

  // 每次从干净状态开始（历史 + 待办 + 脚本进度）
  await json(`${HOST}/__ctl/reset`);

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });

  await send("Page.navigate", { url: APP });
  await waitForText("已连接", 25_000);

  // 等脚本走到「审批卡出现」，这样一张图里能同时看到四轴
  for (let i = 0; i < 100; i++) {
    const has = await evaluate("!!document.querySelector('.card.approval')");
    if (has) break;
    await wait(200);
  }
  await wait(900);
  const before = await axes();
  await shot("01-connected.png");

  // 断网
  await json(`${HOST}/__ctl/down?ms=3500`);
  await waitForText("已断开，重连中", 10_000);
  await wait(500);
  const during = await axes();
  await shot("02-offline.png");

  // 自动恢复
  await waitForText("已连接", 25_000);
  await wait(1200);
  const after = await axes();
  await shot("03-recovered.png");

  // 点一次批准：验审批轴与执行轴、产出联动，连接轴不动
  const clicked = await evaluate(
    `(() => { const b = document.querySelector(".card.approval .btn.allow"); if (b) { b.click(); return true; } return false; })()`,
  );
  if (clicked) {
    for (let i = 0; i < 40; i++) {
      const a = await axes();
      if (a && a.approvals[0] && a.approvals[0].phase === "resolved") break;
      await wait(200);
    }
    await wait(1000);
  }
  const decided = await axes();
  await shot("04-approved.png");

  const proof = { at: new Date().toISOString(), before, during, after, decided };
  writeFileSync(join(OUT, "proof.json"), JSON.stringify(proof, null, 2));
  console.log("\n" + JSON.stringify(proof, null, 2));
} catch (err) {
  console.error("[shot] 失败：" + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  edge.kill();
  await wait(400);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Edge 还占着文件就算了 */
  }
}
