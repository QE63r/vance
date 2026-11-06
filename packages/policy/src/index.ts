/**
 * 风险策略 —— 只读「事实」，不读命令文本。
 *
 * 为什么：命令是 Agent 的方言（shell 动词、重定向、系统路径），解析它属于适配器。
 * 控制面如果去认这些写法，换一个 Agent 就得重写一遍。
 *
 * 适配器把"要动什么"翻译成 facts：
 *   kind / effect / writes / reads / deletes / program / script / danger
 * 这里只对 facts 做判定：禁止 → 记住 → 按权限档位放行/问人。
 *
 * 文本（action_display）只用于展示，永远不参与判定。
 */

export type Profile = "read-only" | "workspace" | "full";

export interface PolicyOptions {
  /** 当前权限档位，默认 workspace（工作区） */
  profile?: Profile;
  /** 工作区根目录；为空时工作区档不会自动放行写操作 */
  workspaceRoots?: string[];
  /** 用户点过「记住」的规则键 */
  remembered?: string[];
}

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

/** 这些路径上的"写/删"一律禁止（读不受影响）。这是机器边界，不是 Agent 方言。 */
const DENY_PATH: Array<[RegExp, string]> = [
  [/c:\\windows\\/i, "不能写 Windows 系统目录"],
  [/c:\\program files/i, "不能往 Program Files 里写文件"],
  [/c:\\programdata/i, "不能往 ProgramData 里写文件"],
  [/\\\.ssh\\/i, "不能动 SSH 密钥目录"],
  [/\\\.aws\\/i, "不能动云凭据目录"],
  [/\\\.config\\opencode/i, "不能改 Agent 自己的配置"],
  [/(id_rsa|id_ed25519|\.pem)$/i, "不能动私钥文件"],
  [/^[a-z]:\\?$/i, "不能直接操作整个磁盘根目录"],
];

/** 程序名本身就不该跑（适配器报上来的 program，不是从命令里猜） */
const DENY_PROGRAM = new Set(["format", "diskpart", "mkfs", "shutdown", "bcdedit"]);

type Facts = Record<string, unknown>;

function factList(facts: Facts, key: string): string[] {
  const value = facts[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function factString(facts: Facts, key: string, fallback = ""): string {
  const value = facts[key];
  return typeof value === "string" ? value : fallback;
}

function normalize(arg?: string[] | PolicyOptions): PolicyOptions {
  if (Array.isArray(arg)) return { remembered: arg };
  return arg ?? {};
}

/** 是否命中永久禁止（只读 facts；任何档位都拦） */
export function checkDeny(event: { action_display?: string; facts?: Facts }): Verdict | null {
  const facts = event.facts ?? {};

  const danger = factString(facts, "danger");
  if (danger) return DENY(`永久禁止：${danger}`);

  for (const path of [...factList(facts, "writes"), ...factList(facts, "deletes")]) {
    for (const [re, why] of DENY_PATH) {
      if (re.test(path)) return DENY(why);
    }
  }

  const program = factString(facts, "program").toLowerCase();
  if (program && DENY_PROGRAM.has(program)) return DENY(`不允许执行 ${program}`);

  return null;
}

/**
 * 「记住」的键：同一类动作、同样的目标、同一个程序 → 同一把钥匙。
 * 不包含命令原文——换一种写法不该绕过已记住的规则，也不该重复问。
 */
export function treatKey(event: { action_display?: string; facts?: Facts }): string {
  const facts = event.facts ?? {};
  const kind = factString(facts, "kind", "unknown");
  const program = factString(facts, "program");
  const targets = [...factList(facts, "writes"), ...factList(facts, "deletes")].sort();
  return [kind, program, ...targets].filter(Boolean).join("|");
}

function insideWorkspace(path: string, roots: string[]): boolean {
  const p = path.toLowerCase().replace(/[\\/]+$/, "");
  return roots.some((root) => {
    const r = root.toLowerCase().replace(/[\\/]+$/, "");
    return p === r || p.startsWith(r + "\\");
  });
}

function readOnlyVerdict(event: { action_display?: string; facts?: Facts }): Verdict {
  const facts = event.facts ?? {};
  const kind = factString(facts, "kind", "unknown");
  const effect = factString(facts, "effect", "unknown");
  const writes = factList(facts, "writes").length + factList(facts, "deletes").length;

  if (effect === "read") return ALLOW("只读操作");
  if ((kind === "read" || kind === "other") && writes === 0) return ALLOW("读取路径");
  return ASK(effect === "unknown" ? `类型 ${kind} 的影响未知，需要人工确认` : `类型 ${kind} 需要人工确认`);
}

/**
 * 判断一条审批请求：禁止 → 记住 → 权限档位。
 *
 * 顺序很重要：**"禁止"必须排在"记住"和"档位"前面**。
 * 否则用户曾经批准过、或开了完全权限，就把硬禁止也放过去了。
 */
export function classifyApproval(
  event: { action_display?: string; facts?: Facts },
  options: string[] | PolicyOptions = {},
): Verdict {
  const denied = checkDeny(event);
  if (denied) return denied;

  const opts = normalize(options);
  const profile: Profile = opts.profile ?? "workspace";
  const facts = event.facts ?? {};

  if ((opts.remembered ?? []).includes(treatKey(event))) {
    return ALLOW("你之前批准过同样的操作");
  }

  if (profile === "full") return ALLOW("完全权限（当前任务）");

  const effect = factString(facts, "effect", "unknown");
  if (profile === "read-only") return readOnlyVerdict(event);

  // workspace：只放行工作区内的写/删/改，以及运行工作区内的脚本
  const kind = factString(facts, "kind", "unknown");
  if (effect === "read") return ALLOW("只读操作");
  if (kind === "read" || kind === "other") return ALLOW("读取路径");

  const roots = opts.workspaceRoots ?? [];
  const targets = [...factList(facts, "writes"), ...factList(facts, "deletes")];
  const script = factString(facts, "script");

  if (targets.length > 0) {
    if (roots.length > 0 && targets.every((p) => insideWorkspace(p, roots))) {
      return ALLOW("工作区内操作");
    }
    return ASK("工作区外的写操作");
  }

  if (script && roots.length > 0 && insideWorkspace(script, roots)) {
    return ALLOW("运行工作区内的脚本");
  }

  return ASK(effect === "unknown" ? `类型 ${kind} 的影响未知，需要人工确认` : `类型 ${kind} 需要人工确认`);
}
