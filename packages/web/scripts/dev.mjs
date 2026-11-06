/**
 * `npm run dev` 的入口：先起假 host，再起 Vite。
 * 两件事在同一个终端里，Ctrl+C 一起停。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const hostFile = fileURLToPath(new URL("../mock/host.mjs", import.meta.url));

const host = spawn(process.execPath, [hostFile], { stdio: "inherit" });
host.on("exit", (code) => {
  if (code && code !== 0) console.error(`[dev] mock host 退出：${code}`);
});

const server = await createServer({
  root: webRoot,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
});
await server.listen();
server.printUrls();
console.log("\n  打开上面的地址即可（dev 默认口令 dev，不需要扫码）。\n");

const stop = () => {
  try {
    host.kill();
  } catch {
    /* 已经退了 */
  }
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
