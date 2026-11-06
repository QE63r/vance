// 验证：连上之后能收到屏幕帧，而且服务不会被帧弄死。
// 用 Node 自带的 WebSocket（Node 22+），不依赖 ws 包。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const token = process.argv[2] || readFileSync(join(homedir(), ".vance", "token"), "utf8").trim();
const url = process.argv[3] || `ws://127.0.0.1:8787/ws?token=${token}`;

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";

let frames = 0;
let bytes = 0;

ws.onmessage = (e) => {
  if (typeof e.data === "string") return;
  if (frames === 0) console.log(`第一帧: ${e.data.byteLength} 字节`);
  frames += 1;
  bytes += e.data.byteLength;
};

ws.onerror = () => {
  console.log("连接错误");
  process.exit(1);
};

setTimeout(() => {
  console.log(`6 秒内 ${frames} 帧，共 ${Math.round(bytes / 1024)} KB`);
  ws.close();
  process.exit(0);
}, 6000);
