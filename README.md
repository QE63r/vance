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
