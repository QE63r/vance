# ADR-0011：事实契约（facts v1）——策略不再读命令文本

- 状态：已接受
- 日期：2026-11-07
- 关联：`docs/event-model.md`（风险由 facts 计算）、`docs/adapter-contract.md`（只翻译不判断）、
  `docs/task-facts-contract.md`

## 背景

之前 `policy` 直接解析 `action_display` 这串命令文本：认 `Remove-Item`、`2>&1`、
`Program Files`，再决定放行还是问人。这是把**适配器的活**塞进了**决策层**：

- 每多一种 Agent 方言（PowerShell / bash / JSON 工具调用），就要补一批正则；
- 文本里出现系统路径就误判，出现 `2>&1` 也误判；
- 换一个 Agent，控制面就得跟着改——产品变成某个 Agent 的调试器。

这违反了仓库自己的两条约定：风险由 facts 计算；适配器只翻译、不判断。

## 决定

### 一、facts v1：只描述"要动什么"

| 字段 | 含义 |
|---|---|
| `kind` | 动作类别（edit / execute / read / fetch …），沿用 Agent 给的值 |
| `effect` | `read` / `write` / `unknown`——这次动作的影响 |
| `writes[]` / `reads[]` / `deletes[]` | 目标路径数组 |
| `program` | 执行类动作的程序名（适配器从方言里取） |
| `danger` | 适配器识别的"永久禁止"类（格式化、关机、外传…），人话理由 |

值类型从 `string | number | boolean` 扩到允许 `string[]`。信封 11 个字段不动。

### 二、命令方言搬进适配器

`packages/adapter-opencode/src/command.ts` 承接：只读命令判定、永久禁止识别、
`explainAction` 的人话解释。适配器把它们翻译成 `effect` / `danger`。
以后加 Claude Code 适配器，只需要再写一份这种翻译。

### 三、策略只读 facts

`classifyApproval` 的顺序不变：**禁止 → 记住 → 只读 → 其余**，但每一档只看 facts：

- 禁止：`danger`、写/删目标命中机器禁区、程序名在黑名单；
- 记住：键变成 `kind|program|目标`，换一种写法不会绕开已记住的规则；
- 只读：`effect === "read"`（或旧事实里的纯路径访问）；
- 其余：`ASK`。`effect === "unknown"` 明确写"影响未知"。

文本只用于展示，**永远不能用来 ALLOW**。

### 四、旧事实与旧规则

- 旧事件没有 `effect`：若是 `kind=read/other` 且没有写目标，仍按只读放行；否则 ASK。
  不靠文本补判。
- 旧的「记住」键（`kind:命令原文`）不再匹配新键，效果是重新问一次。
  宁可多问，不可错放。

## 后果

- 策略源码里不再出现 shell 动词/重定向解析（只在注释里说明"为什么不做"）。
- 测试从 121 降到 112：命令相关用例从 policy 搬到 adapter，并删掉了纯文本策略用例；
  `adapter-opencode` 从 15 涨到 38，policy 16，core 21，host 25，web 7。
- 实测链路（ACP 行 → 适配器 facts → 策略）：
  - edit 到 `C:\Program Files\evil.txt` → `writes` 命中 → DENY；
  - 读 `C:\Windows\win.ini` → `effect=read` → ALLOW；
  - `Remove-Item ...` → `effect=unknown` → ASK。
- 第二个 Agent 的 facts（JSON 工具调用形状）不需要改策略：写 Windows → DENY，读 → ALLOW。

## 失效条件

- 若适配器开始谎报 `effect=read`（把写说成读），策略会被绕过。适配器是本地可信组件，
  但它必须接受同样的审计；后续可在 host 侧对 `effect=read` 抽样校验。
- 若某个 Agent 不提供任何可结构化的事实（只有自由文本），它只能得到 ASK，
  不能进入自动放行——这是有意的。
- 若要把"路径禁区"也交给适配器，本 ADR 第三条的路径规则作废。
