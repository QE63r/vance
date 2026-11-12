import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { PairScreen } from "./app/PairScreen";
import { store } from "./model/store";
import { applyTheme, loadTheme } from "./app/theme";
import { ENDPOINT_KEY, TOKEN_KEY, resolveCredentials } from "./net/credentials";
import { boot } from "./net/ws";
import { PcApp } from "./pc/PcApp";
import { isPcLocation } from "./pc/pcMode";
import "./styles.css";
import "./shell.css";

const root = document.getElementById("root");
if (!root) throw new Error("没有 #root");

// 先定主题，再挂载，避免刷新时先闪一下白/黑
applyTheme(loadTheme());

if (isPcLocation(window.location)) {
  // PC 客户端：本地页面，不抢手机 token，也不启动手机 WS。
  createRoot(root).render(<PcApp />);
} else {
// 旧版把 token 放在 sessionStorage；升级后顺手搬到 localStorage，别让当前这台手机重新扫一次
try {
  if (!localStorage.getItem(TOKEN_KEY)) {
    const legacy = sessionStorage.getItem(TOKEN_KEY);
    if (legacy) {
      localStorage.setItem(TOKEN_KEY, legacy);
      localStorage.setItem(ENDPOINT_KEY, location.origin);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }
} catch {
  /* 隐私模式：搬不过去就回配对页 */
}

const creds = resolveCredentials(window.location, localStorage, {
  devToken: import.meta.env.DEV ? "dev" : undefined,
  replaceUrl: (url) => history.replaceState(null, "", url),
});

let sameOrigin = true;
try {
  sameOrigin = new URL(creds?.endpoint ?? location.origin).origin === location.origin;
} catch {
  sameOrigin = false;
}

if (creds && !sameOrigin) {
  // 装在这个入口的 PWA 只能连这个入口；跨入口就交给对方页面自己配对
  location.replace(`${creds.endpoint}/app/?token=${encodeURIComponent(creds.token)}`);
} else if (creds) {
  createRoot(root).render(<App />);
  boot(creds);
} else {
  createRoot(root).render(<PairScreen />);
}

// dev 下暴露状态，供截图脚本核对「四轴没有互相覆盖」
if (import.meta.env.DEV) {
  (window as unknown as { __vance: () => unknown }).__vance = () => store.getSnapshot();
}

// 只在该构建的 /app/ 下注册；dev 不注册，免得 SW 缓存干扰热更新
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .then((registration) => {
        // 新构建上线后让新 SW 接管，并自动刷新一次，避免手机上一直跑旧 JS。
        registration.update().catch(() => undefined);
        let reloading = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloading) return;
          reloading = true;
          window.location.reload();
        });
      })
      .catch(() => {
        /* 注册失败仍可当普通网页用 */
      });
  });
}
}
