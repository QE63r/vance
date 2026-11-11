// 梵境 MCP 服务：给 Agent 挂"可靠的手"。
//
// 说清楚分工：Agent 负责"决定做什么"，我们负责"做得稳"。
// 比如转 PDF —— 让模型现写 Word COM 代码会卡死，让它调用这个工具就不会。
//
// 协议：MCP / stdio，一行一条 JSON-RPC 消息。日志一律走 stderr，
// stdout 只能出现协议消息（否则客户端解析会崩）。
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { homedir } from "node:os";

const PROTOCOL = "2024-11-05";
const log = (...a) => process.stderr.write("[mcp-vance] " + a.join(" ") + "\n");
const HOST_URL = process.env.VANCE_HOST_URL ?? "http://127.0.0.1:8787";
const TOKEN_FILE = join(homedir(), ".vance", "token");

function hostToken() {
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

async function postJson(path, body) {
  const token = hostToken();
  if (!token) throw new Error("找不到 host 口令（~/.vance/token）");
  const res = await fetch(`${HOST_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vance-token": token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`host ${res.status}: ${data.error ?? raw.slice(0, 120)}`);
  return data;
}

async function getPlan(planId) {
  const token = hostToken();
  if (!token) throw new Error("找不到 host 口令（~/.vance/token）");
  const res = await fetch(`${HOST_URL}/plan/${encodeURIComponent(planId)}`, {
    headers: { "x-vance-token": token },
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`host ${res.status}: ${data.error ?? raw.slice(0, 120)}`);
  return data.plan;
}

/**
 * 提交计划并等手机决定。
 *
 * 这个工具会阻塞到“人批准/拒绝/超时”，所以 Agent 不能在没人看的时候
 * 调它然后继续写文件——它必须拿到 allowed 才能往下做。
 */
async function submitPlan(args) {
  const steps = Array.isArray(args.steps) ? args.steps : [];
  if (steps.length === 0) throw new Error("steps 不能为空");
  let created;
  try {
    created = await postJson("/plan", {
      title: typeof args.title === "string" ? args.title : undefined,
      steps,
    });
  } catch (err) {
    if (String(err).includes("plan-needs-target")) {
      throw new Error("计划没有具体目标。先读/扫描出具体文件路径，再提交；如果连范围都说不清，先问用户。");
    }
    throw err;
  }
  const planId = created.plan_id;
  log("计划已提交", planId);

  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const plan = await getPlan(planId);
    if (plan.status === "allowed") {
      return { ok: true, text: `计划已批准（${planId}）。按计划执行；计划外动作仍会再问你。` };
    }
    if (plan.status === "rejected") {
      return { ok: false, text: `计划被拒绝（${planId}）。不要执行，先问用户要改什么。` };
    }
    if (plan.status === "expired") {
      return { ok: false, text: `计划已过期（${planId}）。不要执行，重新提交计划或问用户。` };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, text: `计划在 5 分钟内没有被处理（${planId}）。不要执行；让用户先看手机。` };
}


/* ---------------- 工具实现 ---------------- */

const SOFFICE = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
].find((p) => existsSync(p));

function convertDir(directory, outDir) {
  if (!directory || !existsSync(directory)) {
    return { ok: false, text: `目录不存在：${directory ?? "(空)"}` };
  }
  const files = readdirSync(directory).filter((f) =>
    [".doc", ".docx"].includes(extname(f).toLowerCase()),
  );
  if (files.length === 0) return { ok: false, text: `${directory} 里没有 .doc/.docx` };

  const out = outDir || join(directory, "PDF");
  mkdirSync(out, { recursive: true });

  if (!SOFFICE) {
    return {
      ok: false,
      text: "这台机器没有 LibreOffice，转不了 PDF。装一个即可：winget install TheDocumentFoundation.LibreOffice",
    };
  }

  const done = [];
  const failed = [];

  for (const f of files) {
    const src = join(directory, f);
    const expect = join(out, basename(f, extname(f)) + ".pdf");
    const run = () =>
      spawnSync(
        SOFFICE,
        ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", out, src],
        { encoding: "utf8", timeout: 120000 },
      );

    // LibreOffice 首次运行要建配置，第一次常失败——重试一次
    run();
    if (!existsSync(expect)) run();

    if (existsSync(expect)) {
      done.push(`${basename(expect)} (${Math.round(statSync(expect).size / 1024)} KB)`);
    } else {
      failed.push(f);
    }
  }

  const lines = [];
  if (done.length) lines.push(`成功 ${done.length} 个：\n  ${done.join("\n  ")}`);
  if (failed.length) lines.push(`失败 ${failed.length} 个：${failed.join(", ")}`);
  lines.push(`输出目录：${out}`);
  return { ok: failed.length === 0, text: lines.join("\n") };
}

/* ---------------- 协议 ---------------- */

const TOOLS = [
  {
    name: "doc_to_pdf",
    description:
      "把目录下的 .doc/.docx 全部转成 PDF（本地 LibreOffice，不联网、不上传）。返回生成的文件与大小。",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "源目录的绝对路径" },
        out_dir: { type: "string", description: "输出目录；默认是源目录下的 PDF 子目录" },
      },
      required: ["directory"],
    },
  },
  {
    name: "vance_plan",
    description:
      "在写文件、删文件、移动文件或运行脚本前，把计划提交到手机审批。移动/重命名必须放 facts.moves:[{from,to}]；是否允许由 host 用户策略决定。必须等到返回 allowed 才能执行；rejected/expired/超时都不要执行。纯读取和回答不需要调用。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "一句话说明这轮要做什么" },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", description: "edit / execute / delete 等" },
              action_display: { type: "string", description: "给人看的具体动作" },
              facts: {
                type: "object",
                description: "动作事实，尽量包含 writes/deletes/script/program；手机按事实判断",
              },
            },
            required: ["action_display"],
          },
        },
      },
      required: ["steps"],
    },
  },
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;

  let msg;
  try {
    msg = JSON.parse(s);
  } catch {
    return replyError(null, -32700, "JSON 解析失败");
  }

  const { id, method, params } = msg;

  // 通知类消息没有 id，不需要回
  if (id === undefined) return;

  switch (method) {
    case "initialize":
      return reply(id, {
        // 回客户端要的版本；它没提就用自己的
        protocolVersion: params?.protocolVersion || PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "vance-tools", version: "0.1.0" },
      });

    case "tools/list":
      return reply(id, { tools: TOOLS });

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};

      if (name === "doc_to_pdf") {
        log("调用 doc_to_pdf", JSON.stringify(args));
        try {
          const r = convertDir(args.directory, args.out_dir);
          log("结果", r.ok ? "成功" : "失败");
          return reply(id, {
            content: [{ type: "text", text: r.text }],
            isError: !r.ok,
          });
        } catch (err) {
          log("异常", String(err));
          return reply(id, {
            content: [{ type: "text", text: "转换出错：" + String(err) }],
            isError: true,
          });
        }
      }

      if (name === "vance_plan") {
        log("提交计划", JSON.stringify(args).slice(0, 500));
        void (async () => {
          try {
            const r = await submitPlan(args);
            log("计划结果", r.ok ? "allowed" : "not-allowed");
            reply(id, {
              content: [{ type: "text", text: r.text }],
              isError: !r.ok,
            });
          } catch (err) {
            log("计划异常", String(err));
            reply(id, {
              content: [{ type: "text", text: "计划提交失败：" + String(err) }],
              isError: true,
            });
          }
        })();
        return;
      }

      return replyError(id, -32602, `没有这个工具：${name}`);
    }

    case "ping":
      return reply(id, {});

    default:
      return replyError(id, -32601, `不支持的方法：${method}`);
  }
});

rl.on("close", () => process.exit(0));
log("started, soffice =", SOFFICE || "(未找到)");
