// 把三块接起来：Host 网页 + ACP Agent + 决定回传。
// 启动后终端会打印一个地址，手机连同一个 wifi 打开即可。
import { createHash, randomBytes } from "node:crypto";
import { execSync, execFileSync, spawn } from "node:child_process";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostServer, lanEntries } from "../packages/host/dist/index.js";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { AcpClient, explainAction } from "../packages/adapter-opencode/dist/index.js";
import { classifyApproval, treatKey } from "../packages/policy/dist/index.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const LAB_REMOTE = join(REPO_ROOT, "labs", "remote", "tools");
// desktop shell 启动时 PATH 可能很干净；必须用绝对路径，不能靠 "powershell"。
const POWERSHELL = join(process.env.SystemRoot ?? "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const PAGE = join(HERE, "..", "packages", "host", "public", "index.html");
// 真前端的构建产物：默认用仓库里的 packages/web/dist，可用 VANCE_WEB_DIR 指到别处
const WEB_DIR = process.env.VANCE_WEB_DIR ?? join(HERE, "..", "packages", "web", "dist");

const CWD = process.argv[2] ?? "C:\\Users\\1\\Desktop\\梵境\\sandbox";
// 工作区档位自动放行的根目录：任务沙盒、桌面、Agent 写脚本的临时目录
const WORKSPACE_ROOTS = [...new Set([CWD, join(homedir(), "Desktop"), join(tmpdir(), "opencode")])];
const PROMPT = process.env.VANCE_PROMPT ?? process.argv[3] ?? "把 data.csv 删掉";
const PLAN_HINT =
  "\n\n（执行约束：只要这轮要写文件、删文件或运行脚本，必须先调用 vance_plan 工具提交计划，" +
  "等它返回 allowed 再执行；不要直接调用 bash/edit。工具名可能显示为 vance_plan 或 " +
  "vance-tools_vance_plan。纯读取、纯回答不需要计划。）";
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
// 已批准计划里的具体动作：planKey → 过期时间。只在 workspace 生效。
const planGrants = new Map();

/** 把一条动作归成"同类"：类型 + 程序 + 目录（只读 facts，不读命令方言） */
function grantKey(event) {
  const facts = event.facts ?? {};
  const kind = String(facts.kind ?? "other");
  const program = String(facts.program ?? "").toLowerCase();
  const paths = [facts.writes, facts.deletes, facts.reads].flatMap((v) => (Array.isArray(v) ? v : []));
  const dirs = paths
    .map((p) => String(p).split("\\").slice(0, -1).join("\\").toLowerCase())
    .filter(Boolean)
    .sort();
  return `${kind}|${program}|${[...new Set(dirs)].join(",")}`;
}

/**
 * 计划按“具体目标路径”匹配：写/删的路径，或要运行的脚本路径。
 * 不用程序名/目录，否则“计划改 a.txt”会顺手放行同目录的 b.txt。
 * 兼容 ACP facts 的两种形状：writes/deletes（结构化）和 files（“路径, 内容”）。
 */
function planPaths(event) {
  const facts = event?.facts ?? {};
  const raw = [facts.writes, facts.deletes]
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .map((p) => String(p).trim());
  if (typeof facts.script === "string" && facts.script.trim()) raw.push(facts.script.trim());
  if (Array.isArray(facts.moves)) {
    for (const m of facts.moves) {
      if (!m || typeof m !== "object") continue;
      if (typeof m.from === "string" && m.from.trim()) raw.push(m.from.trim());
      if (typeof m.to === "string" && m.to.trim()) raw.push(m.to.trim());
    }
  }
  if (typeof facts.files === "string" && facts.files.trim()) {
    for (const part of facts.files.split(",")) {
      const p = part.trim();
      if (/^[A-Za-z]:[\\/]/.test(p)) raw.push(p);
    }
  }
  return [...new Set(raw.map((p) => p.toLowerCase()).filter(Boolean))];
}

function planHasSpecificTarget(step) {
  return planPaths({ facts: step?.facts }).length > 0;
}

/** 只有动作的每个目标都在已批计划里，才自动放行；有未知目标就回到 C1。 */
function planCovered(event, planGrants, now) {
  const targets = planPaths(event);
  if (targets.length === 0) return false;
  return targets.every((p) => (planGrants.get(p) ?? 0) > now);
}
 // 同一条动作被要求的次数（防死循环）
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
        // 控制面仓库本身不是 Agent 的产出；我们改文档/代码时不能算进交付物。
        if (p.toLowerCase() === REPO_ROOT.toLowerCase()) continue;
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
  if (warnings.length === 0) return warnings;
  for (const w of warnings) console.log("  ⚠ " + w);
  host.broadcastNotice("deny", "产出检查：" + warnings.join("；"));
  return warnings;
}

function reportArtifacts(before, after) {
  const { added, changed, removed } = diffSnapshot(before, after);
  const warnings = inspectArtifacts([...added, ...changed]);
  const total = added.length + changed.length + removed.length;
  if (total === 0) {
    host.broadcastNotice("auto", "本轮没有产生文件变化（只是回答，没有动文件）");
    console.log("  📦 产出：无变化");
    return;
  }
  const short = (p) => p.split("\\").slice(-2).join("\\");
  const parts = [];
  if (added.length) parts.push(`新增 ${added.length}`);
  if (changed.length) parts.push(`改动 ${changed.length}`);
  if (removed.length) parts.push(`删除 ${removed.length}`);
  const names = [...added, ...changed, ...removed].slice(0, 4).map(short).join(" · ");
  // 结构化广播：手机产出区靠它列文件，不再解析上面那句文案
  host.broadcastArtifacts({ turnId: `turn-${Date.now()}`, added, changed, removed, warnings });
  console.log(`  📦 产出：${parts.join("，")}`);
  for (const p of [...added, ...changed].slice(0, 8)) console.log(`     + ${p}`);
}

const host = new HostServer({
  port: PORT,
  token,
  pagePath: PAGE,
  webDir: WEB_DIR,
  projectName: "sandbox",
  deviceStorePath: join(homedir(), ".vance", "devices.json"),
  artifactStoreFile: join(homedir(), ".vance", "artifacts.json"),
  policyFile: join(homedir(), ".vance", "policy.json"),
  undoDir: join(homedir(), ".vance", "undo"),
  pcPairPublic: true,
  // 不启用 approveAllDevices：配对只走“首台自动信任 / 已记录设备”。
  // 临时免审批只留给单测，不在启动器里开。
});

host.setAgents(
  [
    {
      id: "opencode",
      name: "Executor",
      kind: "acp",
      status: "connected",
      note: "opencode · ACP",
    },
  ],
  "opencode",
);

// 规则只在启动器手里：host 通过这两个口查询/撤销，不直接读 rules.json
host.onRules({
  list: () => [...remembered],
  revoke: (key) => {
    const i = remembered.indexOf(key);
    if (i < 0) return false;
    remembered.splice(i, 1);
    saveRules();
    console.log(`  ★ 已撤销规则：${key.slice(0, 60)}`);
    return true;
  },
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

// 从工作区切到完全权限时，已经把卡发到手机上的旧请求不该再挡着。
// 用户提档本身就是“这些非硬禁止动作都放”的明确选择；逐条自动批准，并留审计。
host.onProfileChange((profile) => {
  // 档位变了，旧计划的放行范围就不再可信；即使切回 workspace 也重新批。
  planGrants.clear();
  if (profile !== "full") return;
  const waiting = [...pending.keys()];
  if (waiting.length === 0) return;
  for (const requestId of waiting) host.resolveApproval(requestId, "allow", "auto-full");
  host.broadcastNotice("auto", `完全权限：已自动批准 ${waiting.length} 条等待中的操作`);
});

host.onPlanDecision((plan, decision) => {
  if (decision === "reject") {
    planGrants.clear();
    host.broadcastNotice("auto", "计划已拒绝，本次没有执行任何动作");
    return;
  }
  planGrants.clear();
  let grants = 0;
  for (const step of plan.steps ?? []) {
    if (!planHasSpecificTarget(step)) continue;
    for (const target of planPaths({ facts: step.facts })) {
      planGrants.set(target, plan.expires_at);
      grants += 1;
    }
  }
  if (grants > 0) {
    host.broadcastNotice("auto", `计划已批准：${grants} 项具体动作进入自动放行，计划外仍会问`);
    console.log(`  ★ 计划已批准：${grants} 项，plan=${plan.plan_id}`);
  } else {
    host.broadcastNotice("auto", "计划已批准，但没有可精确匹配的目标；后续动作仍按单步审批");
  }
});

// 撤销移动 = 用户反悔：清掉计划 grants，Agent 不能在同一计划里马上再移回去。
host.onUndo((planId, result) => {
  planGrants.clear();
  const text =
    result.failed > 0
      ? `撤销移动：${result.moved} 个已还原，${result.failed} 个失败；计划内自动已清空`
      : `已撤销 ${result.moved} 个移动；计划内自动已清空`;
  host.broadcastNotice("auto", text);
  console.log(
    `  ★ 撤销移动：moved=${result.moved} failed=${result.failed} plan=${planId}，已清空计划 grants`,
  );
});

const { port, urls } = await host.start();

// ── 实时画面：有手机连着才抓屏，没人看就停（不白烧 CPU） ──
let streamer = null;
let inputProc = null;
let lastHash = "";
let streamWatch = null;

function ensureRemoteInput() {
  if (inputProc) return inputProc;
  inputProc = spawn(
    POWERSHELL,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(LAB_REMOTE, "remote-input.ps1")],
    { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
  );
  inputProc.on("exit", () => {
    inputProc = null;
  });
  inputProc.on("error", () => {
    inputProc = null;
  });
  console.log("  ▶ 远控输入已接（鼠标/键盘）");
  return inputProc;
}

host.onRemoteInput((input) => {
  const proc = ensureRemoteInput();
  try {
    proc.stdin.write(JSON.stringify(input) + "\n");
  } catch {
    inputProc = null;
  }
});

function startStreamer() {
  if (streamer) return;
  const native = join(LAB_REMOTE, "screen-capture.exe");
  if (existsSync(native)) {
    streamer = spawn(native, ["-fps", "30", "-width", "960", "-quality", "42"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    console.log("  ▶ 实时画面已开启（原生抓屏 960 宽，目标 30 fps）");
  } else {
    streamer = spawn(
      POWERSHELL,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(LAB_REMOTE, "screen-stream.ps1"),
       "-Fps", "5", "-Width", "960", "-Quality", "55"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    console.log("  ▶ 实时画面已开启（PowerShell 回退，5 fps）");
  }

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
}, 1000);


// 挑一张「真实」的网卡：优先 WLAN / Wi-Fi / 以太网，跳过虚拟网卡
const entries = lanEntries(port);
const real =
  entries.find((e) => /Wi-?Fi|WLAN|以太网|Ethernet/i.test(e.iface) && !/vEthernet|Loopback/i.test(e.iface)) ??
  entries[0];

const url = `${real ? real.url : `http://127.0.0.1:${port}`}/app/#token=${token}`;

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

  // 如果隧道已经由 Tailscale Funnel 提供，直接用它（地址永久固定）。
  // v 的 PATH 里没有 tailscale，所以不能只靠命令名，必须找绝对路径。
  let funnelDone = false;
  const TS_CANDIDATES = [
    "C:\\Program Files\\Tailscale\\tailscale.exe",
    "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
    "tailscale",
  ];
  const tsExe = TS_CANDIDATES.find((p) => p === "tailscale" || existsSync(p)) ?? "tailscale";
  if (process.env.VANCE_FUNNEL === "1") try {
    const out = execFileSync(tsExe, ["funnel", "status"], { encoding: "utf8", timeout: 5000 });
    // Tailscale 的主机名可能是 desktop-xxx.tailnet-id.ts.net（多段子域名）
    const m = out.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\/?/i);
    const proxiesThisPort = new RegExp(`proxy\\s+http://127\\.0\\.0\\.1:${port}\\b`).test(out);
    if (m && proxiesThisPort) {
      const publicUrl = `${m[0].replace(/\/$/, "")}/app/#token=${token}`;
      console.log("");
      console.log("  ── 公网地址（Tailscale Funnel，永久固定）──────");
      console.log(`  ${publicUrl}`);
      console.log("");
      qrcode.generate(publicUrl, { small: true });
      console.log("  ────────────────────────────────────────");
      try {
        writeFileSync(join(homedir(), ".vance", "tunnel-url.txt"), publicUrl);
        void QRCode.toFile(join(homedir(), ".vance", "qr.png"), publicUrl, {
          width: 720, margin: 2, color: { dark: "#11181f", light: "#ffffff" },
        });
      } catch {}
      console.log("");
      funnelDone = true;
    } else if (m && !proxiesThisPort) {
      console.log("");
      console.log(`  ⚠ Tailscale Funnel 开着，但没有指向 127.0.0.1:${port}；先不用它。`);
      console.log(`     要固定地址：tailscale funnel --bg ${port}`);
      console.log("");
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
    const publicUrl = `https://${named.host}/app/#token=${token}`;
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
  const cf = spawn(exe, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate", "--protocol", "http2"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let seen = "";
  let printed = false;
  const scan = (chunk) => {
    seen += chunk.toString();
    // 只认真实隧道域名：cloudflared 的输出里也会出现 api.trycloudflare.com，
    // 那是 API 端点，不是隧道地址。
    const m = seen.match(/https:\/\/(?!api\.|www\.)[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && !printed) {
      printed = true;
      const baseUrl = m[0];
      const publicUrl = `${baseUrl}/app/#token=${token}`;

      // 分配了域名 ≠ 隧道已连通。先轮询 /health，真通了再出码；
      // 但最多等 120 秒，仍不通也把地址给出来（否则用户没有公网入口）。
      const publish = (warning = "") => {
        try {
          writeFileSync(join(homedir(), ".vance", "tunnel-url.txt"), publicUrl);
          void QRCode.toFile(join(homedir(), ".vance", "qr.png"), publicUrl, {
            width: 720,
            margin: 2,
            color: { dark: "#11181f", light: "#ffffff" },
          });
        } catch {}
        console.log("");
        console.log("  ────────────────────────────────────────");
        if (warning) console.log(`  ${warning}`);
        console.log("  【公网】手机用流量 / 不在同一个 wifi 时，扫这个：");
        console.log("");
        console.log(`  ${publicUrl}`);
        console.log("");
        qrcode.generate(publicUrl, { small: true });
        console.log("");
        console.log("  ⚠ 这个地址是公开可访问的，只发给自己；每次重启都会变。");
        console.log("  ────────────────────────────────────────");
        console.log("");
      };

      const waitReady = async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(4000) });
            if (res.ok) {
              publish();
              return;
            }
          } catch {
            /* 还没通，继续等 */
          }
        }
        publish("⚠ 隧道域名已分配，但 2 分钟内没确认连通；扫了打不开就重启 v。");
      };
      void waitReady();
    }
  };
  cf.stdout.on("data", scan);
  cf.stderr.on("data", scan);
  cf.on("exit", (code) => console.log(`  [tunnel] cloudflared 退出（${code}）`));
  }
  }
}

// 上次的会话 id：读到就试着接上，接不上自动开新的
const SESSION_FILE = join(homedir(), ".vance", "session.json");
let resumeId = "";
try {
  const saved = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  if (saved?.id) resumeId = String(saved.id);
} catch {}

// 「多久没新进展才算卡住」：每来一条步骤/一句话就重置，不能从开跑一直计时
let progressTimer = null;
let bumpProgress = () => {};

const client = new AcpClient(
  { cwd: CWD, projectId: "sandbox", resumeId },
  {
    onChat: (messageId, text) => {
      host.broadcastChat(messageId, text);
      bumpProgress();
    },
    onStep: (event) => {
      host.broadcast(event);
      bumpProgress();
      const s = event.step?.status ?? "pending";
      const mark = { pending: "○", running: "●", done: "✓", failed: "✗" }[s];
      console.log(`  ${mark} ${event.step?.title}`);
    },
    onApproval: (event, reply) => {
      // 判定顺序：禁止 → 策略档位 → 本轮授权 → 问人
      const verdict = classifyApproval(event, {
        remembered,
        profile: host.currentProfile,
        workspaceRoots: WORKSPACE_ROOTS,
      });
      const gk = grantKey(event);
      const granted = turnGrants.has(gk);

      if (verdict.deny) {
        console.log(`  ⛔ 拦截（${verdict.reason}）：${String(event.action_display).slice(0, 46)}`);
        host.broadcastNotice("deny", `已拦截：${verdict.reason}`);
        reply("reject");
        return;
      }

      if (verdict.auto) {
        console.log(`  · 自动放行（${verdict.reason}）：${String(event.action_display).slice(0, 46)}`);
        // 纯读太频繁，不上时间线；写/跑脚本才值得让用户知道
        if (event.facts?.effect !== "read") {
          host.broadcastNotice("auto", `已自动放行（免问）：${String(event.action_display).slice(0, 40)}`);
        }
        reply("allow");
        return;
      }

      // 计划内：只在 workspace 生效；read-only 不能靠计划放宽，full 已经自动放行。
      if (host.currentProfile === "workspace" && planCovered(event, planGrants, Date.now())) {
        console.log(`  · 计划内放行：${String(event.action_display).slice(0, 40)}`);
        host.broadcastNotice("auto", `计划内放行：${String(event.action_display).slice(0, 40)}`);
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

      // 只有"真正推到人面前"的请求才计数。自动放行的读不算，
      // 否则会刷出"第 9 次要求同一条命令"，但一张卡都没出。
      const actionKey = String(event.action_display ?? "");
      const times = (repeatCount.get(actionKey) ?? 0) + 1;
      repeatCount.set(actionKey, times);
      if (times >= 3) {
        host.broadcastNotice("auto", `它已经第 ${times} 次要求同一条命令，可能卡住了；这次仍然由你决定`);
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
    onError: (message) => {
      console.log("  [acp] 错误：" + String(message).slice(0, 160));
      host.broadcastNotice("deny", `Agent 出错：${String(message).slice(0, 160)}`);
    },
    onLog: (line) => console.log("  [acp] " + String(line).slice(0, 120)),
  },
);

let sessionId = await client.start();
// 会话一就绪就告诉 host：晚连的手机靠它拿到 session_id，早连的会收到一条 session 通知
host.useSession(sessionId, basename(CWD));
try {
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify({ id: sessionId, at: Date.now() }));
} catch {}
console.log("  session: " + sessionId);
console.log("");

// 任务生命周期：新开 / 真正切换。都要求当前没有一轮在跑，避免两轮抢同一个 ACP。
host.onSessionNew(async () => {
  if (running) throw new Error("任务在跑，先停");
  const id = await client.newSession();
  sessionId = id;
  planGrants.clear();
  turnGrants.clear();
  try {
    writeFileSync(SESSION_FILE, JSON.stringify({ id, at: Date.now() }));
  } catch {}
  console.log("  新任务 session: " + id);
  return id;
});
host.onSessionSwitch(async (id) => {
  if (running) throw new Error("任务在跑，先停");
  await client.loadSession(id);
  sessionId = id;
  planGrants.clear();
  turnGrants.clear();
  try {
    writeFileSync(SESSION_FILE, JSON.stringify({ id, at: Date.now() }));
  } catch {}
  console.log("  切到 session: " + id);
});


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
    bumpProgress = () => {
      if (!running) return;
      clearTimeout(progressTimer);
      progressTimer = setTimeout(() => {
        console.log("  ⚠ 180 秒没有新进展，判定为卡住");
        host.broadcastNotice("deny", "180 秒没有新进展，已放开输入");
        host.broadcastTurn("stopped");
        running = false;
      }, 180_000);
    };
    bumpProgress();
    const r = await client.runTurn(text + PLAN_HINT);
    console.log("  本轮结束：" + r);
  } catch (err) {
    console.log("  出错：" + String(err));
  } finally {
    clearTimeout(progressTimer);
    progressTimer = null;
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
        POWERSHELL,
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
  planGrants.clear();
  turnGrants.clear();
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
