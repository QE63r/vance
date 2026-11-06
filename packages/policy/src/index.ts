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
  /** true = 永久禁止，连"批准"都不给 */
  deny?: boolean;
  /** 人话理由，会写进日志，也可能显示在手机上 */
  reason: string;
}

const ASK = (reason: string): Verdict => ({ auto: false, reason });
const ALLOW = (reason: string): Verdict => ({ auto: true, reason });
const DENY = (reason: string): Verdict => ({ auto: false, deny: true, reason });

/**
 * 永久禁止：这些不是"要不要问"，是"不允许"。
 *
 * 原则：**不可逆 + 超出项目范围**。
 * 删一个项目里的文件可以重来，格式化磁盘、改系统账户、把密钥传出去不行。
 *
 * 这个列表是硬编码的，不读用户配置——用户不能给自己开后门，
 * 否则"禁止"就退化成了"默认拒绝但可以批"。
 */
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

/** 这些路径上的"写"操作一律禁止（读不受影响） */
const DENY_PATH: Array<[RegExp, string]> = [
  [/c:\\windows\\/i, "系统目录"],
  [/c:\\program files/i, "系统程序目录"],
  [/c:\\programdata/i, "系统数据目录"],
  [/\\\.ssh\\/i, "SSH 凭据"],
  [/\\\.aws\\/i, "云凭据"],
  [/\\\.config\\opencode/i, "Agent 自身配置"],
  [/(id_rsa|id_ed25519|\.pem)$/i, "私钥文件"],
  [/^[a-z]:\\?$/i, "磁盘根目录"],
];

/** 看起来像"会写"的命令动词，用来决定路径禁令是否适用 */
const WRITE_VERB = /(remove-item|\bdel\b|\brm\b|\bmove\b|\bmv\b|\bcopy\b|\bset-content\b|\bout-file\b|\bnew-item\b|\badd-content\b|>\s*)/i;

/** 检查是否命中永久禁止 */
export function checkDeny(event: {
  action_display?: string;
  facts?: Record<string, unknown>;
}): Verdict | null {
  const action = (event.action_display ?? "").trim();
  const kind = String(event.facts?.kind ?? "unknown");
  const files = String(event.facts?.files ?? "");
  const haystack = `${action}\n${files}`;

  for (const [re, why] of DENY_COMMAND) {
    if (re.test(action)) return DENY(`${why}：永久禁止`);
  }

  // 路径禁令只对"写"生效：读系统目录是正常需求
  const isWrite = kind === "edit" || (kind === "execute" && WRITE_VERB.test(action));
  if (isWrite) {
    for (const [re, why] of DENY_PATH) {
      if (re.test(haystack)) return DENY(`${why}：不可写入`);
    }
  }

  return null;
}

/** 判断一条 shell 命令能否静默放行 */
export function classifyCommand(command: string): Verdict {
  const cmd = command.trim();
  if (!cmd) return ASK("空命令");

  // 子表达式 / 反引号：里面可以塞任何东西
  if (cmd.includes("$(") || cmd.includes("`")) return ASK("含子表达式，无法静态判断");

  // 重定向：读命令也能写文件。
  // 但 `> $null` 是把输出丢掉，不会写任何文件——这种不该问人。
  const withoutNullSink = cmd.replace(/\d?>\s*\$null/gi, " ");
  if (/[<>]/.test(withoutNullSink)) return ASK("含重定向");

  // 调用运算符 &（PowerShell 里可以执行任意程序）
  if (cmd.includes("&")) return ASK("含调用运算符");

  // 拆成若干段：; | 换行 都会接出新命令
  const segments = cmd
    .split(/[;|\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return ASK("空命令");

  // 只改「当前这个终端」的设置：编码、shell 变量。
  // 它们不碰磁盘、不影响别的东西——今天为了读一个中文文件，
  // Agent 为这类命令连问了七八次，纯噪音。
  const isShellSetup = (seg: string): boolean =>
    /^(\$env:[A-Za-z0-9_]+\s*=|\[console\]::(outputencoding|inputencoding)\s*=|chcp(\s|$))/i.test(seg);

  for (const seg of segments) {
    if (isShellSetup(seg)) continue;

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

/** 一条动作的"记住"键：同一条动作重复出现时，用来判断要不要再问 */
export function treatKey(event: { action_display?: string; facts?: Record<string, unknown> }): string {
  const kind = String(event.facts?.kind ?? "unknown");
  return `${kind}:${(event.action_display ?? "").trim()}`;
}

/**
 * 判断一条审批请求：禁止 → 记住 → 只读 → 其余。
 *
 * 顺序很重要：**"禁止"必须排在"记住"前面**。
 * 否则用户曾经批准过一次，就把它变成了永久放行——那是最危险的后门。
 */
export function classifyApproval(
  event: {
    action_display?: string;
    facts?: Record<string, unknown>;
  },
  remembered: string[] = [],
): Verdict {
  const denied = checkDeny(event);
  if (denied) return denied;

  if (remembered.includes(treatKey(event))) {
    return ALLOW("你之前批准过同样的操作");
  }

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
