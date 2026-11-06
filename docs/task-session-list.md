# 下一张任务卡：任务列表 + 规则撤销（卡 3，第一刀）

> 仓库：`C:\Users\1\Desktop\梵境\vance`；先 cd 过去。
> 新会话第一件事：把【验收】复述一遍再动手。

【任务】第一屏加一个「⋯」入口：能看任务列表、点着切换；能看「记住的规则」并撤销。
切换走 `session/attach` 消息，不重连。

【验收】

1. `pnpm test` 全过（基线 118 / 0 failed），新增 ≥3 条：
   `session/attach` 切到指定会话只回该会话流水、未知 id 给 notice、切完后的消息带新 `session_id`。
2. 手机（或 390×844 浏览器）点「⋯ → 任务列表」：能看到当前会话 + `legacy`，
   点另一条，时间线换成它的记录，顶栏仍是 sandbox、连接不断。
3. 点「⋯ → 记住的规则」：列出 `GET /rules` 的内容；点「撤销」后该条消失，
   再查 `/rules` 也不包含它。

【边界】

- 只做菜单 + 两个面板；不做独立路由、不做底部 tab、不做多选
- 不做 token hash；不动事件信封；不动 `/app` 托管
- 规则撤销只做「撤销」，不做新增/编辑
- 不做点击/打字（远控桌面），不做多电脑

【开工前】git status 干净 → `git tag before-session-list` → `pnpm test` 记 118

【完成后】贴测试数字、两张截图（列表 / 规则）、更新 HANDOFF §6、补 ADR-0010

【改坏了】`git reset --hard before-session-list`

---

## 口径

- **切换**：`{ type:"session/attach", sessionId }` → host 把该连接的观看会话改成它，
  回一条 `session`（标题/是否 active）+ 该会话 `history` + 该会话 pending 审批。
  未知 id：只回 `notice`，不改观看会话。
- **列表数据**：直接 `GET /sessions`（已有），不新造接口。
- **规则数据**：`GET /rules` + `POST /rules/revoke`（已有）。
- **入口**：顶栏右侧一个「⋯」；面板样式复用现有 `sheet`，不引路由库。
- **插入顺序**：新消息仍按到达顺序；切换时 `history` 会清空重建（现有行为）。
- **状态**：`sessionId` 进 store，`hello` 与 `session` 都更新它；UI 只读。

## 为什么是这张

列表/切换是设计稿里唯一还没露面的主屏；不做它，`session_id` 这条线就只有协议没有产品。
规则撤销是「用户不能给自己挖坑」的最后一环，接口已在，缺一个按钮。
