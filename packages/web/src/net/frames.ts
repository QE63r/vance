/**
 * 屏幕帧单独一个极小 store。
 *
 * 为什么不合进主 store：帧是 2 fps 的高频数据，进主 store 会让时间线每秒重渲染。
 * 这里只让画面小窗订阅；帧也永远不进时间线、不落历史。
 */
export interface Frame {
  url: string | null;
  at: number | null;
  frames: number;
}

let frame: Frame = { url: null, at: null, frames: 0 };
const listeners = new Set<() => void>();

export function pushFrame(url: string): void {
  const prev = frame.url;
  frame = { url, at: Date.now(), frames: frame.frames + 1 };
  for (const fn of listeners) fn();
  // 20fps 下立刻 revoke 可能把浏览器还没解码完的上一帧撤掉，画面会卡在某一帧。
  // 留 2 秒给解码/绘制；最多几十个 blob，内存可接受。
  if (prev && prev.startsWith("blob:")) {
    window.setTimeout(() => URL.revokeObjectURL(prev), 2000);
  }
}

export function getFrame(): Frame {
  return frame;
}

export function subscribeFrame(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
