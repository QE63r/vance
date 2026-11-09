# ADR-0018：任务生命周期 v1（新建 / 切换 / 列表状态）

- 状态：已接受并落地（2026-11-09）
- 日期：2026-11-09
- 关联：ADR-0008（会话身份）、`docs/frontend-ia.md` v2、`HANDOFF.md` §6

## 背景

现在 `session/attach` 只是“换手机看哪条”，Agent 仍在旧会话里；任务列表没有新建/停止，
`/sessions` 只有 id/title/时间。控制塔如果建在这上面，任务页会空。

## 决定

1. **新任务用 ACP `session/new`，不重启 Agent**
   - `AcpClient.newSession()` 在同一个 opencode 进程里开新会话，返回新 id
   - 旧会话仍留在 opencode 里，可用 `session/load` 回去
   - 不重启进程：重启会丢正在跑的上下文，也会把旧会话的 MCP 状态打掉

2. **切换用 ACP `session/load`**
   - 手机发 `session/switch`；host 先让 Agent load 成功，再 `useSession` 改活动会话
   - 手机发 `session/attach` 仍然只是“看”，不改 Agent
   - 两者都在**没有一轮在跑**时允许；跑着时拒绝，避免两轮抢同一个 ACP

3. **切换/新建先清时间线**
   - `session` 事件到前端时清空 timeline/approvals/exec；history 随后重放
   - 新建任务没有 history；不清就会把上一条任务的消息留在新任务里

4. **列表给真状态**
   - `/sessions` 增加 `status`（running/idle/stopped）、`pending`（待批数）、`artifacts`（仓库记录数）
   - 前端任务面板显示状态/待批/产出；非当前任务有“切到此任务”
   - 新建按钮 → `session/new`；切换按钮 → `session/switch`

5. **标题先叫“新任务”**
   - 不猜、不摘要；后续再让用户改名或从第一句人话取标题

## 后果

- 手机能真的新建任务、切回旧任务；Agent 在同一进程里按 session 工作。
- 任务在跑时不能切/新建；停止仍用输入区的停止按钮。
- 旧会话的 history 在切换后重放；空新任务显示为空，不会叠上一条。
- `/sessions` 的 pending/artifacts 是实时计数；artifacts 来自仓库索引。

## 没做什么

- 没有删除/归档/重命名任务；没有并发执行（仍单执行）。
- 没有在任务列表里单独“停止某条”；停止只作用于当前活动任务。
- 没有从第一句自动生成标题；标题仍是“新任务”。
- 没有做多机/多用户任务。
