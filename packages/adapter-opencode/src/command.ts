/**
 * 命令方言层：只属于适配器。
 *
 * 判断一条 shell 命令"看起来是不是只读"、有没有碰永久禁止的操作——
 * 这是 PowerShell/cmd 的知识，不该进控制面的策略层。
 *
 * 策略层只读这里产出的 facts（effect / danger），不认识 Remove-Item。
 */

export interface CommandVerdict {
  auto: boolean;
  deny?: boolean;
  reason: string;
}

const ASK = (reason: string): CommandVerdict => ({ auto: false, reason });
const ALLOW = (reason: string): CommandVerdict => ({ auto: true, reason });
const DENY = (reason: string): CommandVerdict => ({ auto: false, deny: true, reason });

/** 允许自动放行的命令（只读类，免问）。每条都可以带任意参数。 */
const READ_ONLY = new Set([
  "get-childitem", "get-content", "get-item", "test-path", "select-string",
  "measure-object", "select-object", "sort-object", "format-table", "format-list",
  "where-object", "group-object", "compare-object", "resolve-path", "get-location",
  "out-string", "out-host", "write-output", "write-host", "convertto-json", "convertto-csv",
  "get-command", "get-help", "get-process",
  "ls", "dir", "cat", "type", "head", "tail", "grep", "rg", "find", "wc",
  "pwd", "echo", "tree",
]);

/** 永久禁止：不可逆 + 超出项目范围。 */
const DENY_COMMAND: Array<[RegExp, string]> = [
  [/\b(format-volume|clear-disk|diskpart|mkfs)\b/i, "磁盘级操作"],
  [/\b(shutdown|restart-computer|stop-computer)\b/i, "关机/重启"],
  [/\bnet\s+user\b|\breg\s+add\s+hklm/i, "修改系统账户或注册表"],
  [/\bset-executionpolicy\b/i, "修改系统执行策略"],
  [/\binvoke-expression\b|\biex\b/i, "动态执行代码"],
  [/\|\s*(sh|bash|zsh)\s*$/i, "下载后直接执行"],
  [/\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(iex|sh|bash)/i, "下载后直接执行"],
  [/\b(rclone|scp|sftp)\b/i, "向外传输文件"],
];

const KILL_VERB = /(stop-process|taskkill|\bkill\b|\bkillall\b)/i;
const CRITICAL_PROC = /\b(winlogon|csrss|dwm|lsass|services|smss|wininit)\b/i;

/** 永久禁止类：返回人话理由；没有就返回 null（由策略执行 DENY） */
export function dangerOf(command: string): string | null {
  const cmd = command.trim();
  for (const [re, why] of DENY_COMMAND) {
    if (re.test(cmd)) return why;
  }
  if (KILL_VERB.test(cmd) && CRITICAL_PROC.test(cmd)) return "结束系统关键进程";
  return null;
}

/** 判断一条 shell 命令能否自动放行（只读意图，免问） */
export function classifyCommand(command: string): CommandVerdict {
  const cmd = command.trim();
  if (!cmd) return ASK("空命令");

  if (cmd.includes("$(") || cmd.includes("`")) return ASK("含子表达式，无法静态判断");

  const withoutNullSink = cmd.replace(/\d?>\s*\$null/gi, " ");
  if (/[<>]/.test(withoutNullSink)) return ASK("含重定向");
  if (cmd.includes("&")) return ASK("含调用运算符");

  const segments = cmd
    .split(/[;|\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return ASK("空命令");

  const isShellSetup = (seg: string): boolean =>
    /^(\$env:[A-Za-z0-9_]+\s*=|\[console\]::(outputencoding|inputencoding)\s*=|chcp(\s|$))/i.test(seg);

  for (const seg of segments) {
    if (isShellSetup(seg)) continue;

    const parts = seg.split(/\s+/);
    const head = parts[0]?.toLowerCase() ?? "";

    if (head === "git") {
      const sub = parts[1]?.toLowerCase() ?? "";
      if (["status", "diff", "log", "show", "branch", "remote", "rev-parse"].includes(sub)) continue;
      return ASK(`git ${sub || "(无子命令)"} 不是只读操作`);
    }

    if (!READ_ONLY.has(head)) {
      return ASK(`含非只读命令：${head || seg.slice(0, 20)}`);
    }
  }

  return ALLOW(segments.length > 1 ? "只读命令（含管道）" : "只读命令");
}

/** 把"这条命令实际上会发生什么"翻译成人话（展示用，不参与判定） */
export function explainAction(action: string): string | null {
  const a = action.trim();

  if (/(stop-process|taskkill)[^\n]*explorer/i.test(a)) {
    return "这会结束 Windows 资源管理器：桌面和任务栏会消失几秒（通常会自动恢复），打开着的文件夹窗口会被关掉。";
  }
  if (KILL_VERB.test(a) && /\b(chrome|msedge|firefox|code|winword|excel|wps)\b/i.test(a)) {
    return "这会强制关掉程序，没保存的内容会丢。";
  }
  if (KILL_VERB.test(a)) {
    return "这会强制结束进程，未保存的工作可能丢失。";
  }
  return null;
}
