import { describe, expect, it } from "vitest";
import { isPcDemo, isPcLocation, pcQuery } from "../src/pc/pcMode";

const loc = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });

describe("PC 客户端入口", () => {
  it("识别 /pc、#/pc 和 ?pc=1，不抢手机 /app", () => {
    expect(isPcLocation(loc("/pc"))).toBe(true);
    expect(isPcLocation(loc("/pc/"))).toBe(true);
    expect(isPcLocation(loc("/app/", "", "#/pc"))).toBe(true);
    expect(isPcLocation(loc("/app/", "?pc=1"))).toBe(true);
    expect(isPcLocation(loc("/app/", "", "#/overview"))).toBe(false);
    expect(isPcLocation(loc("/app/"))).toBe(false);
  });

  it("演示默认只在 dev；?real=1 强制真实，?demo=1 强制演示", () => {
    expect(isPcDemo(loc("/pc"), true)).toBe(true);
    expect(isPcDemo(loc("/pc"), false)).toBe(false);
    expect(isPcDemo(loc("/pc", "?demo=1"), false)).toBe(true);
    expect(isPcDemo(loc("/pc", "?real=1"), true)).toBe(false);
    expect(isPcDemo(loc("/app/", "", "#/pc?demo=1"), false)).toBe(true);
  });

  it("hash query 与 search 合并，hash 优先", () => {
    const q = pcQuery(loc("/app/", "?demo=1&view=setup", "#/pc?view=home"));
    expect(q.get("demo")).toBe("1");
    expect(q.get("view")).toBe("home");
  });
});
