# 适配器契约

> 状态：草稿（P1）。任何一个适配器不满足下面三条，就不算完成。

## 三条硬要求

1. **只翻译，不判断**。适配器不得自行决定 allow/deny。
2. **未知事件必须显式返回 `null`**，由基类转成 `DENY` + `unknown_event`，不许静默丢弃。
3. **拿不到真实 payload 不算完成**。每个适配器至少要录 8 个真实事件作为 fixture。

## facts 是适配器的产物（ADR-0011）

适配器负责把 Agent 方言翻译成 `facts`：`kind / effect / writes / reads / deletes / program / danger`。
命令文本的解析（只读判定、危险识别）只能出现在适配器里；策略层只读 facts。
翻译不出 `effect` 时必须给 `unknown`，让策略问人——不许猜成 read。

## 生命周期

```
原生事件 → translate() → AgentEvent → BaseAdapter.handle() → Outcome
```

`handle()` 的判定顺序：未连接 → 拒绝；翻译抛错 → 拒绝；返回 null → 拒绝；
过期 → 拒绝；其余进入 `route()`。

## 待定

- [ ] fixture 的存放与命名规范
- [ ] 版本探测：协议不匹配时如何提示「不支持」而不是失败
