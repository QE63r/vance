/**
 * 风险策略 —— 只读「事实」，不读命令文本。
 *
 * 为什么：命令是 Agent 的方言（shell 动词、重定向、系统路径），解析它属于适配器。
 * 控制面如果去认这些写法，换一个 Agent 就得重写一遍。
 *
 * 适配器把"要动什么"翻译成 facts：
 *   kind / effect / writes / reads / deletes / program / danger
 * 这里只对 facts 做三档：禁止 → 记住 → 只读放行 → 其余问人。
 *
 * 文本（action_display）只用于展示，永远不参与判定。
 */

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

/** 是否命中永久禁止（只读 facts） */
export function checkDeny(event: { action_display?: string; facts?: Facts }): Verdict | null {
  const facts = event.facts ?? {};

  // 适配器识别的"永久禁止"类：格式化、关机、外传…
  const danger = factString(facts, "danger");
  if (danger) return DENY(`永久禁止：${danger}`);

  // 写/删目标落进机器禁区
  for (const path of [...factList(facts, "writes"), ...factList(facts, "deletes")]) {
    for (const [re, why] of DENY_PATH) {
      if (re.test(path)) return DENY(why);
    }
  }

  // 程序名本身
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

/**
 * 判断一条审批请求：禁止 → 记住 → 只读 → 其余。
 *
 * 顺序很重要：**"禁止"必须排在"记住"前面**。
 * 否则用户曾经批准过一次，就把它变成了永久放行——那是最危险的后门。
 */
export function classifyApproval(
  event: { action_display?: string; facts?: Facts },
  remembered: string[] = [],
): Verdict {
  const denied = checkDeny(event);
  if (denied) return denied;

  if (remembered.includes(treatKey(event))) {
    return ALLOW("你之前批准过同样的操作");
  }

  const facts = event.facts ?? {};
  const kind = factString(facts, "kind", "unknown");
  const effect = factString(facts, "effect", "unknown");
  const writes = factList(facts, "writes").length + factList(facts, "deletes").length;

  // 只读：适配器已经给了 effect=read，或旧事实里是纯路径访问
  if (effect === "read") return ALLOW("只读操作");
  if ((kind === "read" || kind === "other") && writes === 0) return ALLOW("读取路径");

  // 拿不准就问人（fail-closed）；不再靠命令文本猜
  return ASK(effect === "unknown" ? `类型 ${kind} 的影响未知，需要人工确认` : `类型 ${kind} 需要人工确认`);
}
