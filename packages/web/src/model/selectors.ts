import type { ApprovalEntry, State } from "./reduce";

export function pendingApprovals(s: State): ApprovalEntry[] {
  return Object.values(s.approvals).filter((a) => a.phase === "offered" || a.phase === "submitting");
}

export function pendingCount(s: State): number {
  return pendingApprovals(s).length;
}

export function linkReady(s: State): boolean {
  return s.link.phase === "ready";
}

/** 能不能打字：连接在、设备信、没有悬着的审批 */
export function canType(s: State): boolean {
  return linkReady(s) && s.device.phase === "trusted" && pendingCount(s) === 0;
}

/** 能不能发：执行轴在「没在跑」。unknown = 还没见过任何一轮，等同于可以开口 */
export function canSend(s: State): boolean {
  return (
    canType(s) &&
    (s.exec.phase === "unknown" ||
      s.exec.phase === "idle" ||
      s.exec.phase === "stopped" ||
      s.exec.phase === "error")
  );
}

export function canStop(s: State): boolean {
  return linkReady(s) && s.device.phase === "trusted" && s.exec.phase === "running";
}

export function canDecide(s: State): boolean {
  return linkReady(s) && s.device.phase === "trusted";
}

export function linkText(s: State): string {
  switch (s.link.phase) {
    case "connecting":
      return "连接中…";
    case "open":
      return "同步中…";
    case "ready":
      return "已连接";
    case "pairing":
      return "等待确认";
    case "denied":
      return "已拒绝";
    case "rejected":
      return "口令无效";
    case "reconnecting":
      return "已断开，重连中";
  }
}

export function execText(s: State): string {
  const suffix = linkReady(s) ? "" : " · 最后已知";
  switch (s.exec.phase) {
    case "unknown":
      return "状态未知";
    case "idle":
      return "空闲" + suffix;
    case "running":
      return "执行中" + suffix;
    case "stopped":
      return "已停止" + suffix;
    case "error":
      return "出错" + suffix;
  }
}

export function deviceText(s: State): string {
  switch (s.device.phase) {
    case "trusted":
      return "已配对";
    case "pending":
      return "等待允许";
    case "denied":
      return "配对被拒";
    case "unknown":
      return "未识别";
  }
}

export function hintText(s: State, now: number): string {
  if (s.link.phase === "pairing" || s.device.phase === "pending") return "这台设备还没被允许，请在已有设备上点允许";
  if (s.link.phase === "rejected") return "口令无效，重新扫一次码";
  if (s.link.phase === "denied") return "这台设备已被拒绝接入";
  if (s.link.phase === "connecting" || s.link.phase === "open") return "正在连上电脑…";
  if (s.link.phase === "reconnecting") return "连不上，正在重试；恢复后这句话会发出去";
  if (pendingCount(s) > 0) return "先处理上面的审批，它在等你";
  if (s.exec.phase === "running") return "正在执行，等它停下来再发";
  if (s.exec.phase === "stopped") return "已停止 · 下一句会开新会话";
  if (s.exec.phase === "error") return "上一轮出错，可以直接再发一句";
  return "空闲，可以继续说";
}

export function approvalRemaining(entry: ApprovalEntry, now: number): number {
  if (entry.phase !== "offered" && entry.phase !== "submitting") return 0;
  return Math.max(0, Math.floor((entry.event.expires_at - now) / 1000));
}

export function latestArtifacts(s: State) {
  for (let i = s.timeline.length - 1; i >= 0; i--) {
    const item = s.timeline[i];
    if (item.kind === "artifacts") return item;
  }
  return null;
}
