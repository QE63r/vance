import { describe, expect, it } from "vitest";
import { initialState, reduce } from "../src/model/reduce";
import {
  clearCredentials,
  isAuthCloseCode,
  loadCredentials,
  parsePairingLink,
  resolveCredentials,
  saveCredentials,
  type StorageLike,
} from "../src/net/credentials";

/** 内存版 localStorage：测试不碰真实浏览器存储 */
function memStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("配对链接", () => {
  it("从完整地址里取出口令和入口", () => {
    const r = parsePairingLink("https://desktop-a.tailfa.ts.net/app/?token=abc123");
    expect(r).toEqual({
      ok: true,
      credentials: { endpoint: "https://desktop-a.tailfa.ts.net", token: "abc123" },
    });
  });

  it("支持 hash 口令和没写协议的地址", () => {
    const r = parsePairingLink("desktop-a.tailfa.ts.net/app/#token=xyz");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.credentials.endpoint).toBe("https://desktop-a.tailfa.ts.net");
      expect(r.credentials.token).toBe("xyz");
    }
  });

  it("没有口令 / 不是 http(s) 都明确报错", () => {
    expect(parsePairingLink("https://desktop-a.tailfa.ts.net/app/")).toEqual({
      ok: false,
      error: "链接里没有口令（?token=...）",
    });
    expect(parsePairingLink("ftp://desktop-a/app/?token=abc")).toEqual({
      ok: false,
      error: "只支持 http/https 地址",
    });
  });
});

describe("凭据存取", () => {
  it("保存、读取、清除", () => {
    const s = memStorage();
    expect(loadCredentials(s)).toBeNull();
    saveCredentials({ endpoint: "https://a.example", token: "t1" }, s);
    expect(loadCredentials(s)).toEqual({ endpoint: "https://a.example", token: "t1" });
    clearCredentials(s);
    expect(loadCredentials(s)).toBeNull();
  });

  it("地址里的 token 优先并落盘，随后从地址栏抹掉", () => {
    const s = memStorage();
    const replaced: string[] = [];
    const loc = {
      href: "https://a.example/app/?token=from-url&session=s1",
      origin: "https://a.example",
      pathname: "/app/",
      search: "?token=from-url&session=s1",
      hash: "",
    };
    const creds = resolveCredentials(loc, s, { replaceUrl: (u) => replaced.push(u) });
    expect(creds).toEqual({ endpoint: "https://a.example", token: "from-url" });
    expect(replaced).toEqual(["/app/?session=s1"]);
    expect(loadCredentials(s)).toEqual(creds);

    // 再打开时没有 token：用本地记住的
    const later = resolveCredentials({ ...loc, href: "https://a.example/app/", search: "" }, s);
    expect(later).toEqual(creds);
  });

  it("dev 没有凭据时给测试口令；生产没有就回配对页", () => {
    const loc = {
      href: "http://127.0.0.1:5173/",
      origin: "http://127.0.0.1:5173",
      pathname: "/",
      search: "",
      hash: "",
    };
    expect(resolveCredentials(loc, memStorage(), { devToken: "dev" })).toEqual({
      endpoint: "http://127.0.0.1:5173",
      token: "dev",
    });
    expect(resolveCredentials(loc, memStorage())).toBeNull();
  });
});

describe("错误口令", () => {
  it("4001/4004 不重连，状态进 rejected/denied", () => {
    expect(isAuthCloseCode(4001)).toBe(true);
    expect(isAuthCloseCode(4004)).toBe(true);
    expect(isAuthCloseCode(1006)).toBe(false);

    expect(reduce(initialState, { type: "close", code: 4001 }).link.phase).toBe("rejected");
    expect(reduce(initialState, { type: "close", code: 4004 }).link.phase).toBe("denied");
    expect(reduce(initialState, { type: "close", code: 1006 }).link.phase).toBe("reconnecting");
  });
});
