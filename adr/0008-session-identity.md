# ADR-0008：会话身份（session_id）与 `/sessions`

- 状态：已接受
- 日期：2026-11-06
- 关联：ADR-0006、`docs/frontend-ia.md` §1 缺口 6 / §4.3、`docs/task-session-id.md`

## 背景

在这一版之前，所有消息都属于同一个进程级会话：`history` 是全局一条，
补发的审批也不区分会话。结果是列表屏、切换、「只看不控」都没有地基——
第二条会话无法只收到自己的流水。

同时有一条硬约束不能破：事件信封的 11 个字段不动（ADR-0002）。

## 决定

### 一、`session_id` 放在消息层，不进信封

消息统一成 `{ type, session_id, ... }`；`event` 里的信封一个字段都不加。
id 直接用 ACP 返回的 `ses_...`，host 不自己造——重启恢复靠它对上。

`host.useSession(id, title)` 由启动器在 `client.start()` 之后调用；
host 仍是**单执行**，`useSession` 只切「当前是谁」，不 create / stop。

### 二、`history` 按会话分桶，旧流水只读归档

内存与落盘都改成 `{ "session_id": "...", "msg": { ... } }`；
每条会话最多 400 条，启动时读最近 2000 行再裁。

没有 `session_id` 的旧行统一读成 `legacy`，标题「迁移前流水（无会话 id）」。
不回填、不猜归属：这批数据产生时就没有会话信息，猜出来的历史比没有更糟。

### 三、`GET /sessions` 只读列表

返回 `{ sessions: [{ id, title, created_at, updated_at, active }] }`，按 `updated_at` 倒序。
`title` 由启动器给（`host-demo` 用 cwd），host 不猜标题。
用 HTTP 而不是 WS 消息：列表是查询，不需要挤进实时协议。

### 四、按会话回放：`WS ?session=<id>`

- 带 `session` 且存在：只回该会话的 `history` 与 pending 审批。
- 不带：跟当前活动会话。
- 未知 id：**不静默切换**。连接保持，回一条 `notice`（deny）说明，仍给当前会话流水。
  手机拿旧书签进来时，看到的是解释，不是空白。

### 五、推送策略：广播 + 客户端过滤（方案 A）

服务端把所有会话的新消息广播给每台设备，消息自带 `session_id`；
手机只把当前会话放进时间线，其它会话只更新徽标（设计稿 §4.3）。

备选「只推给正在看那条会话的人」被否：会丢掉其它会话「有新动静」的信号，
红点亮不起来，而且要在服务端维护每个连接的观看状态，实现更绕。
代价是手机确实收到了别的会话内容——同一账号自己的设备，暂按可接受处理。

### 六、会话就绪前的消息归 `unassigned`

`useSession` 之前产生的系统消息（设备接入提示等）不属于任何会话：
不落流水、不列为会话，只广播。启动器要尽早调 `useSession`，否则这段窗口里的消息不可回放。

### 七、前端与 mock 的跟随改动

- web：`ServerMsg` 增加 `session` 类型；reducer 增加 `default: return s`，
  以后服务端加消息类型时老页面忽略而不是白屏。
- web：`?session=` 透传到 WS，并在清掉 token 后把 `session` 留在地址栏（刷新不丢）。
- mock：固定 `mock-session`，所有消息补 `session_id`；不新增语义（ADR-0006 的「host 为准」不变）。

## 后果

- 手机可以用 `…/app/?token=…&session=legacy` 直接看某条会话；列表/切换 UI 仍未做（卡 3）。
- 旧流水只能整体归 `legacy`，无法拆回具体会话。
- 测试基线 106 → 112；host 用例改用临时 `historyFile`，不再读写用户真实的 `~/.vance/history.jsonl`。
- 已验证：真 host 上 `/sessions` 返回 `ses_...`(active) + `legacy`；
  默认连接 `hello.session_id = ses_...` 且 history 0 条，`?session=legacy` 回 385 条旧消息，未知 id 回解释。

## 失效条件

- host 支持多会话**并发执行**时，「单 active」与「广播 + 客户端过滤」都要重做。
- 若以后把 `session_id` 放进事件信封，本 ADR 第一条作废。
- 若旧流水需要真正迁移到具体会话，必须找到当时的 session 记录，本 ADR 第二条作废。
