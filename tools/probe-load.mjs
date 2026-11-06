// 直接问 opencode：session/load 这个能力你到底有没有？
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const child = spawn("opencode", ["acp"], { shell: true, stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const replies = [];
child.stdout.on("data", (d) => {
  buf += d.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const l of lines) {
    if (!l.trim()) continue;
    try { replies.push(JSON.parse(l)); } catch {}
  }
});
child.stderr.on("data", () => {});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
await wait(2500);

let saved = "";
try {
  saved = JSON.parse(readFileSync(join(homedir(), ".vance", "session.json"), "utf8")).id ?? "";
} catch {}

console.log("本地存着的会话 id:", saved || "(没有)");

// 试着 load 它
send({
  jsonrpc: "2.0",
  id: 2,
  method: "session/load",
  params: { sessionId: saved || "ses_not_exist", cwd: process.cwd(), mcpServers: [] },
});
await wait(3500);

const r = replies.find((m) => m.id === 2);
console.log("session/load 的回应:");
console.log(JSON.stringify(r ?? "(没有任何回应)", null, 2).slice(0, 800));

child.kill();
process.exit(0);
