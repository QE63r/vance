/**
 * 控制面网关（P5 里程碑）。
 *
 * 硬约束：不解析事件明文，只转发密文或固定长度小帧；
 * 推送只做唤醒，不含动作详情。实现之前不要往这里放任何解析逻辑。
 */
export const RELAY_PROTOCOL_VERSION = "0.0.0";

export interface RelayOptions {
  port: number;
}

export function createRelay(options: RelayOptions): { port: number } {
  // TODO(P5-1): WebSocket 配对、盲转发、心跳、断连重连。
  return { port: options.port };
}
