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
  if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  for (const fn of listeners) fn();
}

export function getFrame(): Frame {
  return frame;
}

export function subscribeFrame(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
