# 事件模型

> 状态：v0.2（对应 ADR-0002）。字段变更会让 `packages/core` 的快照测试变红。

## 四类事件

| 事件 | 方向 | 含义 | 未知字段 |
|---|---|---|---|
| `approval_request` | Agent → 人 | 需要人决定才能继续的动作 | **拒绝**（strict） |
| `question` | Agent → 人 | 开放式提问 | **拒绝**（strict） |
| `tool_result` | Agent → 人 | 工具执行结果 | 忽略 |
| `status_update` | Agent → 人 | 运行状态变化 | 忽略 |

## 信封字段

见 `packages/core/src/events.ts`。

| 字段 | 说明 |
|---|---|
| `request_id` | 优先使用 Agent 自己的 id，不重新编号 |
| `agent_id` / `project_id` | 归属与路由 |
| `timestamp` | 毫秒，以 Agent Host 为准 |
| `raw_digest` | **原始 payload 字节的 sha256**，批准的绑定对象 |
| `raw_ref` | 原文存放位置与长度，审计时据此取回字节 |
| `nonce` | 一次性随机数，防重放 |
| `expires_at` | 毫秒，过期即失效 |
| `policy_version` | 判定时所用策略版本 |
| `signer` / `signature` | 签名者与签名 |
| `parent_plan_id` | 可选，所属计划 |

## 三条不能再改的约定

1. **批准绑定 `raw_digest`，不绑定任何转述。** 不规范化、不重排字段、不解析后重拼。
   同一动作换一种写法 = 另一次请求，必须重新批准。
2. **风险等级不在线上格式里。** 发送方无权声明 `risk`；风险由治理层根据 `facts` 计算。
3. **事件不可变。** 执行结果走独立的 `tool_result`，用 `for_raw_digest` 指回原请求。

## 待定

- [ ] 签名算法与密钥管理（另立 ADR）
- [ ] `policy_version` 的取值规则
- [ ] `raw_ref.key` 的存储后端（本地文件 / 对象存储）
