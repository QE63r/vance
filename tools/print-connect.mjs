// 打印“现在能连的”地址 + 二维码。
// 不只读文件：先确认隧道真的通；不通就退回局域网，绝不把死码给人扫。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { lanEntries } from "../packages/host/dist/index.js";

const PORT = 8787;

function token() {
  try {
    return readFileSync(join(homedir(), ".vance", "token"), "utf8").trim();
  } catch {
    return "";
  }
}

function tunnelUrl() {
  try {
    return readFileSync(join(homedir(), ".vance", "tunnel-url.txt"), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * [学习注] 固定入口优先：Tailscale Funnel 开着且指向 8787 时，二维码必须是 .ts.net，
 * 不能给每次重启都会变的 trycloudflare。判断依据和 host-demo 保持一致。
 */
function funnelUrl(tk) {
  const candidates = [
    "C:\\Program Files\\Tailscale\\tailscale.exe",
    "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
    "tailscale",
  ];
  const exe = candidates.find((p) => p === "tailscale" || existsSync(p)) ?? "tailscale";
  try {
    const out = execFileSync(exe, ["funnel", "status"], { encoding: "utf8", timeout: 5000 });
    const m = out.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\/?/i);
    const proxiesThisPort = new RegExp(`proxy\\s+http://127\\.0\\.0\\.1:${PORT}\\b`).test(out);
    if (!m || !proxiesThisPort) return "";
    return `${m[0].replace(/\/$/, "")}/app/?token=${tk}`;
  } catch {
    return "";
  }
}

async function healthy(url) {
  try {
    const base = url.replace(/\/app\/.*$/, "");
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

function lanUrl(tk) {
  const entries = lanEntries(PORT);
  const real =
    entries.find((e) => /Wi-?Fi|WLAN|以太网|Ethernet/i.test(e.iface) && !/vEthernet|Loopback/i.test(e.iface)) ??
    entries[0];
  return `${real?.url ?? `http://127.0.0.1:${PORT}`}/app/?token=${tk}`;
}

const tk = token();
const fixed = funnelUrl(tk);
const tun = tunnelUrl();
console.log("  正在检查当前入口（最多 5 秒）…");
const fixedOk = fixed ? await healthy(fixed) : false;
const tunOk = !fixedOk && tun ? await healthy(tun) : false;
const target = fixedOk ? fixed : tunOk ? tun : lanUrl(tk);

console.log("");
console.log("  ────────────────────────────────────────");
if (fixedOk) {
  console.log("  【固定】手机用流量也能连，扫这个（重启后地址不变）：");
} else if (tunOk) {
  console.log("  【公网】手机用流量 / 不在同一个 wifi 时，扫这个：");
} else {
  if (tun) console.log("  ⚠ 公网隧道没连通或已过期，下面改用局域网地址：");
  else console.log("  【局域网】手机和电脑连同一个 wifi 时，扫这个：");
}
console.log("");
console.log(`  ${target}`);
console.log("");
qrcode.generate(target, { small: true });
console.log("");
try {
  await QRCode.toFile(join(homedir(), ".vance", "qr.png"), target, {
    width: 720,
    margin: 2,
    color: { dark: "#11181f", light: "#ffffff" },
  });
} catch {}
console.log("  扫不到就手动输入上面的地址。");
if (!fixedOk && !tunOk) console.log("  要公网：先确认 Tailscale Funnel，或重启 host 等公网隧道。");
console.log("  ────────────────────────────────────────");
console.log("");
