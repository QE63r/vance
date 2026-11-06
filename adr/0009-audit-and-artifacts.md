# ADR-0009：审计与产出（`decision` / `artifacts` / `rules`）

- 状态：已接受
- 日期：2026-11-06
- 关联：ADR-0008、`docs/frontend-ia.md` §1 缺口 1 / 2 / 3 / 4 / 7、`docs/task-audit-artifacts.md`

## 背景

上一版里，「已批准」只是 host 拼的一句 `notice` 文本：重放就丢，也答不了
「是谁、什么时候批的」。产出一样，是 `notice` 里的一句「新增 2，改动 1」，
点不开、拿不到文件名。记住的规则只增不减，用户没法撤销。`hello` 也没有
服务端时间，手机倒计时只能信自己。

这四件都不依赖新 UI，先把协议做对。

## 决定

### 一、`decision` 消息就是审计记录

`{ type:"decision", requestId, decision, by, at, session_id }`，广播给所有设备，
并落进流水。不再用 `notice` 拼「已批准：…」。

`requestId` 保持 camelCase（web 的类型和 reducer 已经在用），`session_id` 跟
ADR-0008 一致用 snake。两者混用是历史包袱，改名的代价大于收益。

### 二、`artifacts` 结构化

`{ type:"artifacts", artifacts:{ turnId, added[], changed[], removed[], warnings[] } }`，
由 `host.broadcastArtifacts(payload)` 广播并落流水。

`host-demo` 仍是唯一扫磁盘的人：它把 `diffSnapshot` 的结果直接塞进 payload，
不再拼文案。**无变化**的一轮仍只发一句 `notice`，不造空产出对象。

### 三、规则只读 + 撤销

- `GET /rules` → `{ rules: string[] }`
- `POST /rules/revoke` body `{ key }` → `{ ok:true, key }`；未知 key 404

host 不读 `rules.json`：启动器注入 `onRules({ list, revoke })`，它才是规则的持有者。
这样换存储（文件、数据库、内存）不用改 host。没有注入时列表为空、撤销 404，不报 500。

### 四、`hello` 补 `server_time`

`hello.server_time = Date.now()`。手机倒计时和审批卡的剩余秒数不再只能信本地时钟。

## 后果

- 流水里出现 `decision` / `artifacts`，回放能看到「谁批的、产出了什么」。
- 测试 112 → 116；host 从 19 涨到 23 条。
- 前端不需要新逻辑：reducer 早有 `decision` / `artifacts` 分支，这次只是让 host 真的发出来。
- 真实 host 已验证：`/rules` 能列出历史规则；`hello.server_time` 与本机差 3ms；
  `decision`/`artifacts` 的落盘与广播由 4 条新用例覆盖。

## 失效条件

- 若以后要求「决定不可抵赖」（签名、时间戳服务），`by` 一个字符串不够，本 ADR 第一条要升级。
- 若产出改由服务端扫描磁盘（而不是启动器注入），`broadcastArtifacts` 的调用方要重写。
- 若 UI 需要分页/过滤规则，`GET /rules` 的裸数组要换成带游标的结构。
