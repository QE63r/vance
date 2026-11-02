#!/usr/bin/env node
/**
 * ACP 桥接实验：把 opencode 发出的权限请求，翻译成梵境的 ApprovalRequest。
 *
 * 这一步是 adapter-opencode 的原型。它只做三件事：
 *   1. 当 ACP 客户端，建会话、发指令
 *   2. 收到 request_permission 时，把「收到的原始那一行」算成 raw_digest
 *   3. 打印成一张审批卡片，然后按策略回答
 *
 * 特别注意：摘要算的是**收到的原始字节**，不是解析后重新序列化的结果。
 * 这就是 ADR-0002 D1 说的「不转述」。
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const CWD = process.argv[2] ?? "C:\\Users\\1\\Desktop\\梵境\\sandbox";
const PROMPT = process.argv[3] ?? "把 data.csv 删掉";
const DECISION = process.argv[4] ?? "reject"; // reject | allow

const child = spawn("opencode.cmd", ["acp"], { shell: true, cwd: CWD, stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
let sessionId = null;
let seq = 0;
let done = 0;
let failed = 0;
const lastStatus = new Map();

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

/** 把一次权限请求渲染成审批卡片（对应 ADR-0002 的四行结构） */
function renderCard(rawLine, params, decision) {
  const digest = createHash("sha256").update(Buffer.from(rawLine, "utf8")).digest("hex");
  const { toolCall, options = [] } = params;
  const pick = (kind) => options.find((o) => String(o.kind ?? "").startsWith(kind));

  const chosen = decision === "allow" ? (pick("allow") ?? options[0]) : (pick("reject") ?? options[0]);
  seq += 1;

  console.log("");
  console.log("┌─ 审批请求 #" + seq + " " + "─".repeat(46));
  console.log("│ 动作    " + (toolCall?.title ?? "(未提供)"));
  console.log("│ 类型    " + (toolCall?.kind ?? "-") + "  状态 " + (toolCall?.status ?? "-"));
  const locs = (toolCall?.locations ?? []).map((l) => l.path).filter(Boolean);
  if (locs.length) console.log("│ 位置    " + locs.join(", "));
  console.log("│ 原文    " + Buffer.byteLength(rawLine, "utf8") + " 字节");
  console.log("│ 摘要    " + digest.slice(0, 32) + "…");
  console.log("│ 选项    " + options.map((o) => o.kind).join(" / "));
  console.log("│ 决定    " + (chosen?.optionId ?? "?"));
  console.log("└" + "─".repeat(54));

  return { digest, optionId: chosen?.optionId };
}

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line.startsWith("{")) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    // ★ 权限请求：这里是唯一需要我们做决定的地方
    if (msg.method === "session/request_permission") {
      const { digest, optionId } = renderCard(line, msg.params, DECISION);
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { outcome: { outcome: "selected", optionId } },
      });
      console.error(`[bridge] 已回复 ${optionId}，raw_digest=${digest.slice(0, 12)}…`);
      continue;
    }

    // 步骤流：Agent 每做一步，都会推一条 session/update。
    // 这就是「监控反馈」的数据源——不用模型，纯翻译。
    if (msg.method === "session/update") {
      const u = msg.params?.update ?? {};
      const kind = u.sessionUpdate;
      const id = u.toolCallId ?? "";
      const title = u.title ?? u.toolCallId ?? "(未命名)";

      if (kind === "tool_call") {
        if (!lastStatus.has(id)) {
          lastStatus.set(id, "pending");
          console.log(`  ○ 待执行   ${title}`);
        }
      } else if (kind === "tool_call_update") {
        const st = u.status;
        if (st && lastStatus.get(id) !== st) {
          lastStatus.set(id, st);
          const mark = st === "completed" ? "✓" : st === "failed" ? "✗" : st === "in_progress" ? "●" : "○";
          const verb = st === "completed" ? "完成" : st === "failed" ? "失败" : st === "in_progress" ? "执行中" : st;
          console.log(`  ${mark} ${verb}   ${title}`);
          if (st === "completed") done += 1;
          if (st === "failed") failed += 1;
        }
      }
      continue;
    }

    if (msg.method) continue;

    if (msg.id === 1 && msg.result) {
      console.error("[bridge] initialize ok: " + msg.result.agentInfo?.name);
      send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: CWD, mcpServers: [] } });
    } else if (msg.id === 2) {
      if (msg.error) {
        console.error("[bridge] session/new 失败", JSON.stringify(msg.error));
        process.exit(1);
      }
      sessionId = msg.result?.sessionId;
      console.error("[bridge] session = " + sessionId);
      send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: PROMPT }] },
      });
    } else if (msg.id === 3) {
      console.log("");
      console.log(`—— 本次共 ${done} 步完成、${failed} 步失败 ——`);
      console.error("[bridge] prompt 结束: " + JSON.stringify(msg.result?.stopReason ?? msg.error));
      child.kill();
      process.exit(0);
    }
  }
});

child.stderr.on("data", (d) => {
  const s = d.toString().trim();
  if (s) console.error("[opencode] " + s.slice(0, 200));
});

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });

setTimeout(() => {
  console.error("[bridge] 超时退出");
  child.kill();
  process.exit(0);
}, 60_000);
