# Vance（梵境）

跨生态 Agent 移动控制面。当前处于 **P0 环境搭建** 阶段：只有骨架，没有可用功能。

## 结构

```
packages/
  core/          事件模型（四类事件 + 信封字段 + zod schema）
  adapter-base/  fail-closed 基类，任何适配器不得绕过
  adapter-claude/ Claude Code 适配器（P2，尚未实现）
  relay/         控制面网关（P5，尚未实现）
docs/            event-model / adapter-contract
adr/             架构决策记录
```

## 命令

```bash
pnpm install
pnpm test        # turbo 依次构建 core → 跑各包测试
pnpm build
pnpm typecheck
```

PowerShell 里如果 `pnpm` 被执行策略拦住，用 `pnpm.cmd`，或执行一次
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

## 启动器

双击桌面上的 **梵境 Vance** 图标，会打开一个已配好 Node / pnpm / Git 的终端，
并进入本目录。也可以直接运行仓库里的 `start-dev.cmd`。

窗口里的快捷命令：`t` 跑测试、`b` 构建、`k` 类型检查、`i` 装依赖、
`s` git status、`l` 最近提交、`c` 用 VS Code 打开本项目。

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
- [x] core：信封 11 字段 + 四类事件的 zod schema + 快照测试
- [x] adapter-base：fail-closed 的默认拒绝路径 + 单测
- [x] git 仓库初始化，首次提交完成
- [ ] 真实策略引擎（Deny > Approval > Allow 的完整规则）
- [ ] adapter-claude / relay

## 环境备注

- Node v24.21.0（计划书写的是 22 LTS；24 向下兼容，先按 24 走，M2 接 node-pty 时再验证）
- git 2.56.0.3（winget 安装）
- 提交身份临时设为 `Vance Dev <dev@vance.local>`，可在 `git config` 里改
