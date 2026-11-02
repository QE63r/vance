// 把三块接起来：Host 网页 + ACP Agent + 决定回传。
// 启动后终端会打印一个地址，手机连同一个 wifi 打开即可。
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostServer } from "../packages/host/dist/index.js";
import { AcpClient } from "../packages/adapter-opencode/dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, "..", "packages", "host", "public", "index.html");

const CWD = process.argv[2] ?? "C:\\Users\\1\\Desktop\\梵境\\sandbox";
const PROMPT = process.env.VANCE_PROMPT ?? process.argv[3] ?? "把 data.csv 删掉";
const PORT = Number(process.env.PORT ?? 8787);
const token = randomBytes(4).toString("hex");

/** 等待人决定的请求：request_id → 回给 Agent 的函数 */
const pending = new Map();

const host = new HostServer({
  port: PORT,
  token,
  pagePath: PAGE,
  projectName: "sandbox",
  task: PROMPT,
});

host.onDecision(({ requestId, decision }) => {
  const reply = pending.get(requestId);
  if (!reply) return false;
  reply(decision);
  pending.delete(requestId);
  console.log(`[host] 手机决定：${decision}（${requestId.slice(0, 12)}…）`);
  return true;
});

const { port, urls } = await host.start();

console.log("");
console.log("  梵境 · 等待手机连接");
console.log("  ────────────────────────────────────────");
for (const u of urls) console.log(`  ${u}/?token=${token}`);
if (urls.length === 0) console.log(`  http://127.0.0.1:${port}/?token=${token}`);
console.log("  ────────────────────────────────────────");
console.log(`  口令：${token}（只在本次运行有效）`);
console.log("");

const client = new AcpClient(
  { cwd: CWD, projectId: "sandbox" },
  {
    onStep: (event) => {
      host.broadcast(event);
      const s = event.step?.status ?? "pending";
      const mark = { pending: "○", running: "●", done: "✓", failed: "✗" }[s];
      console.log(`  ${mark} ${event.step?.title}`);
    },
    onApproval: (event, reply) => {
      pending.set(event.request_id, reply);
      host.broadcast(event);
      console.log("");
      console.log("  ⚠ 已推送到手机：" + event.action_display);
      console.log("    等待决定…（60 秒不处理将作废）");

      // 超时兜底：fail-closed，到点自动拒绝
      setTimeout(() => {
        if (pending.has(event.request_id)) {
          pending.delete(event.request_id);
          host.forget(event.request_id);
          console.log("  ⌛ 超时，自动拒绝");
          reply("reject");
        }
      }, 60_000);
    },
    onLog: () => {},
  },
);

const sessionId = await client.start();
console.log("  session: " + sessionId);
console.log("  指令: " + PROMPT);
console.log("");

// 等手机连上再开始，避免"审批已经发出、人还没打开页面"
if (host.deviceCount === 0) {
  console.log("  等待手机连接后再开始…");
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (host.deviceCount > 0) {
        clearInterval(timer);
        resolve();
      }
    }, 300);
  });
  console.log("  手机已连接，开始执行");
  console.log("");
}

const reason = await client.runTurn(PROMPT);
console.log("  本轮结束: " + reason);
console.log(`  连接中的设备: ${host.deviceCount}`);
console.log("");
console.log("  服务继续运行，Ctrl+C 退出。");
