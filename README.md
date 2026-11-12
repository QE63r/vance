# Vance（梵境）

跨生态 Agent 移动控制面。P0/P1 已收口：会话视图、审批收敛、计划级审批、
移动策略、交付物检阅、任务列表、事实契约都已接通；计划卡、撤销移动、撤销清单页已在真机验收。
控制塔壳 1+2 已真机验收（命令条 fixed 修复后确认）；PC 真实配对/软件发现/状态已接；
桌面壳 v0（托盘 + 隐藏 Host）已落地；远控待接。

> 项目构想与计划书：[docs/product-plan.md](docs/product-plan.md)
> 当前交接：[HANDOFF.md](HANDOFF.md)；下一张卡：[docs/task-desktop-shell.md](docs/task-desktop-shell.md)
> PC 客户端：`packages/web/src/pc/`；入口 `/pc` / `/app/#/pc`；桌面壳：`packages/desktop/`

## 结构

```
packages/
  core/              事件模型（四类事件 + 信封字段 + zod schema）
  adapter-base/      fail-closed 基类，任何适配器不得绕过
  adapter-opencode/  ACP 适配器（现役，含 session/load 恢复）
  adapter-claude/    Claude Code 适配器（P2，空壳）
  policy/            禁止清单 / 只读判定 / 记住规则 / 本轮授权
  host/              HTTP + WS + 设备配对 + `/app/*` 静态托管
  web/               真前端（会话第一屏，Vite + React 19）
  desktop/           WebView2 桌面壳 v0（.NET 8）
  relay/             控制面网关（P5，空壳）
docs/                event-model / adapter-contract / frontend-ia
adr/                 架构决策记录（0001–0020）
```

## 命令

```bash
pnpm install
pnpm test        # turbo 依次构建 core → 跑各包测试
pnpm build
pnpm typecheck
pnpm desktop:build  # 桌面壳 v0（需要 .NET 8 SDK + NuGet）
```

PowerShell 里如果 `pnpm` 被执行策略拦住，用 `pnpm.cmd`，或执行一次
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

## 启动器

日常用桌面上的 **梵境桌面** 快捷方式（指向 `packages/desktop/bin/VanceDesktop.exe`）：
无终端、托盘常驻、Host 自动拉起、无边框 WebView2 窗口。

开发调试才用 **梵境 Vance** 终端（`start-dev.cmd`）：里面有 `t` 测试、`b` 构建、
`k` 类型检查、`i` 装依赖、`s` git status、`l` 最近提交、`c` VS Code。

## 从哪读起（给不熟悉 TypeScript 的人）

不用按目录顺序读，按这个顺序看两份文件就够：

1. `packages/adapter-base/src/index.ts` —— 75 行，整个产品的安全底线。
   先读文件开头那段注释，再读 `handle()`，每一步为什么这么排都写在旁边。
2. `packages/adapter-base/test/fail-closed.test.ts` —— 用它反推上面那 75 行：
   五个测试，就是五种"必须被拒绝"的情况。
3. `packages/core/src/events.ts` —— 数据长什么样，没有逻辑，当字典查。

看的时候不需要会写，能回答这三个问题就算读懂了：

- 为什么"断线"要排在"翻译"前面判断？
- 为什么"不认识的事件"要拒绝，而不是放行？
- 如果一个新人给 `route()` 加了一种事件类型，却忘了写规则，会发生什么？

## 现在的状态

- [x] workspace、TypeScript、Vitest、Turbo 跑通
- [x] core：信封 11 字段 + 四类事件 + facts v1（含 `string[]`）
- [x] adapter-base：fail-closed 的默认拒绝路径 + 单测
- [x] adapter-opencode：ACP 适配器、session/load 恢复、命令方言 → facts
- [x] policy：只读 facts；禁止/记住/只读/问人；不解析命令文本
- [x] host：WS、设备配对、审批补发、`/app/*`、会话、审计、`/rules`
- [x] web：会话第一屏、`⋯` 任务列表/切换、规则撤销、断线重连
- [x] 交付物仓库 / 任务生命周期 / token hash
- [x] C1 审批收敛：工作区写/脚本先问，本轮同类放行
- [x] C2 计划级审批：`/plan`、`vance_plan`、计划卡、路径 grants
- [x] 空计划 / 无具体目标计划拒收
- [x] 移动策略（批量/禁止根目录）+ 撤销清单 + `/undo/:plan_id` + 手机撤销按钮
- [x] `GET /undo` + 「⋯ → 撤销移动」清单页（刷新后仍可撤；撤销后清计划 grants）
- [x] `pnpm test`：172 passed / 0 failed
- [x] 手机真机点计划卡验收（批准 / 拒绝）
- [x] 控制塔壳 1+2（真机验收通过）
- [x] PC 客户端 UI（首次启动/主页/设置/软件/设备/账号菜单）
- [x] PC 真实接线（`/pc/pair`、`/pc/apps`、`/pc/status`；本机限制；已配对重连通过）
- [x] PC 桌面壳 v0（托盘 + 隐藏 Host + 无边框 WebView2；冷启动通过；安装包待）
- [ ] PC 远控 / 安装包
- [ ] APK / 通知 / adapter-claude / relay

## 环境备注

- **开机自启当前是禁用状态**：`启动` 文件夹里是 `vance-autostart.cmd.disabled`。交付前要恢复（运行 `tools\install-service.cmd`）或每次用 `start-dev.cmd` 启动。
- Node v24.21.0（计划书写的是 22 LTS；24 向下兼容，先按 24 走，M2 接 node-pty 时再验证）
- git 2.56.0.3（winget 安装）
- 提交身份临时设为 `Vance Dev <dev@vance.local>`，可在 `git config` 里改
