# Positioning: the invisible approval layer

- 状态：v0.1 定位（2026-11-12）
- 一句话：**Vance is the local-first approval layer for AI agents.**
- 中文：**Agent 的本地审批层：任何 Agent 接进来，就得到确定性的审批门、决策记录和手机端人工接管。**

## 1. 品类

不是 AI 助手，不是 Agent 框架，不是远程桌面，不是消费级 AI 桥接。

品类名：**Agent approval / human-in-the-loop infrastructure**。

对开发者的一句话：

> Drop-in approval gate for agents. Deterministic, fail-closed, local-first,
> with a reference mobile client.

## 2. 为什么需要

Agent 从“聊天”走向“执行”之后，真正缺的不是更多 Agent，而是：

- 什么时候必须让人决定；
- 人到底批了什么；
- 出事后能不能停、能不能证明。

Agent 框架负责“怎么跑”；Vance 负责“什么时候允许它跑”。

## 3. 目标用户

### 第一批：Agent 作者 / 工具作者

- 已经写了 Agent loop，但审批/审计/手机接管是空白；
- 不想自己造策略引擎、审批 UI、移动端；
- 需要一个可嵌入的中立层。

### 第二批：跑本地 Agent 的 power user

- Claude Code / Codex CLI / opencode 用户；
- 需要手机批、停、看产出；
- 愿意装本地 Host。

### 不是

- 想用手机聊豆包/DeepSeek 的普通消费者；
- 想远程操作整台电脑的人；
- 想要“绝对安全”承诺的人。

## 4. 不做什么

- 不生产 Agent、不跑模型、不托管云；
- 不做通用远程桌面；
- 不做消费级 AI 聊天；
- 不把跨生态连通交给 AI 去猜；
- 不承诺绝对安全。

远控只作为 GUI-only 卡点的实验性兜底，放在 `labs/remote`。

## 5. 差异点

| 现有方案 | 问题 | Vance |
|---|---|---|
| Agent 框架（LangGraph/CrewAI） | 管“怎么跑”，不管“人何时介入” | 管审批/策略/接管 |
| 单一 Agent 遥控器 | 只服务一个生态 | 适配器中立 |
| 厂商移动端 | 只服务自己 | 跨生态一致 |
| 远程桌面 | 人驱动整台电脑 | Agent 驱动，人只在例外时介入 |
| 审批工具 | 只有审批 | 审批 + 状态 + 接管 + 决策记录 |

护城河不是“支持列表长”，是：

1. 事件契约；
2. 确定性策略与 fail-closed；
3. 审批绑定具体动作；
4. 适配器生态；
5. 本地优先的信任叙事。

## 6. 开源策略

- License：MIT
- 核心：`core`、`adapter-base`、`policy`、`host`、`web`（参考客户端）
- 参考壳：`desktop`（可选）
- 实验：`labs/remote`
- 公开文档：README、event-model、adapter-contract、ADR
- 贡献入口：适配器、策略规则、参考客户端
- 成功指标：10 分钟跑通第一次审批、接新 Agent < 50 行、两个 Agent 一致审批、0 fail-open

## 7. 应聘叙事

这个项目证明：

- 协议/事件建模；
- 策略引擎与 fail-closed；
- human-in-the-loop 产品判断；
- Host/WS/本地优先；
- 移动端与桌面壳；
- 测试和 ADR。

它不证明 Agent 内核。要投 Agent 原生岗，补一个 `examples/toy-agent`：

- 最小 loop、2–3 个 tools、所有 tool call 走审批、10 个任务 fixtures。

## 8. 30 天

1. 周 1：README/定位/License/CI/CONTRIBUTING，远控移出主路径；
2. 周 2：Adapter SDK + 第二个真实适配器；
3. 周 3：`examples/toy-agent` + 评测 + demo；
4. 周 4：发布，找 10 个 Agent 作者试用。
