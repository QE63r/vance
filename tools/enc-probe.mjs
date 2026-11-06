// 只用 args 数组，避免嵌套引号；由外层 cmd 决定代码页。
import { spawnSync } from "node:child_process";

const PS =
  "Get-ChildItem 'C:\\Users\\1\\Desktop\\梵境' -File | Select-Object -First 2 -ExpandProperty Name";

const r = spawnSync("powershell", ["-NoProfile", "-Command", PS], { encoding: "buffer" });
const raw = r.stdout ?? Buffer.alloc(0);

if (raw.length === 0) {
  console.log("stdout 为空；stderr =", (r.stderr ?? Buffer.alloc(0)).toString("utf8").slice(0, 200));
  process.exit(0);
}

console.log("  原始字节:", raw.length);
console.log("  按 UTF-8 解:", JSON.stringify(raw.toString("utf8").trim()));
console.log("  按 GBK   解:", JSON.stringify(new TextDecoder("gbk").decode(raw).trim()));
