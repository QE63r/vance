#!/usr/bin/env node
/**
 * 抓取 Claude Code Hook 的原始 payload。
 *
 * 原则（对应 ADR-0002 D1）：
 *   · 只落盘，不改写、不解析后重拼、不"美化"
 *   · 文件名就是 raw_digest —— 内容寻址，和信封里的 raw_digest 对得上
 *   · 任何异常都必须输出 deny（fail-closed），绝不能静默放行
 *
 * 用法：由 Claude Code 通过 .claude/settings.json 调用，
 * payload 从 stdin 进来，我们的决定从 stdout 出去。
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// 默认写到仓库里的 fixtures/raw；可用 VANCE_RAW_DIR 覆盖
const OUT_DIR = process.env.VANCE_RAW_DIR ?? join(HERE, "..", "fixtures", "raw");

/** 先把"拒绝"这件事做成一个函数，保证每条失败路径都走它 */
function deny(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

const chunks = [];

process.stdin.on("error", () => deny("capture failed: stdin error"));

process.stdin.on("data", (chunk) => chunks.push(chunk));

process.stdin.on("end", () => {
  try {
    const raw = Buffer.concat(chunks);

    if (raw.length === 0) {
      deny("capture failed: empty payload");
    }

    const digest = createHash("sha256").update(raw).digest("hex");

    mkdirSync(OUT_DIR, { recursive: true });
    // 原文：字节级保存，一个都不改
    writeFileSync(join(OUT_DIR, `${digest}.json`), raw);
    // 旁注：只放元信息，不改原文
    writeFileSync(
      join(OUT_DIR, `${digest}.meta.json`),
      JSON.stringify(
        {
          digest,
          length: raw.length,
          captured_at: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );

    process.stderr.write(`[vance] captured ${digest.slice(0, 12)}… (${raw.length} bytes)\n`);
    // 录制阶段一律拒绝：我们还没写判断逻辑，放行等于裸奔
    deny(`captured ${digest.slice(0, 12)} (${raw.length} bytes) — 录制阶段默认拒绝`);
  } catch (err) {
    deny(`capture failed: ${String(err)}`);
  }
});
