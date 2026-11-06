# 梵境 · 交接单

> 给"下一个会话"或"三个月后的自己"看。
> 读完这一页 + `adr/` + `git log`，就能接着干，不需要任何对话记录。

---

## 0. 一句话

**手机是电脑的操作端：看得见、说得上、停得下、做得了。**
卖的不是效率，是"人不用守在屏幕前"。

判断优先级（有分歧时按这个）：

```
可信 > 好用 > 跨生态
看得见 > 能操作 > 全自动
```

## 0.5 文档维护规则（新会话必读）

对话会耗尽，新窗口只能看到仓库。**只更新 HANDOFF 是不够的**：学习日志和构想会断更。
下面这张表就是“什么时候该动哪份文档”，任务卡收口时逐行判断，不要跳过。

| 文档 | 什么时候更新 | 怎么更新 |
|---|---|---|
| **学习日志**（`1-项目文档\梵境学习日志_v3.docx`） | 出现新判断、被修正的判断、踩过的坑 | 读最新版 → 加一节（保持“先结论后过程”）→ 版本 +0.1 → 旧版移进 `9-归档\`。只写核心知识，不写代码。 |
| **构想**（`1-项目文档\梵境项目构想_v1.8.docx`） | 定位、边界、架构、路线发生变化 | 改对应小节 + 版本表；旧版进 `9-归档\`；同步配套计划书版本号。小功能不改构想。 |
| **计划书**（`1-项目文档\梵境项目计划书_v1.3.docx`） | 里程碑、路线、成功定义变化 | 改“当前路线”一节；旧的 14 周排期只作历史保留，不要复活。 |
| **源码学习注** | 新增/修改了安全或契约逻辑 | 直接写在源码里（`[学习注]`），并同步文件顶部的“学习注索引”。**不要导出 Word**——副本一定会过期。 |

### 文档在哪

```
C:\Users\1\Desktop\梵境\
├─ 1-项目文档\              三份最新文档（构想 / 计划书 / 学习日志）
├─ 2-学习注\                VS Code 快捷方式 + 先读我
├─ 3-交付证据\              截图 + 验证脚本
├─ 9-归档\                  旧版（v1.7 / v1.2 / v2 / 代码注 v1、v2 / 资源）
├─ sandbox\                 测试沙盒
└─ vance\                   代码；HANDOFF、adr\、docs\ 都在这里
```

代码学习注不在 Word 里：
`vance\packages\adapter-base\src\index.ts`（12 处）、`vance\packages\core\src\events.ts`（2 处）。
两个文件顶部有索引；`2-学习注\` 里有 VS Code 快捷方式。

### 改 docx 的固定做法

用 DSH 自带 Python，**必须加 `-P`**：

```
C:\Users\1\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe -P 脚本.py
```

为什么要 `-P`：`%TEMP%` 下有一个同名的 `inspect.py`，会遮蔽标准库，导致 `lxml` 导入失败。
做法固定为：备份 → 另存新版本 → 旧版移进 `9-归档\` → 导出文本核对 → 版式有改动就渲染检查。
**不覆盖旧版，不在原文件上直接改。**

### 新会话开场三件事

1. 读 §0.5 和 §6，确认“下一张卡”是什么；
2. `git status` + `pnpm test`，确认代码状态；
3. 对照上表看文档是否落后于代码；落后就先补文档，再开新功能。

任务卡收口时，除了更新 §6，还要在回复里明确一句：**这次动了哪份文档、版本号变成多少**。
没动，也要说“本次不需要更新学习日志/构想”，不能沉默。

## 1. 现在能跑什么

| 能力 | 状态 | 怎么验证 |
|---|---|---|
| 手机连电脑（局域网 / Tailscale Funnel） | ✅ | 打开 `.ts.net` 地址能进 |
| 扫码连接（终端出二维码） | ✅ | `v` 后扫窗口里的码 |
| **设备配对** | ✅ | 第一台自动信任；第二台要已有设备点头 |
| **实时画面** 2 fps | ✅ | 手机右下角小窗，静态时零流量 |
| 对话式指挥（opencode / ACP） | ✅ | 让它列文件、改文件 |
| 审批（命令 / diff / 记住） | ✅ | 拒绝真的生效 |
| 只读静默放行 | ✅ | 一天最多问 2 次 |
| **本轮授权**（同类操作一次批准） | ✅ | 一个任务 1–2 次审批 |
| **产物判定**（磁盘差异 + 内容校验） | ✅ | 每轮报告新增/改动/删除 |
| **MCP 工具**（doc→pdf） | ✅ | 说"转成 PDF" → 一次工具调用 |
| **停止**（cancel → taskkill） | ✅ | 按停止 3 秒内必定停下 |
| **会话恢复** | ✅ 已验证 | 杀进程后重连，Agent 仍记得上文 |
| 历史持久化 | ✅ | `~/.vance/history.jsonl` |
| 开机自启 + 崩溃重拉 | ✅ | 登录 Windows 后自动跑 |
| 中文不乱码 | ✅ | 控制台 65001；列 50+ 中文名无乱码 |
| **前端第一屏**（会话视图） | ✅ | `npm run dev` → 390×844 三块区域；断线显示"已断开，重连中" |

## 2. 架构（三层，别越界）

```
执行层  opencode（ACP）+ 本地工具（MCP: doc_to_pdf）
          ↓ 结构化事件（要做什么、原始字节、过期时间）
决策层  packages/policy（禁止清单 / 只读判定 / 记住规则 / 本轮授权）
          ↓ 放行 or 卡片
呈现层  packages/host（HTTP + WS + 手机页面）+ 手机
```

数据流：`session/prompt` → Agent 调工具 → `session/request_permission`
→ 策略判定 → 卡片/静默 → 回决定 → 执行 → 产出判定。

## 3. 核心约束（改代码前必须知道）

| 约束 | 含义 | 出处 |
|---|---|---|
| **11 字段事件信封** | request_id / agent_id / raw_digest / expires_at / signature… | ADR-0002 |
| **批准绑定原始字节** | 批准的是收到的那串字节，不是我们规范化后的理解 | ADR-0002 |
| **风险不由发送方声明** | 风险由本地规则按"事实"算，Agent 说了不算 | ADR-0002 |
| **fail-closed** | 拿不准就拒绝；绝不沉默放行，也绝不沉默挂着 | adapter-base |
| **核心路径零模型成本** | 边际成本不随用量增长 | ADR-0003 |
| **不做 AI 摘要** | 只搬运事实，不生成解释 | ADR-0004 |
| **用户不能给自己开后门** | 禁止清单硬编码，记住规则覆盖不了它 | policy |

## 4. 已知的坑（会咬人的）

1. **隧道地址**：临时 `trycloudflare` 每次重启都变 → 已改走 Tailscale Funnel（`.ts.net` 固定）。
2. **运营商热点有客户端隔离**：同一 wifi 也可能互相看不见 → 用手机热点绕。
3. **中文路径不能走命令行参数**：会被 GBK 控制台毁掉 → 用 Node 直接传参。
4. **Word COM 本机会静默卡死** → 已改用 LibreOffice CLI。
5. **`.cmd` 必须 GBK+CRLF；`.ps1` 必须 UTF-8 带 BOM**，否则引号被读断。
6. **生成 .cmd 时写入编码必须和 cmd 读取的代码页一致**（踩过：路径变成乱码）。
7. **Node 的 stdout 接管道会块缓冲** → 日志刷不出来，重要信息写文件。
8. **MCP 的 stdout 只能放协议消息**，日志走 stderr。
9. **改 MCP 配置要重启 Agent** 才生效。
10. **端口被占会伪装成"连不上"**：`EADDRINUSE` 直接退出 → 先查端口。
11. **LibreOffice 首次运行要建配置**（十几秒），第一次转换常失败 → 必须重试。
12. **配对只记在内存**：服务重启后"第一台"重新认定。
13. **改了代码要重启才生效** —— 不是"功能没用"，是进程还是旧的
    （曾因此误判 session/load 不可用，实际可用）。
14. **验证脚本自己也会骗人**：写错过一个 BOM 检查导致误报；
    采集事实的代码同样需要被验证。
15. **两个会话同时改同一个仓库会互相踩**：提交前看 `git status`，
    别把另一个会话的半成品一起提交。
16. **审批请求不进 history**：它们该以 pending 形式单独补发；重放旧审批会像「现在要你批」。
    已按 `session_id` 过滤，只补给同一条会话。
17. **Windows 上 Vite 会盯 mock 的临时文件**：编辑器写 `mock/host.mjs` 时 `EBUSY` 会让 dev 直接退出。
    已在 `vite.config.ts` 里 `watch.ignored` 掉 `mock/**` 和 `*.tmpdir/**`。
18. **`session/load` 成功不一定带 `sessionId`**：不兜底就会卡在启动（`start()` 永不返回，
    页面连上却没有"当前会话"）。adapter 现在用请求的 id 补上。
19. **流式 chat 片段会落盘很多行**：按"条"计历史会把一次对话从中间切碎。
    host 回放前按 `messageId` 合并片段，别再按行数估历史长度。

## 5. 半成品 / 没做的

| 项 | 现状 |
|---|---|
| **真前端** | 会话视图 + `⋯` 菜单（任务列表 / 切换 / 规则撤销）已落地；独立设置屏、路由、列表徽标没做 |
| 多会话（分装/切换） | 协议与最小切换已做（单执行、可看别条）；create / stop / 独立列表屏没做 |
| 点击 / 打字 | 没做；卡在对话框上还得回工位 |
| 加密 | 无；明文到 Funnel |
| 多电脑 / 多用户 | 没做 |
| **备份** | 仓库只在本地，**没有远程**（优先级高） |

## 6. 下一步（已定）

**第一屏（会话视图）+ 接真 host + 会话身份 + 审计与产出 + 任务列表 + 事实契约都已完成。**
取舍见 `adr/0006`…`adr/0011-facts-contract.md`（关键：`0002` 信封、`0008` 会话、`0011` 事实）。

做完了什么：

- `npm run dev` 起 Vite（5173）+ 假 host（8787）；390×844 下三块区域都在
- 四轴 `link / device / approvals / exec` 分字段存：断线时审批仍 `offered`、执行仍 `running`、
  设备仍 `trusted`（`packages/web/test/reduce.test.ts` 5 条用例）
- 断线显示「已断开，重连中」，恢复自动接上；`packages/web/scripts/shot.mjs` 可复现并出图
- ~~接真 host~~：`packages/host` 用 `webDir` 托管 `packages/web/dist` 到 `/app/*`；
  `vite build` 的 base 是 `/app/`，dev 仍是 5173 根路径；手机地址改为 `/app/?token=…`
- ~~会话身份~~：消息带 `session_id`、`history` 按会话分桶、`GET /sessions`、
  `WS ?session=` 回放；旧流水归 `legacy`（只读）；未知 id 给解释不静默切换
- ~~审计与产出~~：`decision` 广播并落流水（谁、何时、批/拒）、`artifacts` 结构化
  （added / changed / removed / warnings）、`GET /rules` + 撤销、`hello.server_time`
- ~~任务列表~~：顶栏 `⋯` → 任务列表（点着切换，`session/attach`，不重连）、
  记住的规则（列表 + 撤销）；切换只改"看哪条"，不停正在跑的任务
- ~~体验债~~：提交 8 秒无回执自动退回可重试、状态灯改「已配对/等待允许」、
  拦截文案说人话（"不能往 Program Files 里写文件"）、规则名换成「运行命令：…」
- ~~事实契约~~：`facts` 增加 `effect / writes / reads / deletes / program / danger`；
  命令方言（只读判定、危险识别）搬进 `adapter-opencode`；策略只读 facts，
  换 Agent 只换适配器。**这是"控制面"的边界，方向和功能一样重要。**
- 测试基线 121 → **112**：命令用例从 policy 搬到 adapter（adapter 15→38，policy 26→16），
  总量少了 8 条重复的文本用例，覆盖反而更贴近真实边界

下一步按这个顺序：

1. ~~接真 host~~（已完成，卡见 `docs/task-host-static.md`）
2. ~~后端 P0~~（已完成）：~~卡 1 会话身份~~（`docs/task-session-id.md`）→
   ~~卡 2 审计与产出~~（`docs/task-audit-artifacts.md`）
3. ~~列表 / 切换~~（最小版已完成：`⋯` 菜单，卡见 `docs/task-session-list.md`）；
   独立设置屏、列表徽标、路由仍未做
4. ~~事实契约~~（已完成，卡见 `docs/task-facts-contract.md`）：策略不再读命令文本；
   换 Agent 只加适配器
5. **交付物检阅**（下一张，卡：`docs/task-artifact-review.md`）：
   产出原件可看、确认交付/打回，验收绑定 sha256
6. **token 从 query 挪到 hash**（要动二维码 / 启动器 / 文档）

先别做的：真机上的点击/打字（要另立协议）；多电脑。

判定标准：**画得出来 = 想清楚了；画不出来就先别写代码。**

## 7. 任务交接模板（复制即用）

```
【任务】一句话，具体到能动手

【验收】必须是能敲出来的
  1. pnpm test 全过，0 failed
  2. 手机断网 → 显示"已断开"；恢复 → 自动接上
  3. 指定文件真的生成了

【边界】不做 A、不做 B；不动 packages/core 的事件结构

【上下文】读 HANDOFF.md「下一步」+ docs/frontend-ia.md

【开工前】git status 干净 → git tag before-<任务名>

【完成后】
  pnpm test 贴结果 → git log --oneline -3 贴出来
  没过：不提交，直接说哪里失败
  过了：commit + 更新 HANDOFF「下一步」
        + 按 §0.5 判断：学习日志 / 构想 / 计划书 要不要更新（要，就升版本、归档旧版）
        + 回复里写明这次动了哪份文档、版本号

【改坏了】git reset --hard before-<任务名> + 重启服务
```

不懂代码的人只看两个数字：`passed` 有没有涨、`failed` 是不是 0。

## 8. 关键文件

```
packages/core              事件信封（原始字节绑定）
packages/policy            禁止清单 / 只读判定 / 记住规则
packages/adapter-base      fail-closed 四步
packages/adapter-opencode  ACP 适配器（含 session/load 恢复）
packages/host              服务端 + 手机页面（测试台）
packages/web               真前端（会话第一屏）；mock/ 只给 dev
packages/web/scripts/shot.mjs  手机尺寸截图 + 断网复现
tools/host-demo.mjs        把三者接起来的入口
tools/mcp-vance.mjs        给 Agent 挂的可靠工具
tools/screen-stream.ps1    实时画面抓帧
adr/                       关键决定
```

## 9. 命令速查

```bat
start-dev.cmd      打开开发窗口
v                  启动（已在跑则显示地址）
vl                 只局域网
u                  看当前地址
t / b / k          测试 / 构建 / 类型检查
npm run dev        起前端：Vite 5173 + 假 host 8787（先跑过一次 pnpm install）
```

状态文件都在 `~/.vance/`：`token` 口令、`history.jsonl` 界面历史、
`session.json` Agent 会话、`rules.json` 记住的规则、`tunnel-url.txt` 公网地址。
