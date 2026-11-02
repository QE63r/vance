/**
 * 静默放行策略 —— "安静"这两个字的实现。
 *
 * 目标：读操作不再打扰人，写操作照旧要问。
 *
 * 设计原则只有一条：**保守到会误伤，也不能放过任何组合**。
 * 判断的是"整条命令的每一段"，不是开头。
 *   Get-ChildItem; Remove-Item x     → 开头是读，但它删东西
 *   Get-Content a > b                → 读，但重定向会写文件
 *   所以出现分隔符、重定向、子表达式时，逐段检查，任何一段不认识就问人。
 */

/** 允许静默放行的命令（只读类）。每条都可以带任意参数。 */
const READ_ONLY = new Set([
  "get-childitem", "get-content", "get-item", "test-path", "select-string",
  "measure-object", "select-object", "sort-object", "format-table", "format-list",
  "where-object", "group-object", "compare-object", "resolve-path", "get-location",
  "ls", "dir", "cat", "type", "head", "tail", "grep", "rg", "find", "wc",
  "pwd", "echo", "tree",
]);

export interface Verdict {
  /** true = 不必打扰人，直接放行 */
  auto: boolean;
  /** 人话理由，会写进日志，也可能显示在手机上 */
  reason: string;
}

const ASK = (reason: string): Verdict => ({ auto: false, reason });
const ALLOW = (reason: string): Verdict => ({ auto: true, reason });

/** 判断一条 shell 命令能否静默放行 */
export function classifyCommand(command: string): Verdict {
  const cmd = command.trim();
  if (!cmd) return ASK("空命令");

  // 子表达式 / 反引号：里面可以塞任何东西
  if (cmd.includes("$(") || cmd.includes("`")) return ASK("含子表达式，无法静态判断");

  // 重定向：读命令也能写文件
  if (/[<>]/.test(cmd)) return ASK("含重定向");

  // 调用运算符 &（PowerShell 里可以执行任意程序）
  if (cmd.includes("&")) return ASK("含调用运算符");

  // 拆成若干段：; | 换行 都会接出新命令
  const segments = cmd
    .split(/[;|\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return ASK("空命令");

  for (const seg of segments) {
    const parts = seg.split(/\s+/);
    const head = parts[0]?.toLowerCase() ?? "";

    // git 要单独看子命令：status/diff/log 是只读，commit/push/checkout 不是
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

/** 判断一条审批请求能否静默放行 */
export function classifyApproval(event: {
  action_display?: string;
  facts?: Record<string, unknown>;
}): Verdict {
  const action = (event.action_display ?? "").trim();
  const kind = String(event.facts?.kind ?? "unknown");

  // 文件/目录访问类：ACP 给的 title 就是个路径，没有"动作"可言。
  // 这类请求本身不产生修改，直接放行；否则人只会看到一个路径然后瞎猜。
  if (kind === "other" || kind === "read") {
    if (action && !/\s/.test(action)) return ALLOW("读取路径");
    return ASK("无法判断该访问的意图");
  }

  if (kind === "execute") return classifyCommand(action);

  // edit / webfetch / 未知类型：一律问人
  return ASK(`类型 ${kind} 需要人工确认`);
}
