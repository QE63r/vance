// 已经在跑的时候，打印手机能用的局域网地址。
// 单独成文件，避免在 .cmd 里拼 PowerShell / JS 的引号。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { lanEntries } from "../packages/host/dist/index.js";

const PORT = 8787;
let token = "";
try {
  token = readFileSync(join(homedir(), ".vance", "token"), "utf8").trim();
} catch {}

const entries = lanEntries(PORT);
const real =
  entries.find((e) => /Wi-?Fi|WLAN|以太网|Ethernet/i.test(e.iface) && !/vEthernet|Loopback/i.test(e.iface)) ??
  entries[0];

if (real) {
  console.log(`  局域网：${real.url}/app/?token=${token}`);
  console.log(`  网卡：${real.iface}  地址：${real.address}`);
} else {
  console.log(`  本机：http://127.0.0.1:${PORT}/app/?token=${token}`);
  console.log("  没找到局域网 IPv4，手机可能连不上；检查 wifi 或用手机热点。");
}
