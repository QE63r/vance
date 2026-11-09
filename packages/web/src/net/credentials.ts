/**
 * 配对凭据：地址 + 口令。
 *
 * PWA 的限制：token 只能存在浏览器本地（localStorage），不是硬件安全存储。
 * 这里不碰网络，纯函数，方便单测。
 */

export interface Credentials {
  /** 电脑的公网入口 origin，例如 https://desktop-xxx.ts.net */
  endpoint: string;
  /** 32 位口令 */
  token: string;
}

export type PairingResult =
  | { ok: true; credentials: Credentials }
  | { ok: false; error: string };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocationLike {
  href: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

export const ENDPOINT_KEY = "vance_endpoint";
export const TOKEN_KEY = "vance_token";

function withScheme(input: string): string {
  const s = input.trim();
  if (!s) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

/**
 * 从“电脑上的完整地址”里取出口令。
 * 支持 ?token=… 和 #token=…；只接受 http/https。
 */
export function parsePairingLink(input: string): PairingResult {
  const raw = withScheme(input);
  if (!raw) return { ok: false, error: "把电脑上的完整地址粘进来" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "地址格式不对" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "只支持 http/https 地址" };
  }

  const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
  const token = url.searchParams.get("token") || fromHash || "";
  if (!token) return { ok: false, error: "链接里没有口令（?token=...）" };

  return { ok: true, credentials: { endpoint: url.origin, token } };
}

export function loadCredentials(storage: StorageLike): Credentials | null {
  try {
    const endpoint = storage.getItem(ENDPOINT_KEY)?.trim() ?? "";
    const token = storage.getItem(TOKEN_KEY)?.trim() ?? "";
    if (!endpoint || !token) return null;
    return { endpoint, token };
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials, storage: StorageLike): void {
  try {
    storage.setItem(ENDPOINT_KEY, creds.endpoint);
    storage.setItem(TOKEN_KEY, creds.token);
  } catch {
    /* 隐私模式写不进去：本次仍可连，下次要重新配对 */
  }
}

/** “忘记这台设备”：只清本地凭据，不动电脑上的已批准设备记录 */
export function clearCredentials(storage: StorageLike): void {
  try {
    storage.removeItem(ENDPOINT_KEY);
    storage.removeItem(TOKEN_KEY);
  } catch {
    /* 清不掉也不影响页面回到配对页 */
  }
}

/** token 只出现一次：读完后从地址栏抹掉，别留在截图/历史里 */
export function stripTokenFromUrl(url: URL): string {
  url.searchParams.delete("token");
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (hash.has("token")) {
    hash.delete("token");
    url.hash = hash.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * 启动时决定“直接进”还是“去配对页”：
 * 地址里有 token → 存下来并返回；否则读本地；再否则（dev）给测试口令。
 */
export function resolveCredentials(
  loc: LocationLike,
  storage: StorageLike,
  opts: { devToken?: string; replaceUrl?: (url: string) => void } = {},
): Credentials | null {
  let url: URL;
  try {
    url = new URL(loc.href);
  } catch {
    return loadCredentials(storage);
  }

  const parsed = parsePairingLink(loc.href);
  if (parsed.ok) {
    saveCredentials(parsed.credentials, storage);
    opts.replaceUrl?.(stripTokenFromUrl(url));
    return parsed.credentials;
  }

  const stored = loadCredentials(storage);
  if (stored) return stored;

  if (opts.devToken) return { endpoint: loc.origin, token: opts.devToken };
  return null;
}

/** WS 关闭码：4001 口令错、4004 设备被拒；这两种重试也没用 */
export function isAuthCloseCode(code: number): boolean {
  return code === 4001 || code === 4004;
}
