import { describe, expect, it } from "vitest";
import { computeRawDigest, computeRawDigestOfText } from "../src/index.js";

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * D1 的核心：批准绑定的是"这一串字节"。
 * 所以这里要证明三件事：
 *   1. 同样的字节永远算出同样的值（可复现）
 *   2. 改一个字节就完全不同（不可伪造）
 *   3. 文字转字节的过程不偷偷改变内容（多字节安全）
 */
describe("raw_digest", () => {
  it("相同字节得到相同摘要", () => {
    const a = enc('{"command":"rm -rf src/legacy/"}');
    const b = enc('{"command":"rm -rf src/legacy/"}');
    expect(computeRawDigest(a)).toBe(computeRawDigest(b));
  });

  it("少一个斜杠就是另一次请求", () => {
    const a = computeRawDigestOfText('{"command":"rm -rf src/legacy/"}');
    const b = computeRawDigestOfText('{"command":"rm -rf src/legacy"}');
    expect(a).not.toBe(b);
  });

  it("多一个空格也是另一次请求", () => {
    const a = computeRawDigestOfText('{"command":"ls -la"}');
    const b = computeRawDigestOfText('{"command":"ls  -la"}');
    expect(a).not.toBe(b);
  });

  it("键的顺序不同 → 摘要不同（我们不重排字段）", () => {
    const a = computeRawDigestOfText('{"a":1,"b":2}');
    const b = computeRawDigestOfText('{"b":2,"a":1}');
    expect(a).not.toBe(b);
  });

  it("中文与 emoji 按 UTF-8 稳定编码", () => {
    const text = '{"note":"删除旧目录 ✅"}';
    expect(computeRawDigestOfText(text)).toBe(computeRawDigest(enc(text)));
  });

  it("输出是 64 位小写十六进制", () => {
    expect(computeRawDigestOfText("x")).toMatch(/^[a-f0-9]{64}$/);
  });
});
