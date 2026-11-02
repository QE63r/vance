// 模拟手机：连上 Host，收到审批请求就自动批准/拒绝。
// 用 Node 内置 WebSocket（22+ 自带），不依赖 ws 包。
const url = process.argv[2];
const decision = process.argv[3] === "reject" ? "reject" : "allow";

const ws = new WebSocket(url);

ws.addEventListener("open", () => console.log("[phone] 已连接"));

ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "hello") console.log("[phone] 项目:", msg.project);
  if (msg.type === "ack") console.log("[phone] ack:", msg.accepted ? "已生效" : "已失效");
  if (msg.type !== "event") return;

  const ev = msg.event;
  if (ev.type === "approval_request") {
    console.log("[phone] 收到审批:", ev.action_display);
    console.log("[phone] 原文", ev.raw_ref?.length, "字节 · 摘要", (ev.raw_digest || "").slice(0, 12) + "…");
    setTimeout(() => {
      console.log("[phone] 回复:", decision);
      ws.send(JSON.stringify({ type: "decision", requestId: ev.request_id, decision }));
    }, 400);
  }
  if (ev.type === "status_update") {
    console.log("[phone] 步骤:", ev.step?.status, (ev.step?.title || "").slice(0, 40));
  }
});

ws.addEventListener("close", () => {
  console.log("[phone] 断开");
  process.exit(0);
});

ws.addEventListener("error", (e) => {
  console.error("[phone] 错误:", e.message ?? e);
  process.exit(1);
});

setTimeout(() => {
  console.log("[phone] 超时退出");
  process.exit(0);
}, 45_000);
