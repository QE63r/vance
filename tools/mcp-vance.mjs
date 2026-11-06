// 梵境 MCP 服务：给 Agent 挂"可靠的手"。
//
// 说清楚分工：Agent 负责"决定做什么"，我们负责"做得稳"。
// 比如转 PDF —— 让模型现写 Word COM 代码会卡死，让它调用这个工具就不会。
//
// 协议：MCP / stdio，一行一条 JSON-RPC 消息。日志一律走 stderr，
// stdout 只能出现协议消息（否则客户端解析会崩）。
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

const PROTOCOL = "2024-11-05";
const log = (...a) => process.stderr.write("[mcp-vance] " + a.join(" ") + "\n");

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
      if (name !== "doc_to_pdf") {
        return replyError(id, -32602, `没有这个工具：${name}`);
      }
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

    case "ping":
      return reply(id, {});

    default:
      return replyError(id, -32601, `不支持的方法：${method}`);
  }
});

rl.on("close", () => process.exit(0));
log("started, soffice =", SOFFICE || "(未找到)");
