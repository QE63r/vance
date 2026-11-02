# 接 Claude Code：安装、录制、验收

目标：拿到 **≥8 个真实 payload**，每个都能用 `computeRawDigest` 校验。
这批 fixture 是 `adapter-claude` 的唯一输入——没有真实 payload，适配器就不算完成。

---

## 阶段 0　前置条件（先确认，不满足就别往下走）

- [ ] Node ≥ 18（本机 26.13.0 ✓）
- [ ] 有 Anthropic 账号（Pro/Max 订阅）**或** `ANTHROPIC_API_KEY`
- [ ] 能访问 `api.anthropic.com`

**这一步最可能卡住。** 如果账号或网络拿不到，直接跳到文末「B 计划」，不要硬耗。

---

## 阶段 1　安装（已完成）

```bat
npm install -g @anthropic-ai/claude-code
claude --version
```

本机版本：**2.1.316**。如果 `claude` 提示找不到命令，重开一个终端窗口。

---

## 阶段 2　登录并跑通

```bat
cd C:\Users\1\Desktop\梵境\sandbox
claude
```

首次会要求登录（浏览器授权或粘贴 API key）。登录后先做一件无害的事确认能用：

```
你：列一下当前目录的文件
```

看到它调用了 `ls` 并返回结果，说明链路通了。**先别给它删东西的任务。**

---

## 阶段 3　挂上抓包 Hook（配置已经写好了）

沙箱目录里已有 `.claude/settings.json`，它把 `PreToolUse` 指向：

```
C:\Users\1\Desktop\梵境\vance\tools\capture-hook.mjs
```

这个脚本做三件事：读 stdin → 原样存进 `vance/fixtures/raw/` → **输出 deny**。

> ⚠️ 录制阶段它拒绝一切动作，这是有意的：我们还没写判断逻辑，放行等于裸奔。
> 你会在终端里看到 Claude 抱怨被拒绝，那是正常的。

**如果 hook 没生效**（终端里没有任何 `[vance] captured` 提示），多半是版本里
hooks 的字段名不一样。把 `claude --help` 里 hooks 那一段发我，我按你的版本改。

---

## 阶段 4　触发五类动作

在沙箱里，依次让它做下面这些（每次它会被拒绝，但 payload 已经录下来了）：

| # | 让它做的事 | 我们想看到什么 |
|---|---|---|
| 1 | 读一个文件 | 只读类命令长什么样 |
| 2 | 创建一个新文件并写入 | 写操作的参数结构 |
| 3 | 删除一个文件 | 删除类动作，最有价值 |
| 4 | 执行 `npm install` 之类 | 网络/依赖类 |
| 5 | 跑一条会报错的命令 | 错误输出怎么回传 |

再顺手录一条 **`question`**（让它反问你一个问题）和一条 **`status`**（长任务中途停一下）。

---

## 阶段 5　验收

```bat
cd C:\Users\1\Desktop\梵境\vance
dir fixtures\raw
```

合格标准：

- [ ] 至少 8 个 `.json`（原文）+ 对应的 `.meta.json`
- [ ] 每个文件名都是 64 位十六进制（就是 raw_digest）
- [ ] 随便挑一个，用 `computeRawDigest` 重新算一遍，结果和文件名一致
- [ ] 里面有 `tool_name` / `tool_input` 这类字段

达标后把这批文件提交，我就能照着写 `translate()` 了。

---

## B 计划（拿不到 Anthropic 账号时）

不要卡在这一步。三个替代，按推荐顺序：

1. **Aider**（开源，支持任意模型）——`pip install aider-chat`，它有自己的确认流程，
   可以先让整条链路（捕获 → 适配 → 审批页）跑起来。适配器换成 Aider 的格式而已，
   `adapter-base` 和 `core` 一行都不用改。这也是计划书里写的备选方案。
2. **自造事件源**——写个 20 行的假 Agent，按 `core` 的 schema 往 Host 发事件。
   能验证链路，验证不了"真实协议长什么样"。
3. **等**——不推荐，会把整个 M2 卡住。

---

## 一条必须记住的坑

Hook 脚本如果**崩溃**，Claude Code 的默认行为可能是**放行**。
所以 `capture-hook.mjs` 里所有错误分支都强制 `deny`——这就是 fail-closed 的现场演示：
不是"出错时尽量继续"，而是"出错时一定停下"。
