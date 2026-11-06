// 把三块接起来：Host 网页 + ACP Agent + 决定回传。
// 启动后终端会打印一个地址，手机连同一个 wifi 打开即可。
import { createHash, randomBytes } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostServer, lanEntries } from "../packages/host/dist/index.js";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { AcpClient } from "../packages/adapter-opencode/dist/index.js";
import { classifyApproval, treatKey, explainAction } from "../packages/policy/dist/index.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
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
const repeatCount = new Map();
// 本轮已授权的"同类操作"：key = 动词|目录。轮次结束就清空。
const turnGrants = new Set();

/** 把一条命令归成"同类"：动词 + 目录 */
function grantKey(event) {
  const action = String(event.action_display ?? "");
  const verb = (action.match(/\b(Get-ChildItem|New-Item|Move-Item|Copy-Item|Remove-Item|Set-Content|Out-File|Export-Csv|Rename-Item)\b/i)?.[1] ?? "other").toLowerCase();
  const facts = event.facts ?? {};
  const dir = String(facts.locations ?? facts.files ?? "").split("\\").slice(0, -1).join("\\").toLowerCase();
  return `${verb}|${dir}`;
} // 同一条动作被要求的次数（防死循环）
const RULES = join(homedir(), ".vance", "rules.json");
const remembered = (() => {
  try { return JSON.parse(readFileSync(RULES, "utf8")).allow ?? []; } catch { return []; }
})();
function saveRules() {
  mkdirSync(dirname(RULES), { recursive: true });
  writeFileSync(RULES, JSON.stringify({ allow: remembered }, null, 2));
}


// ── 产物判定 ──
// 不看它说了什么，看磁盘上到底变了什么。这是唯一不会骗人的证据。
function snapshot(root, maxDepth = 3) {
  const out = new Map();
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.size > 3000) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (/^(node_modules|\.git|\.vance)$/i.test(e.name)) continue;
        walk(p, depth + 1);
      } else {
        try {
          const st = statSync(p);
          // 大小 + 修改时间：覆盖成同样大小的文件也能发现
          out.set(p, `${st.size}:${Math.round(st.mtimeMs)}`);
        } catch {}
      }
    }
  };
  walk(root, 0);
  return out;
}

function diffSnapshot(before, after) {
  const added = [], changed = [], removed = [];
  for (const [p, size] of after) {
    if (!before.has(p)) added.push(p);
    else if (before.get(p) !== size) changed.push(p);
  }
  for (const p of before.keys()) if (!after.has(p)) removed.push(p);
  return { added, changed, removed };
}


/**
 * 轻量内容校验：只查"生成了但内容不对"这类问题。
 * 它说自己带 BOM，磁盘说不带——这种不一致只有查了才知道。
 */
function inspectText(path) {
  try {
    const ext = extname(path).toLowerCase();
    if (![".csv", ".json", ".txt", ".md", ".log"].includes(ext)) return null;
    if (statSync(path).size > 2_000_000) return null;

    const buf = readFileSync(path);
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const name = basename(path);

    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      return `${name} 不是 UTF-8（别的程序打开会乱码）`;
    }

    if (ext === ".json") {
      try { JSON.parse(text); } catch { return `${name} 不是合法 JSON`; }
    }
    if (ext === ".csv" && !bom) {
      return `${name} 没有 BOM，Excel 打开中文会乱码`;
    }
    return null;
  } catch {
    return null;
  }
}

function inspectArtifacts(paths) {
  const warnings = [];
  for (const p of paths.slice(0, 10)) {
    const w = inspectText(p);
    if (w) warnings.push(w);
  }
  if (warnings.length === 0) return;
  for (const w of warnings) console.log("  ⚠ " + w);
  host.broadcastNotice("deny", "产出检查：" + warnings.join("；"));
}

function reportArtifacts(before, after) {
  const { added, changed, removed } = diffSnapshot(before, after);
  inspectArtifacts([...added, ...changed]);
  const total = added.length + changed.length + removed.length;
  if (total === 0) {
    host.broadcastNotice("deny", "本轮没有任何文件变化——它说的和它做的，对不上");
    console.log("  📦 产出：无变化");
    return;
  }
  const short = (p) => p.split("\\").slice(-2).join("\\");
  const parts = [];
  if (added.length) parts.push(`新增 ${added.length}`);
  if (changed.length) parts.push(`改动 ${changed.length}`);
  if (removed.length) parts.push(`删除 ${removed.length}`);
  const names = [...added, ...changed, ...removed].slice(0, 4).map(short).join(" · ");
  host.broadcastNotice("auto", `本轮产出：${parts.join("，")}（${names}${total > 4 ? " …" : ""}）`);
  console.log(`  📦 产出：${parts.join("，")}`);
  for (const p of [...added, ...changed].slice(0, 8)) console.log(`     + ${p}`);
}

const host = new HostServer({
  port: PORT,
  token,
  pagePath: PAGE,
  projectName: "sandbox",
});

host.onDecision(({ requestId, decision, by }) => {
  const entry = pending.get(requestId);
  if (!entry) return false;
  if (decision === "remember" && entry.key && !remembered.includes(entry.key)) {
    remembered.push(entry.key);
    saveRules();
    console.log(`  ★ 已记住：${entry.key.slice(0, 60)}`);
  }
  if (decision !== "reject" && entry.event) {
    const gk = grantKey(entry.event);
    turnGrants.add(gk);
    console.log(`  ★ 本轮已允许同类：${gk}`);
  }
  entry.reply(decision === "remember" ? "allow" : decision);
  pending.delete(requestId);
  console.log(`[host] 决定：${decision} 来自 ${by ?? "?"}（${requestId.slice(0, 12)}…）`);
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

  // 如果隧道已经由 Tailscale Funnel 提供，直接用它（地址永久固定）
  let funnelDone = false;
  try {
    const out = execSync("tailscale funnel status", { encoding: "utf8", timeout: 5000 });
    const m = out.match(/https:\/\/[a-z0-9-]+\.ts\.net\/?/i);
    if (m) {
      const publicUrl = `${m[0].replace(/\/$/, "")}/?token=${token}`;
      console.log("");
      console.log("  ── 公网地址（Tailscale Funnel，永久固定）──────");
      qrcode.generate(publicUrl, { small: true });
      console.log(`  ${publicUrl}`);
      console.log("  ────────────────────────────────────────");
      try {
        writeFileSync(join(homedir(), ".vance", "tunnel-url.txt"), publicUrl);
        void QRCode.toFile(join(homedir(), ".vance", "qr.png"), publicUrl, {
          width: 720, margin: 2, color: { dark: "#11181f", light: "#ffffff" },
        });
      } catch {}
      console.log("");
      funnelDone = true;
    }
  } catch {}

  if (!funnelDone) {
  // 有命名隧道配置就走固定地址；否则用临时隧道（地址每次变）
  const namedCfgPath = join(homedir(), ".vance", "tunnel.json");
  let named = null;
  try {
    named = JSON.parse(readFileSync(namedCfgPath, "utf8"));
  } catch {}

  if (named?.host) {
    console.log(`  正在建立固定隧道：${named.name} → https://${named.host}`);
    const cf = spawn(exe, ["tunnel", "run", "--url", `http://127.0.0.1:${port}`, named.name], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const publicUrl = `https://${named.host}/?token=${token}`;
    console.log("");
    console.log("  ── 公网地址（固定，重启也不变）────────────");
    qrcode.generate(publicUrl, { small: true });
    console.log(`  ${publicUrl}`);
    console.log("  ────────────────────────────────────────");
    try {
      writeFileSync(join(homedir(), ".vance", "tunnel-url.txt"), publicUrl);
      void QRCode.toFile(join(homedir(), ".vance", "qr.png"), publicUrl, {
        width: 720, margin: 2, color: { dark: "#11181f", light: "#ffffff" },
      });
    } catch {}
    cf.stderr.on("data", (d) => {
      const s = String(d);
      if (/error|ERR/i.test(s)) console.log("  [tunnel] " + s.trim().slice(0, 120));
    });
    cf.on("exit", (code) => console.log(`  [tunnel] cloudflared 退出（${code}）`));
  } else {

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
  }
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
      // 同一条动作第三次找上门，说明它卡在循环里了。
      // 再让人点十次批准，是把 Agent 的毛病转嫁给用户。
      const actionKey = String(event.action_display ?? "");
      const times = (repeatCount.get(actionKey) ?? 0) + 1;
      repeatCount.set(actionKey, times);
      if (times >= 3) {
        console.log(`  ⛔ 第 ${times} 次要求同一条命令，自动拒绝`);
        host.broadcastNotice("deny", `它已经第 ${times} 次要求同一条命令，自动拒绝；建议换个说法或直接接管`);
        reply("reject");
        return;
      }

      // 判定顺序：禁止 → 记住 → 本轮授权 → 只读 → 问人
      const verdict = classifyApproval(event, remembered);
      const gk = grantKey(event);
      const granted = turnGrants.has(gk);

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

      // 卡片上只有命令，人判断不了后果；先单独说一句人话
      const note = explainAction(String(event.action_display ?? ""));
      if (note) host.broadcastNotice("deny", "⚠ " + note);

      if (granted) {
        console.log(`  · 本轮已允许同类（${gk}）：${String(event.action_display).slice(0, 40)}`);
        host.broadcastNotice("auto", `本轮已允许同类操作：${String(event.action_display).slice(0, 40)}`);
        reply("allow");
        return;
      }

      pending.set(event.request_id, { reply, key: treatKey(event), event });
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

  turnGrants.clear();

  // 拍快照：工作目录 + 桌面（东西多半往这两处放）
  const watchDirs = [CWD, join(homedir(), "Desktop")].filter((d) => existsSync(d));
  const before = new Map();
  for (const d of watchDirs) for (const [k, v] of snapshot(d)) before.set(k, v);
  try {
    const watchdog = setTimeout(() => {
      console.log("  \u26a0 120 秒无进展，判定为卡住");
      host.broadcastNotice("deny", "这一步超过 180 秒没有进展，已放开输入");
      host.broadcastTurn("stopped");
      running = false;
    }, 180_000);
    const r = await client.runTurn(text).finally(() => clearTimeout(watchdog));
    console.log("  本轮结束：" + r);
  } catch (err) {
    console.log("  出错：" + String(err));
  } finally {
    const stopped = !running; // 被停止/强杀的轮次不做产出判定
    if (!stopped) {
      const after = new Map();
      for (const d of watchDirs) for (const [k, v] of snapshot(d)) after.set(k, v);
      reportArtifacts(before, after);
    }

    running = false;
    if (turnWatch) { turnWatch(); turnWatch = null; }
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
  client.cancel(); // 先按协议请它停

  // 3 秒还没停下，就不再客气：直接杀进程
  const hard = setTimeout(() => {
    if (!running) return;
    console.log("  ⛔ 3 秒内没有停下，强制终止");
    client.kill("用户按了停止");
    host.broadcastNotice("deny", "Agent 没有在 3 秒内停止，已强制终止；下一句会开新会话");
    host.broadcastTurn("stopped");
    running = false;
  }, 3000);

  // 它自己停了，就把定时器撤掉
  turnWatch = () => clearTimeout(hard);
});

let running = false;
let turnWatch = null; // 停止时用来撤掉"强制终止"的定时器

console.log("  就绪。等你在手机上发话——服务端不会替你说任何话。");
console.log("");
console.log("  服务继续运行，Ctrl+C 退出。");
