// 端到端：连上服务，让它列桌面文件，看中文还乱不乱。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const token = readFileSync(join(homedir(), ".vance", "token"), "utf8").trim();
const port = process.argv[2] || "8787";
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);

let text = "";
let done = false;

ws.onopen = () => {
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "prompt", text: process.argv[3] || "列出桌面上的文件，只回答文件名" }));
  }, 800);
};

ws.onmessage = (e) => {
  if (typeof e.data !== "string") return;
  const m = JSON.parse(e.data);
  if (m.type === "event" && m.event?.type === "approval_request") {
    ws.send(JSON.stringify({ type: "decision", requestId: m.event.request_id, decision: "allow" }));
  }
  if (m.type === "chat") text += m.text;
  if (m.type === "turn" && m.state !== "running") done = true;
};

const finish = () => {
  console.log("=== Agent 的回答 ===");
  console.log(text.trim().slice(0, 800) || "(空)");
  const bad = /[锟斤拷]|ï¿½|�/.test(text);
  console.log("=== 判定 ===");
  console.log(bad ? "❌ 仍有乱码" : "✅ 没有乱码");
  process.exit(0);
};

const timer = setInterval(() => {
  if (done) { clearInterval(timer); setTimeout(finish, 500); }
}, 500);

setTimeout(() => { clearInterval(timer); finish(); }, 240000);
