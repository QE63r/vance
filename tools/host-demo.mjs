// 把三块接起来：Host 网页 + ACP Agent + 决定回传。
// 启动后终端会打印一个地址，手机连同一个 wifi 打开即可。
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostServer, lanEntries } from "../packages/host/dist/index.js";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { AcpClient } from "../packages/adapter-opencode/dist/index.js";
import { classifyApproval, treatKey } from "../packages/policy/dist/index.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, "..", "packages", "host", "public", "index.html");

const CWD = process.argv[2] ?? "C:\\Users\\1\\Desktop\\梵境\\sandbox";
const PROMPT = process.env.VANCE_PROMPT ?? process.argv[3] ?? "把 data.csv 删掉";
const PORT = Number(process.env.PORT ?? 8787);
const USE_TUNNEL = process.argv.includes("--tunnel");
// 固定口令：存在 ~/.vance/token，重启后不变，手机存一次书签就能长期用
// 固定口令：存在 ~/.vance/token，重启后不变。
// 上公网（隧道）后 8 位挡不住扫描器，所以少于 32 位就自动升级。
const TOKEN_FILE = join(homedir(), ".vance", "token");
const token = (() => {
  const make = () => randomBytes(16).toString("hex"); // 32 位十六进制
  try {
    const saved = readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved.length >= 32) return saved;
    if (saved) console.log("  口令太短，已升级为 32 位（旧地址会失效）");
  } catch {}
  const fresh = make();
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, fresh);
  return fresh;
})();

/** 等待人决定的请求：request_id → 回给 Agent 的函数 */
const pending = new Map();
const RULES = join(homedir(), ".vance", "rules.json");
const remembered = (() => {
  try { return JSON.parse(readFileSync(RULES, "utf8")).allow ?? []; } catch { return []; }
})();
function saveRules() {
  mkdirSync(dirname(RULES), { recursive: true });
  writeFileSync(RULES, JSON.stringify({ allow: remembered }, null, 2));
}

const host = new HostServer({
  port: PORT,
  token,
  pagePath: PAGE,
  projectName: "sandbox",
});

host.onDecision(({ requestId, decision }) => {
  const entry = pending.get(requestId);
  if (!entry) return false;
  if (decision === "remember" && entry.key && !remembered.includes(entry.key)) {
    remembered.push(entry.key);
    saveRules();
    console.log(`  ★ 已记住：${entry.key.slice(0, 60)}`);
  }
  entry.reply(decision === "remember" ? "allow" : decision);
  pending.delete(requestId);
  console.log(`[host] 手机决定：${decision}（${requestId.slice(0, 12)}…）`);
  return true;
});

const { port, urls } = await host.start();

// ── 实时画面：有手机连着才抓屏，没人看就停（不白烧 CPU） ──
let streamer = null;
let lastHash = "";
let streamWatch = null;

function startStreamer() {
  if (streamer) return;
  streamer = spawn(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "screen-stream.ps1"),
     "-Fps", "2", "-Width", "800", "-Quality", "45"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  console.log("  ▶ 实时画面已开启（2 fps）");

  let buf = Buffer.alloc(0);
  streamer.stdout.on("data", (chunk) => {
    try {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (len <= 0 || len > 4_000_000) { buf = Buffer.alloc(0); return; }
      if (buf.length < 4 + len) break;
      const frame = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);

      // 画面没变就不发：静态桌面几乎不占流量
      const hash = createHash("sha1").update(frame).digest("hex");
      if (hash === lastHash) continue;
      lastHash = hash;

      host.broadcastFrame(Buffer.from(frame));
    }
    } catch (err) {
      // 一帧坏了就丢掉这一帧，绝不能因此让整个服务退出
      console.log("  ⚠ 画面帧处理失败：" + String(err).slice(0, 80));
      buf = Buffer.alloc(0);
    }
  });
  streamer.on("exit", () => { streamer = null; });
}

function stopStreamer() {
  if (!streamer) return;
  try { streamer.kill(); } catch {}
  streamer = null;
  lastHash = "";
  console.log("  ⏸ 没人看，实时画面已暂停");
}

streamWatch = setInterval(() => {
  if (host.deviceCount > 0) startStreamer();
  else stopStreamer();
}, 3000);


// 挑一张「真实」的网卡：优先 WLAN / Wi-Fi / 以太网，跳过虚拟网卡
const entries = lanEntries(port);
const real =
  entries.find((e) => /Wi-?Fi|WLAN|以太网|Ethernet/i.test(e.iface) && !/vEthernet|Loopback/i.test(e.iface)) ??
  entries[0];

const url = `${real ? real.url : `http://127.0.0.1:${port}`}/?token=${token}`;

console.log("");
console.log("  梵境 · 等待手机连接");
console.log("  ────────────────────────────────────────");
if (real) console.log(`  网卡：${real.iface}  地址：${real.address}`);
console.log("");
console.log("  【同一个 wifi】手机和这台电脑连同一个网络时，扫这个（更快）：");
console.log("");
qrcode.generate(url, { small: true });
console.log("");
console.log(`  ${url}`);
console.log("");
console.log("  ⚠ 手机用流量、或不在同一个 wifi 时，这个地址打不开——");
console.log("    用下面马上会出现的【公网】码。");
console.log("  ────────────────────────────────────────");
console.log("");

if (USE_TUNNEL) {
  const CANDIDATES = [
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
    "cloudflared",
  ];
  const exe = CANDIDATES.find((p) => p === "cloudflared" || existsSync(p)) ?? "cloudflared";

  console.log("  正在建立公网隧道（cloudflared）…");
  const cf = spawn(exe, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let seen = "";
  let printed = false;
  const scan = (chunk) => {
    seen += chunk.toString();
    const m = seen.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !printed) {
      printed = true;
      const publicUrl = `${m[0]}/?token=${token}`;
      // 写文件：Node 的 stdout 接管道时是块缓冲，日志可能迟迟不刷出来
      try {
        writeFileSync(join(homedir(), ".vance", "tunnel-url.txt"), publicUrl);
        // 顺手画一张二维码图片：终端里的码在后台运行时看不见
        void QRCode.toFile(join(homedir(), ".vance", "qr.png"), publicUrl, {
          width: 720,
          margin: 2,
          color: { dark: "#11181f", light: "#ffffff" },
        });
      } catch {}
      console.log("");
      console.log("  ────────────────────────────────────────");
      console.log("  【公网】手机用流量 / 不在同一个 wifi 时，扫这个：");
      console.log("");
      qrcode.generate(publicUrl, { small: true });
      console.log("");
      console.log(`  ${publicUrl}`);
      console.log("");
      console.log("  ⚠ 这个地址是公开可访问的，只发给自己；每次重启都会变。");
      console.log("  ────────────────────────────────────────");
      console.log("");
    }
  };
  cf.stdout.on("data", scan);
  cf.stderr.on("data", scan);
  cf.on("exit", (code) => console.log(`  [tunnel] cloudflared 退出（${code}）`));
}

const client = new AcpClient(
  { cwd: CWD, projectId: "sandbox" },
  {
    onChat: (messageId, text) => host.broadcastChat(messageId, text),
    onStep: (event) => {
      host.broadcast(event);
      const s = event.step?.status ?? "pending";
      const mark = { pending: "○", running: "●", done: "✓", failed: "✗" }[s];
      console.log(`  ${mark} ${event.step?.title}`);
    },
    onApproval: (event, reply) => {
      // 判定顺序：禁止 → 记住 → 只读 → 问人
      const verdict = classifyApproval(event, remembered);

      if (verdict.deny) {
        console.log(`  ⛔ 拦截（${verdict.reason}）：${String(event.action_display).slice(0, 46)}`);
        host.broadcastNotice("deny", `已拦截：${verdict.reason}`);
        reply("reject");
        return;
      }

      if (verdict.auto) {
        console.log(`  · 静默放行（${verdict.reason}）：${String(event.action_display).slice(0, 46)}`);
        host.broadcastNotice("auto", `已静默放行：${String(event.action_display).slice(0, 40)}`);
        reply("allow");
        return;
      }

      pending.set(event.request_id, { reply, key: treatKey(event) });
      host.broadcast(event);
      console.log("");
      console.log("  ⚠ 已推送到手机：" + event.action_display);
      console.log("    等待决定…（180 秒不处理将作废）");

      // 超时兜底：fail-closed，到点自动拒绝
      setTimeout(() => {
        if (pending.has(event.request_id)) {
          pending.delete(event.request_id);
          host.forget(event.request_id);
          console.log("  ⌛ 超时，自动拒绝");
          reply("reject");
        }
      }, 180_000);
    },
    onLog: (line) => console.log("  [acp] " + String(line).slice(0, 120)),
  },
);

const sessionId = await client.start();
console.log("  session: " + sessionId);
console.log("");


// 手机上发来的指令 → 交给 Agent 接着干
host.onPrompt(async (text) => {
  if (running) return;
  running = true;
  host.broadcastTurn("running");
  console.log("\n  ▶ 手机指令：" + text);
  try {
    const watchdog = setTimeout(() => {
      console.log("  \u26a0 120 秒无进展，判定为卡住");
      host.broadcastNotice("deny", "这一步超过 120 秒没有进展，已放开输入");
      host.broadcastTurn("stopped");
      running = false;
    }, 120_000);
    const r = await client.runTurn(text).finally(() => clearTimeout(watchdog));
    console.log("  本轮结束：" + r);
  } catch (err) {
    console.log("  出错：" + String(err));
  } finally {
    running = false;
    host.broadcastTurn("idle");
  }
});

host.onScreenshot(async () => {
  const out = join(HERE, "..", ".shot.jpg");
  try {
    await new Promise((resolve, reject) => {
      const ps = spawn(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "screenshot.ps1"), "-Out", out],
        { stdio: "ignore" },
      );
      ps.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("screenshot exit " + code))));
      ps.on("error", reject);
    });
    const buf = readFileSync(out);
    console.log(`  \u{1F5BC} 截图 ${Math.round(buf.length / 1024)} KB`);
    return "data:image/jpeg;base64," + buf.toString("base64");
  } catch (err) {
    console.log("  截图失败：" + String(err));
    return null;
  }
});

host.onStop(() => {
  console.log("  ⏹ 手机要求停止");
  client.cancel();
  host.broadcastTurn("stopped");
});

let running = false;

console.log("  就绪。等你在手机上发话——服务端不会替你说任何话。");
console.log("");
console.log("  服务继续运行，Ctrl+C 退出。");
