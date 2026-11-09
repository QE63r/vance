// 打印“现在能连的”地址 + 二维码。
// 不只读文件：先确认隧道真的通；不通就退回局域网，绝不把死码给人扫。
import { readFileSync } from "node:fs";
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
const tun = tunnelUrl();
console.log("  正在检查当前入口（最多 5 秒）…");
const tunOk = tun ? await healthy(tun) : false;
const target = tunOk ? tun : lanUrl(tk);

console.log("");
console.log("  ────────────────────────────────────────");
if (tunOk) {
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
if (!tunOk) console.log("  要公网：关掉 host 后重新按 v，等终端出现【公网】。");
console.log("  ────────────────────────────────────────");
console.log("");
