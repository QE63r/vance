/**
 * 原始字节的摘要 —— 批准就绑定在这个值上。
 *
 * 只做一件事：拿字节，算 sha256，返回 64 位十六进制。
 * 不做规范化、不看内容、不判断语义。任何"先解析再重新序列化"的做法都会
 * 让同一个动作在不同写法下算出不同摘要，那就不再是"批准我看到的这一条"了。
 *
 * [注意] 这个函数跑在 Agent Host（Node）上，不是在手机上。
 */

import { createHash } from "node:crypto";

/**
 * 对原始字节求 sha256。
 *
 * @param raw 收到的原始 payload 字节，必须与存进 raw_ref 的字节完全一致
 */
export function computeRawDigest(raw: Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * 把字符串按 UTF-8 编码后再求摘要。
 *
 * 只在"我们本来就是字符串来源"的场景用（比如测试）。
 * 真实链路上请直接对收到的字节求摘要，不要先解码成字符串再编码回来 ——
 * 那一步可能悄悄改变内容（BOM、换行、非法序列的替换字符）。
 */
export function computeRawDigestOfText(text: string): string {
  return computeRawDigest(new TextEncoder().encode(text));
}
