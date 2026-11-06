# ADR-0006：前端第一屏的取舍

- 状态：已接受
- 日期：2026-11-06
- 关联：ADR-0004（步骤流）、ADR-0005（传输与 fail-closed）、`docs/frontend-ia.md`（设计稿）

## 背景

设计稿定的是三张屏、五条轴（L 连接 / T 轮次 / A 审批 / D 设备 / S 视图），
并且已经拍板「单会话执行、可切换」。

这一轮只做**第一屏（会话视图）**，验收只要求三件事：起得来、断线重连看得见、四轴不互相覆盖。
为了不在第一屏就背上多会话的改动，做了下面几个取舍。

## 决定

### 一、只做「活动会话」，S 轴整条推迟

不实现 `active / viewing` 切换，也不实现会话列表。第一屏永远是当前活动会话。
S 轴、列表屏、设置屏跟着 `sessions` 接口一起做（见设计稿 §5 P0）。

代价：`docs/frontend-ia.md` 里「可切换」的形态暂时不可见；`session_id` 也还没进协议。
收益：这一屏只依赖现有协议，能和真 host 对接，不用等后端。

### 二、四轴用纯 reducer 实现，且「一个消息最多改一条轴」

`link / device / approvals / exec` 分字段存，互不写。
审批卡的可操作性由 `link === ready` 叠加决定，而不是把审批状态改成「断线」。

这是验收第 3 条的可执行版本：`packages/web/test/reduce.test.ts` 里有 5 条用例，
断线时断言 `exec` 仍是 `running`、审批仍是 `offered`、设备仍是 `trusted`。

### 三、前端自带协议类型副本，不 import `@vance/core`

`packages/web/src/model/types.ts` 是 `packages/core/src/events.ts` 的只读镜像。
理由：dev server 不该依赖 core 的构建产物；前端也只消费 JSON，不需要 zod。

代价：core 改字段时这里要手动跟。缓解：字段一一对应，且 `docs/frontend-ia.md` §1 列了协议表；
真要防漂移，下一步加一条「用 core 的 zod schema 在测试里校验镜像类型」。

### 四、dev 用假 host，并只给 dev 开两个控制口

`packages/web/mock/host.mjs` 复刻线上协议（hello / history / event / chat / turn / notice /
ack / decision / artifacts / device_* / 二进制帧），另加：

- `GET /__ctl/down?ms=3500`：踢掉连接并在期间拒绝新连接，用来验「断线 → 重连」
- `GET /__ctl/reset`：清历史与待办，让截图可复现

真前端不依赖它；生产走 `packages/host` + `tools/host-demo.mjs`。
代价：mock 可能与真 host 漂移。约束：mock 只发协议里已有的字段，不新增语义。

### 五、产出区做成常驻 dock

设计稿是「每轮一条结算条 + 点开抽屉」。这一屏额外加了一条常驻 dock（输入框上方）。
理由：手机上第三块区域必须一直可见，否则要滚到底才知道有没有产出；
「三块区域都在」也不该靠滚动运气。

### 六、依赖用 pnpm，入口仍是 `npm run dev`

根 `package.json` 加了 `dev`：`npm --prefix packages/web run dev`。
依赖走 pnpm workspace（`pnpm-lock.yaml` 已含 `packages/web`），不维护第二套 lock。
`npm run dev` 只是执行入口，不负责安装。

### 七、token 从 hash 读，读一次即抹

按上一轮拍板：`#token=` → `sessionStorage` → `history.replaceState` 清掉。
dev 没有 token 时默认 `dev`，仅 `import.meta.env.DEV` 生效。

## 后果

- 这一屏可以直接连真 host（协议一致），只是暂时没有 history 之外的会话能力。
- 切换会话、列表、设置、多设备管理，都要等 `session_id` 与 `sessions` 接口。
- 断线重连的验收靠 `scripts/shot.mjs` + mock 的 `/__ctl/down` 复现，不靠人工。

## 失效条件

- 接上真 host 后，若 host 的消息结构与 mock 出现差异，以 host 为准，mock 必须改。
- 做多会话时，S 轴与 `session_id` 一起回来，本 ADR 第一条作废。
