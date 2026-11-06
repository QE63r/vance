# 下一张任务卡：会话身份（session_id + /sessions）

> 仓库：`C:\Users\1\Desktop\梵境\vance`（**不在 DSH 默认工作区**；若 cwd 不是它，先 cd 过去）
> 新会话第一件事：把下面【验收】原样复述一遍，确认无误再动手。
> 复述错了 = 卡没写清；复述对了 = 开工。

---

【任务】让每条消息带 `session_id`，host 维护会话注册表，`history` 按会话分段，
并提供 `GET /sessions` 查询与 `WS ?session=` 按会话回放。

【验收】

1. `pnpm test` 全过（基线 **106 passed / 0 failed**），新增 **≥6 条**用例：
   消息打标、两条会话的 `history` 互不串、旧流水归 `legacy`、`/sessions` 列表、
   `?session=` 只回该会话、未知会话不静默切换。
2. `pnpm --filter @vance/web build` 后，用 `tools/host-demo.mjs` 起真 host：
   `curl http://127.0.0.1:8787/sessions` 返回
   `{"sessions":[{"id":"ses_...","title":"...","active":true,...}]}`，
   且 WS 的 `hello.session_id` 等于这个 id。
3. 本机同时存在 `legacy`（旧流水）与 `ses_...`（当前）两条会话时，
   分别带 `?session=` 连接，两边 `history` 的条数与内容各自独立（贴两条命令的输出）。

【边界】

- 不做会话 create / stop / 切换 UI；`session/attach` 消息与列表屏留给下一张卡
- 不做 `artifacts` 结构化、`decision` 广播、`rules` 撤销（卡 2）
- **不动 11 字段事件信封**：`session_id` 只放在消息外层
- 不做 token hash；不动 `/app/*` 静态托管
- `packages/web` 只允许透传或忽略新字段，不改四轴 reducer 与 mock 的四轴语义
- 不做多电脑

【上下文】

- `HANDOFF.md` §6 第 2 步
- `docs/frontend-ia.md` §1 缺口 6、§4.3（所有入站消息带 `session_id`）、§5 P0 行
- `adr/0006-frontend-first-screen.md`（host 为准，mock 跟随）

【开工前】

```
git status            :: 必须干净
git tag before-session-id
pnpm test             :: 记下基线（应为 106 passed）
```

【完成后】

1. 贴 `pnpm test` 结果（passed / failed）
2. 贴 `curl /sessions` 与两条 `?session=` 回放结果
3. 更新 `HANDOFF.md` §6（把「会话身份」划掉，换成卡 2）
4. 补 `adr/0008-session-identity.md`：字段位置、存储格式迁移、未知会话处理

【改坏了】

```
git reset --hard before-session-id
```

---

## 口径（先定死，别开工后再讨论）

- **id 从哪来**：用 ACP 返回的 `ses_...`，host 不自己造 id。
- **放哪**：消息外层 `{ type, session_id, ... }`；`event` 里的 11 字段信封一个都不加。
- **存哪**：`~/.vance/history.jsonl` 每行 `{ "session_id": "...", "msg": { ... } }`。
  旧行没有 `session_id` → 读成 `legacy`，只读保留，不迁移语义。
- **列表**：`GET /sessions` → `{ sessions: [{ id, title, created_at, updated_at, active }] }`。
  `title` 由启动器传入（host-demo 用 cwd 或首条 prompt 截断），host 不猜。
- **回放**：`WS /ws?token=…&session=<id>` 只回该会话的 `history` 与 pending 审批；
  不传 `session` 就回当前活动会话。
- **未知 id**：不静默切换。连接保持，回一条 `notice`（deny）说明，仍给当前会话流水——
  手机拿旧书签进来时看到的是解释，不是空白。
- **活动会话**：host 仍是单执行；`active` 由 `host.useSession(id, title)` 设定，
  host-demo 在 `client.start()` 之后调用；此时若已有设备在线，补发一条 `session` 通知。
- **mock**：只补 `session_id` 字段，不改四轴语义；ADR-0006 的「host 为准」不变。

## 为什么先做这张

- 列表屏、切换、"只看不控" 全都以「每条消息知道属于哪条会话」为前提；这张不做，后面全是空中楼阁。
- 它不依赖 ACP 新开会话：当前 host 仍是单执行，只要把现有会话标好、把旧流水归到 `legacy`，
  就能用两条会话（legacy + 当前）把隔离验掉。
- 做完就是一个能独立上线的状态：协议不再丢会话归属，旧页面/旧 mock 最多是多看一个字段。

## 做完之后

卡 2：`artifacts` 结构化、`decision` 广播、`rules` 撤销（审计与产出）。
再往后才是列表屏 / 设置屏 / `session/attach` 的 UI。
