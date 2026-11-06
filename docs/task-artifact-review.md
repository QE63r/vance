# 下一张任务卡：交付物检阅（artifacts review）

> 仓库：`C:\Users\1\Desktop\梵境\vance`；先 cd 过去。
> 复述【验收】后再动手。

【任务】一轮跑完后，手机能**打开产出原件**看（不做摘要/翻译），并给出「确认交付 / 打回重做」；
验收绑定文件哈希，取文件用**短时单文件票据**，不把主 token 放进链接。

【验收】

1. `pnpm test` 全过（基线 114 / 0 failed），新增 ≥5 条：
   票据要 token、过期/跨文件取不到、任意路径 404、文件变化后验收 409、验收记录进流水（含 sha256）。
2. 真 host 跑一个会产出文件的活（图片 / PDF / 纯文本任一）：
   产出清单点开 → 看到**原件内容**（不是一句话总结）；点「确认交付」→
   `history.jsonl` 出现一条 `artifact_decision`（path / sha256 / by / at / session_id）。
3. 安全：不带票据直接取文件 → 404/401；把票据链接复制到别处，60 秒后失效；
   把路径换成产出清单以外的文件（如 `C:\Windows\win.ini`）→ 404；
   `POST /artifacts/ticket` 不带 token → 401。

【边界】

- **不做 AI 摘要、不做转写、不做"要点提炼"**；只呈现原件。
- docx / xlsx 这一版**只给下载原件**，不做文本抽取、不做格式转换预览（避免"看到的不是原件"）。
- 不做任意文件浏览器：只允许**当前会话最近一次 artifacts 里列出的路径**。
- 只读：不写、不删、不改名；不做上传。
- 不做多用户/客户账号；验收人就是已配对设备。
- 不动 token hash（单独卡）；票据只解决"取文件"这一件事。
- 不做桌面截图/UI 自动化。

【上下文】

- `adr/0002-event-envelope.md`（批准绑定原始字节 → 验收绑定 sha256）
- `adr/0004-steps-not-summaries.md`（不做 AI 摘要）
- `adr/0009-audit-and-artifacts.md`（artifacts 结构）
- `adr/0010-session-list-ui.md`（产出面板现状）
- `docs/frontend-ia.md` 产出区设计

【开工前】

```
git status
git tag before-artifact-review
pnpm test            # 记 114
```

【完成后】

1. 贴 `pnpm test` 数字
2. 贴一条 `artifact_decision` 流水
3. 贴一次"票据过期 / 非产出路径"的实测结果
4. 更新 `HANDOFF.md` §6，补 `adr/0012-artifact-review.md`

【改坏了】

```
git reset --hard before-artifact-review
```

---

## 口径（定死）

### 接口（host）

- `POST /artifacts/ticket`，头 `x-vance-token`，body `{ path }`
  → `{ ticket, path, sha256, size, content_type, expires_at }`
  - path 必须**精确命中**当前查看会话最近一次 artifacts 的 added/changed 列表，否则 404；
  - 票据 60 秒有效，只对应这一个文件；期间允许多次取（PDF 会分段请求）；
  - 签发时算 sha256，记在票里。
- `GET /artifacts/<ticket>` → 文件字节；过期 410，未知票 404；`Range` 支持可选。
- `POST /artifacts/accept`，头 `x-vance-token`，body `{ ticket, decision: "accept" | "reject", note? }`
  - 重新算文件 sha256；和票里的不一致 → **409 文件已变化，请重新查看**；
  - 一致：写一条 `{ type:"artifact_decision", path, sha256, decision, by, at }` 进流水；
  - reject 且带 note：同时把 `交付物未通过：<note>` 作为 prompt 交给 Agent（走现有 onPrompt）。
- 票据/验收都要 token；**token 只放请求头，不进 URL**。

### 手机端

- 产出面板的每个文件可点：图片 / PDF / 文本直接预览；
- 其它类型：只给「下载原件」和一句"手机上无法预览，请下载/回电脑看"；
- 底部两个按钮：确认交付 / 打回重做（打回可写一句意见）；
- 已验收的文件在清单里标「已确认 · 时间」，重新预览不改变记录。

### 审计语义

- 验收记录绑定 `sha256`：**你确认的就是你看到的字节**；
- 文件在验收后又被改，下一次预览会显示新的哈希，旧验收不自动作废，但界面上要标"文件已变化"。

## 为什么是这张

审批只做"事前拦风险"是半截产品。客户真正要的是：**活干完了，我能读到交付物，再决定收不收**。
这一层不能用 AI 摘要替代——摘要一加，客户批的就是我们的转述，不是原件。

而且它不需要 UI 自动化：只要 host 能安全地把文件递给手机。比"点别人的弹窗"干净，也更贴控制面定位。

## 做完之后

- v1：docx/xlsx 的"转换预览"（明确标注转换件）或桌面端打开；
- v2：桌面审批接管（识别软件弹窗，手机点允许/拒绝）；
- token hash 仍需单独一张卡。
