// 用编译后的 adapter-opencode 跑一次真实 Agent。
// 这一步验证的不是翻译（单测已经覆盖），而是"进程 + 协议 + 事件"这条链路。
import { AcpClient } from "../packages/adapter-opencode/dist/index.js";

const CWD = process.argv[2] ?? "C:\\Users\\1\\Desktop\\梵境\\sandbox";
const PROMPT = process.argv[3] ?? "把 data.csv 删掉";
const DECISION = process.argv[4] === "allow" ? "allow" : "reject";

const client = new AcpClient(
  { cwd: CWD, projectId: "sandbox" },
  {
    onStep: (e) => {
      const mark = { pending: "○", running: "●", done: "✓", failed: "✗" }[e.step?.status ?? "pending"];
      console.log(`  ${mark} ${e.step?.title}`);
    },
    onApproval: (e, reply) => {
      console.log("");
      console.log("  ⚠ 需要批准：" + e.action_display);
      console.log("    原文 " + e.raw_ref.length + " 字节 · 摘要 " + e.raw_digest.slice(0, 16) + "…");
      console.log("    60 秒内不回复将自动失效");
      setTimeout(() => {
        console.log("    → " + DECISION);
        reply(DECISION);
      }, 500);
    },
    onLog: (l) => console.error("[opencode] " + l.slice(0, 160)),
  },
);

const sessionId = await client.start();
console.log("session:", sessionId);
console.log("");
const reason = await client.runTurn(PROMPT);
console.log("");
console.log("本轮结束:", reason);
client.stop();
process.exit(0);
