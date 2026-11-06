// 冒烟测试：按 MCP 协议跟本地服务对话，验证握手、工具发现、工具调用。
import { spawn } from "node:child_process";

const srv = spawn("node", ["tools/mcp-vance.mjs"], { stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
const waiting = new Map();

srv.stdout.on("data", (d) => {
  buf += d.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const l of lines) {
    if (!l.trim()) continue;
    const msg = JSON.parse(l);
    const r = waiting.get(msg.id);
    if (r) {
      waiting.delete(msg.id);
      r(msg);
    }
  }
});

srv.stderr.on("data", (d) => process.stderr.write("[srv] " + d));

let seq = 1;
function call(method, params) {
  const id = seq++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const init = await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
console.log("1. initialize →", init.result?.serverInfo?.name, init.result?.protocolVersion);

srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const list = await call("tools/list", {});
console.log("2. tools/list →", list.result?.tools?.map((t) => t.name).join(", "));

const res = await call("tools/call", {
  name: "doc_to_pdf",
  arguments: { directory: process.argv[2] },
});
console.log("3. tools/call → isError =", res.result?.isError);
console.log(res.result?.content?.[0]?.text);

srv.kill();
process.exit(0);
