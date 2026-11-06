import { store } from "../model/store";
import type { ClientMsg } from "../model/types";
import { pushFrame } from "./frames";

const RETRY_MS = [800, 1600, 3200, 8000];

let socket: WebSocket | null = null;
let retryTimer: number | null = null;

/** token 只从前端拿：地址 hash → 查询串 → sessionStorage → dev 默认值 */
function readToken(): string {
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  const fromQuery = new URLSearchParams(location.search).get("token");
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem("vance_token");
  } catch {
    stored = null;
  }
  const devFallback = import.meta.env.DEV ? "dev" : "";
  const token = fromHash || fromQuery || stored || devFallback;
  if (token) {
    try {
      sessionStorage.setItem("vance_token", token);
    } catch {
      /* 隐私模式下写不进去也不影响本次连接 */
    }
  }
  // token 在 URL 里只出现这一次：立刻抹掉，别留在地址栏/截图/历史里
  if (fromHash || fromQuery) history.replaceState(null, "", location.pathname);
  return token;
}

function deviceId(): string {
  try {
    const saved = localStorage.getItem("vance_device");
    if (saved) return saved;
    const id = (crypto.randomUUID?.() ?? String(Math.random())).replace(/-/g, "").slice(0, 8);
    localStorage.setItem("vance_device", id);
    return id;
  } catch {
    return "anon";
  }
}

function wsUrl(token: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}&device=${deviceId()}`;
}

export function send(msg: ClientMsg): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

export function boot(): void {
  const token = readToken();

  const connect = (): void => {
    store.dispatch({ type: "connect" });
    const ws = new WebSocket(wsUrl(token));
    socket = ws;
    ws.binaryType = "blob";

    ws.onopen = () => {
      store.dispatch({ type: "open" });
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        let msg: unknown;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        store.dispatch({ type: "msg", msg: msg as never });
        return;
      }
      // 二进制 = 屏幕帧
      pushFrame(URL.createObjectURL(ev.data as Blob));
    };

    ws.onclose = (ev: CloseEvent) => {
      if (socket === ws) socket = null;
      store.dispatch({ type: "close", code: ev.code });
      // 口令错 / 被拒：重试一万次也还是错，别自动重连
      if (ev.code === 4001 || ev.code === 4004) return;
      const attempts = store.getSnapshot().link.attempts;
      const delay = RETRY_MS[Math.min(Math.max(attempts - 1, 0), RETRY_MS.length - 1)];
      retryTimer = window.setTimeout(connect, delay + Math.random() * 200);
    };

    ws.onerror = () => {
      /* onclose 一定会跟着来，这里不重复处理 */
    };
  };

  const reconnectNow = (): void => {
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    connect();
  };

  // 手机从后台切回来 / 网络恢复：立刻重连，不等退避
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconnectNow();
  });
  window.addEventListener("online", reconnectNow);

  connect();
}
