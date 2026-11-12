/** PC 客户端入口判定：/pc 或 #/pc；不依赖手机 token。 */
export interface PcLocationLike {
  hash: string;
  search: string;
  pathname: string;
}

export function isPcLocation(loc: PcLocationLike): boolean {
  if (loc.hash.startsWith("#/pc")) return true;
  try {
    if (new URLSearchParams(loc.search).get("pc") === "1") return true;
  } catch {
    /* 坏 search 就当不是 */
  }
  return /^\/pc\/?$/.test(loc.pathname);
}

/** 同时读 ?demo=1 和 #/pc?demo=1；production 默认真实数据，dev 默认演示。 */
export function pcQuery(loc: PcLocationLike): URLSearchParams {
  const out = new URLSearchParams(loc.search);
  const hash = loc.hash;
  const q = hash.indexOf("?");
  if (q >= 0) {
    const extra = new URLSearchParams(hash.slice(q + 1));
    extra.forEach((value, key) => out.set(key, value));
  }
  return out;
}

export function isPcDemo(loc: PcLocationLike, dev: boolean): boolean {
  const q = pcQuery(loc);
  if (q.get("demo") === "1") return true;
  if (q.get("real") === "1") return false;
  return dev;
}
