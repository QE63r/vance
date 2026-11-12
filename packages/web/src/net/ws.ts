import { store } from "../model/store";
import type { ClientMsg } from "../model/types";
import { pushFrame } from "./frames";
import { clearCredentials, isAuthCloseCode, type Credentials } from "./credentials";

const RETRY_MS = [800, 1600, 3200, 8000];

let socket: WebSocket | null = null;
let retryTimer: number | null = null;

let currentToken = "";
let hasConnected = false;

/** 给 HTTP 接口用（/profile 等）：token 只放请求头，不进 URL */
export function getToken(): string {
  return currentToken;
}

/** 要看的会话：任务详情 hash / ?session=<id> / 旧 hash。没给就跟活动会话 */
function readSession(): string {
  const fromTask = /^#\/task\/(.+)$/.exec(location.hash);
  if (fromTask?.[1]) {
    try {
      return decodeURIComponent(fromTask[1]);
    } catch {
      /* 坏 id 就回落到默认会话 */
    }
  }
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, "")).get("session");
  const fromQuery = new URLSearchParams(location.search).get("session");
  return fromHash || fromQuery || "";
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

function wsUrl(token: string, session: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams({ token, device: deviceId() });
  if (session) q.set("session", session);
  return `${proto}//${location.host}/ws?${q.toString()}`;
}

export function send(msg: ClientMsg): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

export function boot(creds: Credentials): void {
  // 地址里的 token 已由 resolveCredentials 读走并从地址栏抹掉；这里只留会话参数
  const session = readSession();
  const token = creds.token;
  currentToken = token;

  const connect = (): void => {
    store.dispatch({ type: "connect" });
    const ws = new WebSocket(wsUrl(token, session));
    socket = ws;
    ws.binaryType = "blob";

    ws.onopen = () => {
      store.dispatch({ type: "open" });
      // 重连后主动 resync：host 的 attach 会补 hello/history/pending，
      // 但先到的 pending 可能在页面状态重置时丢掉；再要一次最稳。
      if (hasConnected) ws.send(JSON.stringify({ type: "resync" }));
      hasConnected = true;
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
      // 口令错 / 被拒：重试一万次也还是错，别自动重连；清掉本地凭据回配对页
      if (isAuthCloseCode(ev.code)) {
        clearCredentials(localStorage);
        return;
      }
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
