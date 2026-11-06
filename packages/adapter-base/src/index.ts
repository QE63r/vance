/**
 * adapter-base —— 所有适配器（Claude、Codex……）共用的基类。
 *
 * ┌─ 怎么读这个文件 ────────────────────────────────┐
 * │ 1. 先看 DenyReason / Outcome：输入什么、输出什么   │
 * │ 2. 再看 handle()：整个产品的安全底线就在这 30 行    │
 * │ 3. 最后看 route()：真正的策略引擎以后长在这里       │
 * │ 4. 12 处 [学习注]：按出现顺序读，语法和设计一起讲    │
 * └───────────────────────────────────────────────┘
 *
 * 一句话：适配器只负责「翻译」，不负责「判断」。
 * 翻译拿不准（抛错 / 返回 null），基类一律转成 DENY。
 * 这就是 fail-closed（出错就关闸），也是梵境敢说自己
 * "授权由确定性代码执行" 的原因。
 */

// 学习注索引（按出现顺序）：
// 01 import type · 02 联合类型 · 03 可辨识联合 · 04 依赖注入 · 05 abstract
// 06 abstract readonly · 07 unknown 与 null · 08 先声明再赋值 · 09 catch 无参数
// 10 过期用 <= · 11 默认拒绝 · 12 一行函数
// 读法：先读注，再看它下面紧邻的那行代码；读不懂就回上一条。

// [学习注] `import type` 表示"只导入类型"。编译成 JS 后这一行会整个消失，
// 运行时不会真的去加载 @vance/core —— 类型只在写代码时帮你检查。
import type { AgentEvent, Decision } from "@vance/core";

/**
 * 拒绝的原因。
 *
 * [学习注] `type X = "a" | "b" | "c"` 叫「联合类型」：
 * 意思是这个值只能是这几个字符串之一，写错一个字母编译就报错。
 * 好处是日志里能说清"为什么拒"，而不是只留一个 false。
 */
export type DenyReason =
  | "disconnected" // 手机和 Agent Host 断开了
  | "malformed" // 收到的数据是坏的，翻译时抛了错
  | "unknown_event" // 不认识这个事件（协议升级了？适配器过期了？）
  | "expired" // 授权窗口过了，批准也无效
  | "unimplemented"; // 功能还没实现

/**
 * handle() 的返回值：三种可能。
 *
 * [学习注] 这里用了「可辨识联合」：三种情况都带 decision 字段，
 * 但只有 DENY 带 reason。写 switch (out.decision) 时，
 * TypeScript 能自动帮你把三种情况分清楚。
 */
export type Outcome =
  | { decision: "DENY"; reason: DenyReason }
  | { decision: "APPROVAL"; event: AgentEvent }
  | { decision: "ALLOW"; event: AgentEvent };

/**
 * 每次处理事件时，从外部传进来的"当下状态"。
 *
 * [学习注] 时间不直接从系统读，而是当成参数传进来 ——
 * 这样测试时可以把时钟拨到任意时刻，不用真的等 60 秒。
 * 这种写法叫「依赖注入」，是让代码可测试的最便宜的办法。
 */
export interface AdapterContext {
  /** 当前时间（毫秒时间戳，与事件里的 timestamp 同一口径，见 ADR-0002 D4） */
  nowMillis: number;
  /** 手机端和 Agent Host 是否连着 */
  connected: boolean;
}

/**
 * 所有适配器的基类。
 *
 * [学习注] abstract 的意思是"这个类不能直接 new"，
 * 只能被继承。它定义的是"你们都得长这样"，不是"拿去直接用"。
 */
export abstract class BaseAdapter {
  /**
   * 这个适配器代表哪个 Agent，比如 "claude-code"。
   *
   * [学习注] abstract readonly：
   * - abstract 表示基类不给值，子类必须自己给；
   * - readonly 表示赋值之后不能再改。
   */
  abstract readonly agentId: string;

  /**
   * 把某个 Agent 的原生数据，翻译成我们自己的通用事件。
   *
   * [学习注] raw 的类型是 unknown，不是 any：
   * - any     = "随便，别管我"（危险，错误会被带到很远的地方）
   * - unknown = "我不知道里面是什么，用之前必须先检查"
   * 我们处理的正是外部不可信数据，所以用 unknown。
   *
   * 返回 null 表示"我不认识这个事件"。这是唯一合法的"放弃"方式。
   */
  protected abstract translate(raw: unknown): AgentEvent | null;

  /**
   * 统一入口。所有适配器的事件都从这里进。
   *
   * 判定顺序是有讲究的（下面每一步都写了为什么）：
   *   没连上 → 拒
   *   翻译失败 → 拒
   *   不认识 → 拒
   *   过期 → 拒
   *   剩下的才进入 route()
   */
  handle(raw: unknown, ctx: AdapterContext): Outcome {
    // 第 1 步：连接断了就什么都不做。
    // 为什么排最前？因为断线时后续任何判断都不可靠，
    // 而且断线往往意味着"我不知道现在真实状态是什么"。
    if (!ctx.connected) {
      return { decision: "DENY", reason: "disconnected" };
    }

    // [学习注] 先声明变量，再在 try 里赋值。
    // 如果写在 try 里面（const event = ...），出了 try 就访问不到了。
    let event: AgentEvent | null;

    // 第 2 步：翻译。适配器可能因为数据畸形而抛错，
    // 我们不让它把异常抛到上层 —— 上层只会看到 DENY。
    try {
      event = this.translate(raw);
    } catch {
      // [学习注] catch 后面不写参数是允许的（我们不需要错误对象）。
      // 这里刻意不把原始错误带出去，避免不可信内容污染日志。
      return { decision: "DENY", reason: "malformed" };
    }

    // 第 3 步：适配器说"我不认识"。
    // 注意：不认识 ≠ 安全。新协议、新工具都可能落在这一支，
    // 所以默认拒绝，而不是"看不懂就放行"。
    if (event === null) {
      return { decision: "DENY", reason: "unknown_event" };
    }

    // 第 4 步：过期检查。
    // [学习注] 用 `<=` 而不是 `<`：到点的瞬间就失效，不给"卡点"留缝。
    // 为什么放在翻译之后？因为要知道 expires_at，得先有事件对象。
    if (event.expires_at <= ctx.nowMillis) {
      return { decision: "DENY", reason: "expired" };
    }

    // 只有活到这一步的事件，才配进入真正的策略判断。
    return this.route(event);
  }

  /**
   * 治理层的雏形 —— 以后会变成一张真正的规则表
   * （Deny > Approval > Allow，按 risk 分级，记录 policy_version）。
   *
   * 现在只做一件事：**默认要求人工批准**。
   * 宁可多问一次，也不能默认放行。
   *
   * [学习注] switch 这里只列了两种"明确无害"的事件，
   * 其余全部落到 default。这叫「默认拒绝」：
   * 将来新增一种事件类型、忘了补规则，它会被要求批准，
   * 而不是被悄悄放行。
   */
  protected route(event: AgentEvent): Outcome {
    switch (event.type) {
      // 状态更新和工具结果只是"汇报"，不产生新动作，可以直接放行。
      case "status_update":
      case "tool_result":
        return { decision: "ALLOW", event };

      // 审批请求、提问，以及其他一切没列出来的情况：
      // 都要人来看一眼。
      default:
        return { decision: "APPROVAL", event };
    }
  }
}

/**
 * 小工具：只取决定结果，不关心原因。
 *
 * [学习注] 这种一行函数看着多余，但它让调用方写起来更干净：
 * if (decisionOf(out) === "DENY") ...
 */
export const decisionOf = (outcome: Outcome): Decision => outcome.decision;
