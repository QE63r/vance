// 决定性测试：新建会话 → 记下 id → 杀掉进程 → 重新 load 这个 id。
// 接得回来 = opencode 支持恢复；接不回来 = 这条路根本不存在。
import { spawn } from "node:child_process";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startAgent() {
  const child = spawn("opencode", ["acp"], { shell: true, stdio: ["pipe", "pipe", "pipe"] });
  const state = { child, replies: [], buf: "" };
  child.stdout.on("data", (d) => {
    state.buf += d.toString();
    const lines = state.buf.split("\n");
    state.buf = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.trim()) continue;
      try { state.replies.push(JSON.parse(l)); } catch {}
    }
  });
  child.stderr.on("data", () => {});
  return state;
}

const send = (s, obj) => s.child.stdin.write(JSON.stringify(obj) + "\n");

// ── 第一次：新建 ──
const a = startAgent();
send(a, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
await wait(2500);
send(a, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd(), mcpServers: [] } });
await wait(3500);

const newReply = a.replies.find((m) => m.id === 2);
const sid = newReply?.result?.sessionId;
console.log("新建的会话 id:", sid ?? JSON.stringify(newReply)?.slice(0, 200));

if (sid) {
  // 让它说一句，确认这个会话有用
  send(a, { jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "记住一个数字：4739。只回复 ok" }] } });
  await wait(12000);
}

a.child.kill();
await wait(2000);

if (!sid) process.exit(1);

// ── 第二次：新进程，试着接回那个会话 ──
const b = startAgent();
send(b, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
await wait(2500);
send(b, { jsonrpc: "2.0", id: 2, method: "session/load", params: { sessionId: sid, cwd: process.cwd(), mcpServers: [] } });
await wait(6000);

const loadReply = b.replies.find((m) => m.id === 2);
console.log("session/load 回应:", JSON.stringify(loadReply ?? "(无回应)").slice(0, 400));

// 如果能接上，问它那个数字
if (loadReply && !loadReply.error) {
  send(b, { jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "我刚才让你记住的数字是多少？只回答数字" }] } });
  await wait(15000);
  const text = b.replies
    .filter((m) => m.method === "session/update" && m.params?.update?.sessionUpdate === "agent_message_chunk")
    .map((m) => m.params.update.content?.text ?? "")
    .join("");
  console.log("它回答:", text.trim() || "(空)");
}

b.child.kill();
process.exit(0);
