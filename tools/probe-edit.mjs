// 抓一次"编辑文件"的权限请求，把 params 原样打印出来。
// 目的：看 ACP 到底给不给我们 diff / 新旧内容。
import { spawn } from "node:child_process";

const CWD = "C:\\Users\\1\\Desktop\\梵境\\sandbox";
const child = spawn("opencode.cmd", ["acp"], { shell: true, cwd: CWD, stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line.startsWith("{")) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }

    if (m.method === "session/request_permission") {
      console.log("=== 权限请求 params ===");
      console.log(JSON.stringify(m.params, null, 2).slice(0, 3000));
      const opts = m.params?.options ?? [];
      const reject = opts.find((o) => String(o.kind).startsWith("reject"));
      send({ jsonrpc: "2.0", id: m.id, result: { outcome: { outcome: "selected", optionId: reject?.optionId } } });
      child.kill();
      process.exit(0);
    }
    if (m.id === 1 && m.result) {
      send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: CWD, mcpServers: [] } });
    } else if (m.id === 2) {
      const sid = m.result?.sessionId;
      send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId: sid, prompt: [{ type: "text", text: "把 notes.txt 的第二行改成：第二行已被修改" }] },
      });
    }
  }
});

child.stderr.on("data", () => {});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
setTimeout(() => { console.log("超时"); child.kill(); process.exit(0); }, 60_000);
