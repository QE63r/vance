# 下一张任务卡：事实契约（facts v1）

> 仓库：`C:\Users\1\Desktop\梵境\vance`；先 cd 过去。
> 复述【验收】后再动手。

【任务】把审批的风险判断从「解析命令文本」改成「读适配器给出的事实」：
facts 增加 `writes / reads / deletes / program / effect / danger`，
策略只对 facts 做规则；命令方言的解析搬进适配器。

【验收】

1. `pnpm test` 全过；`packages/policy` 里**不再出现** shell 动词/命令解析
   （`Remove-Item`、`2>&1`、`Program Files` 这类字符串只在 adapter 里）。
2. 同一组 facts、两种完全不同的 `action_display`（PowerShell 写法 / bash 写法），
   `classifyApproval` 判定相同。
3. 造一份「第二个 Agent」形状的事实（例如 JSON 工具调用：`writes:["C:\\Windows\\x"]`），
   不改 host / policy / web，策略就能给出 DENY；`effect:"read"` 的则 ALLOW。
4. 认不出的 effect → ASK（fail-closed），不靠文本猜。

【边界】

- 不动事件信封 11 字段；只改 `facts` 的**值类型**（允许 `string[]`）
- 不新增 UI；不碰 token hash；不碰 `/app` 托管
- `action_display` 只用于展示；`explainAction` 的人话提示可以留在 adapter
- 旧 facts（只有 kind/files）仍要能判：缺 effect 就 ASK，不崩

【开工前】git 干净 → `git tag before-facts-v1` → `pnpm test` 记基线

【完成后】贴测试数字 / 一份同 facts 不同文本的判定 / 更新 HANDOFF、补 ADR-0011

【改坏了】`git reset --hard before-facts-v1`

---

## 口径

- facts v1：`kind`、`effect`（read/write/unknown）、`writes[]`、`reads[]`、`deletes[]`、
  `program`、`danger`（适配器识别的"永久禁止"类，如格式化）。
- 策略决策顺序不变：**禁止 → 记住 → 只读放行 → 其余问人**；但每一档都只看 facts。
- 记住的键从「命令原文」改成 `kind|program|目标`，换一种写法不会绕开已记住的规则。
- 文本只允许用于 **DENY 的兜底**（明显危险），永远不能用来 ALLOW。
