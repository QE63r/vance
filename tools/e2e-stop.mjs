// 验证"停止"有牙齿：发一个长任务 → 按停止 → 3 秒后应强制终止。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const port = process.argv[2] || "8788";
const token = readFileSync(join(homedir(), ".vance", "token"), "utf8").trim();
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}&device=stoptest`);

const seen = [];
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

ws.onopen = () => {
  // 一个会跑很久的任务
  ws.send(JSON.stringify({ type: "prompt", text: "运行 Start-Sleep -Seconds 60，不要做别的" }));
};

let sentStop = false;

ws.onmessage = (e) => {
  if (typeof e.data !== "string") return;
  const m = JSON.parse(e.data);

  if (m.type === "event" && m.event?.type === "approval_request") {
    ws.send(JSON.stringify({ type: "decision", requestId: m.event.request_id, decision: "allow" }));
    log("已自动批准命令");
    // 命令跑起来之后按停止
    setTimeout(() => {
      if (!sentStop) {
        sentStop = true;
        log("按下停止");
        ws.send(JSON.stringify({ type: "stop" }));
      }
    }, 3000);
  }
  if (m.type === "notice") log("提示: " + m.text);
  if (m.type === "turn") log("轮次: " + m.state);
};

setTimeout(() => {
  log("结束");
  process.exit(0);
}, 20000);
