# 下一张任务卡：审计与产出（decision / artifacts / rules）

> 仓库：`C:\Users\1\Desktop\梵境\vance`（不在 DSH 默认工作区；先 cd 过去）
> 新会话第一件事：把下面【验收】原样复述一遍，确认无误再动手。

---

【任务】把「谁批的、产出是什么、记住的规则」从文本提示变成协议里的事实：
`decision` 广播并落流水、`artifacts` 结构化、`GET /rules` 查询与撤销，`hello` 补 `server_time`。

【验收】

1. `pnpm test` 全过（基线 **112 passed / 0 failed**），新增 **≥4 条**：
   decision 广播到所有设备且带 `by`/`at`、decision 进流水、artifacts 结构正确且带 `session_id`、
   `/rules` 列表与撤销、`hello.server_time` 是数字。
2. 真 host：批准一次后，`~/.vance/history.jsonl` 里能查到一条 `decision` 记录
   （requestId / decision / by / at / session_id）；两个 WS 客户端都收到同一条。
3. `curl http://127.0.0.1:8787/rules` 列出记住的规则；`POST /rules/revoke` 撤销其中一条后，
   再查列表不再包含它（撤销返回 `{ok:true,key}`，不存在的 key 返回 404）。
   产出：跑一轮会生成文件的任务后，手机「本轮产出」能点开，看到 added/changed/removed 的文件名。

【边界】

- 不做设置屏 / 规则列表 UI；只做接口与协议（UI 在列表屏那张卡）
- 不改四轴 reducer 的语义：`decision` / `artifacts` 已有分支，只补字段透传
- **不动 11 字段事件信封**；`session_id` 仍在消息外层
- 不新增产出扫描逻辑：沿用 `host-demo` 现有的「磁盘差异 + 内容校验」，只把它结构化
- 不做 token hash；不做列表屏 / 会话切换

【上下文】

- `HANDOFF.md` §6 第 2 步（卡 2）
- `docs/frontend-ia.md` §1 缺口 1 / 2 / 3 / 4 / 7、§5 P0 行
- `adr/0008-session-identity.md`（消息层字段、session_id 归属）
- `adr/0006-frontend-first-screen.md`（host 为准，mock 跟随）

【开工前】

```
git status            :: 必须干净
git tag before-audit-artifacts
pnpm test             :: 记下基线（应为 112 passed）
```

【完成后】

1. 贴 `pnpm test` 结果（passed / failed）
2. 贴 `curl /rules` 的输出 + 一条 decision 的流水记录
3. 更新 `HANDOFF.md` §6（把卡 2 划掉，换成卡 3）
4. 补 `adr/0009-audit-and-artifacts.md`

【改坏了】

```
git reset --hard before-audit-artifacts
```

---

## 口径（先定死）

- **decision 消息**：`{ type:"decision", requestId, decision, by, at, session_id }`。
  `requestId` 保持 camelCase（web 类型已在用），`session_id` 统一 snake（与 0008 一致）。
  广播给所有设备，并**落进流水**——它就是审计记录，不再另造一条 notice 文案。
- **artifacts 消息**：`{ type:"artifacts", session_id, artifacts:{ turnId, added[], changed[], removed[], warnings[] } }`，
  由 `host.broadcastArtifacts(payload)` 发出并落流水。`host-demo` 不再用 `notice` 拼文本。
- **rules 接口**：HTTP，不走 WS。
  `GET /rules` → `{ rules: string[] }`；`POST /rules/revoke` body `{ key }` →
  `{ ok:true, key }` 或 404。host 不读文件，由 `host-demo` 注入 `list/revoke`（它才是规则的持有者）。
- **server_time**：`hello.server_time = Date.now()`，给手机倒计时一个可比的时钟（缺口 4）。
- **未知/空**：没有 rules provider 时 `/rules` 回 `{rules:[]}`，revoke 回 404，不报 500。

## 为什么是这张卡

- 手机现在看到的「已批准」是 `notice` 文本，重放就丢；决定本身不是事实。审计必须进流水。
- 产出现在是 `notice` 拼的一句话，点不开、也没法按文件看；结构化之后产出区才有意义。
- 规则只增不减（`remembered` 只写不删）；没有撤销，用户等于给自己挖坑。
- 这三件都不依赖 UI，先把协议做对，列表屏才有东西可展示。

## 做完之后

卡 3：列表屏 / 设置屏 / 会话切换（设计稿 §2.2、§2.4、§3.5）。
token 从 query 挪到 hash 仍单独一张卡。
