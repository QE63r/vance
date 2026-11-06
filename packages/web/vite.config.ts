import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      // mock/ 不需要热更新；Windows 上盯着它会让编辑器写临时文件时 EBUSY 崩掉 Vite
      ignored: ["**/mock/**", "**/*.tmpdir/**", "**/.*.tmpdir/**"],
    },
    proxy: {
      // 页面和 WS 同源：浏览器连 /ws，Vite 转给本机的 host（dev 时是 mock/host.mjs）
      "/ws": {
        target: "ws://127.0.0.1:8787",
        ws: true,
        // 断网演练会主动踢连接，代理会抛 ECONNRESET；那是预期的，别刷一屏红字
        configure: (proxy) => {
          proxy.on("error", (err) => {
            const code = (err as unknown as { code?: string }).code;
            if (code !== "ECONNRESET" && code !== "EPIPE") console.warn("[vite] ws 代理出错：", err.message);
          });
        },
      },
    },
  },
});
