# 事件模型

> 状态：草稿（P1 契约基线 v0.1）。字段变更会让 `packages/core` 的快照测试变红。

## 四类事件

| 事件 | 方向 | 含义 |
|---|---|---|
| `approval_request` | Agent → 人 | 需要人决定才能继续的动作 |
| `question` | Agent → 人 | 开放式提问，不一定涉及风险 |
| `tool_result` | Agent → 人 | 工具执行结果 |
| `status_update` | Agent → 人 | 运行状态变化 |

## 信封字段

见 `packages/core/src/events.ts`。十一条强制字段：

`request_id` `agent_id` `project_id` `timestamp` `action_digest` `effect_digest`
`nonce` `expires_at` `policy_version` `signer` `signature`

## 待定

- [ ] 签名算法与规范化序列化（JSON Canonicalization Scheme？）
- [ ] `policy_version` 的取值规则
- [ ] 大 payload 的截断策略
