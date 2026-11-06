// 一次性配置：把你的域名绑到这台电脑上，之后地址永久不变。
//
// 用法：node tools/setup-tunnel.mjs vance.你的域名.com
//
// 前提：
//   1. 域名已经托管到 Cloudflare（NS 指向 Cloudflare 给的两个地址）
//   2. 本机装了 cloudflared（已装）
//
// 需要你人工做的只有一步：浏览器里点"授权"。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const host = process.argv[2];
if (!host || !host.includes(".")) {
  console.error("用法: node tools/setup-tunnel.mjs vance.example.com");
  process.exit(1);
}

const CF =
  ["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"].find(
    (p) => existsSync(p),
  ) ?? "cloudflared";

const NAME = "vance";
const cert = join(homedir(), ".cloudflared", "cert.pem");
const cfgDir = join(homedir(), ".vance");
const cfgFile = join(cfgDir, "tunnel.json");

function run(args, { inherit = false, allowFail = false } = {}) {
  console.log(`\n> cloudflared ${args.join(" ")}`);
  const r = spawnSync(CF, args, { stdio: inherit ? "inherit" : "pipe", encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (out && !inherit) console.log(out.split("\n").slice(-4).join("\n"));
  if (r.status !== 0 && !allowFail) {
    console.error("失败，退出码", r.status);
    process.exit(1);
  }
  return out;
}

// 1. 登录（没登录过就打开浏览器）
if (!existsSync(cert)) {
  console.log("\n需要先在浏览器里授权一次（会弹出来，点允许）…");
  run(["tunnel", "login"], { inherit: true });
} else {
  console.log("\n已登录过 Cloudflare（找到 cert.pem），跳过登录");
}

// 2. 建隧道（已存在就复用）
const created = run(["tunnel", "create", NAME], { allowFail: true });
const existed = /already exists|already have/i.test(created);
console.log(existed ? `隧道 ${NAME} 已存在，复用` : `隧道 ${NAME} 已创建`);

// 3. 绑定 DNS
run(["tunnel", "route", "dns", NAME, host], { allowFail: true });

// 4. 记下配置，启动脚本据此走命名隧道
mkdirSync(cfgDir, { recursive: true });
writeFileSync(cfgFile, JSON.stringify({ name: NAME, host }, null, 2));

console.log(`
完成。

  固定地址： https://${host}/?token=<你的口令>
  配置写入： ${cfgFile}

下一步：
  1. 重启梵境（关掉现在的窗口，重新 v）
  2. 手机上打开上面的地址，存成书签——以后电脑重启也不用换

注意：第一次访问可能要等 Cloudflare 下发证书，最多一两分钟。
`);
