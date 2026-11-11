# ADR-0019：审批收敛（C：计划级审批）

- 状态：**C1 已落地；C2 设计完成、未实现**（2026-11-11）
- 日期：2026-11-11
- 关联：ADR-0012（权限档位）、`docs/task-approval-convergence.md`、`packages/policy`

## 背景

`workspace` 档原来对工作区内的写/删/脚本直接放行，只在时间线留一条
“已自动放行（免问）”。结果：动作先做了，人才知道；控制塔的“待你决定”不可信。

用户选择 **C（计划级审批）**，目标：

- Agent 先交计划（将改哪些文件、跑什么脚本）
- 人批计划
- 计划内自动
- 计划外再问
- 硬禁止永远不放

## 决定

### C1 计划外先问（已落地）

- `policy` 的 `workspace` 档：
  - 读：自动
  - 工作区内写/删/脚本：`ASK`
  - 工作区外：`ASK`
  - `full` / `read-only` 行为不变
  - 硬禁止不变
- 启动器在用户批准后，把“本轮同类”（`grantKey`）放进 `turnGrants`；
  同类第二次起自动；换任务/换一轮重新问。
- UI 权限档位文案改成“工作区内写/脚本先问一次，本轮批准后同类放行”。
- 测试：policy 21 条通过；原来的“直接放行”用例改成“先问”。

### C2 计划内自动（设计完成、未实现）

1. **Agent 提交计划**
   - MCP 工具 `vance_plan`：参数 `steps[]`，每步含
     `kind / action_display / facts`（writes/deletes/script/program）
   - 工具 POST 到 host `/plan`，带主 token；拿到 `plan_id`
2. **host 存计划**
   - `POST /plan`（token）：存 `{plan_id, session_id, steps, expires_at, status=pending}`
   - 发 `plan_request` 给手机；手机显示计划卡
   - `POST /plan/decision`：allow/reject；发 `plan_decision`
   - `GET /plan/:id`：给 MCP 工具轮询结果（allow/reject/timeout）
3. **手机计划卡**
   - 列出“将要改哪些文件 / 跑哪些脚本”
   - 按钮：拒绝 / 批准计划
   - 批准后显示“计划内自动，计划外会再问”
4. **计划内/外判定**
   - host-demo 保存已批准计划的 grants
   - `classifyApproval` 之前先查 plan grants：命中 → 自动（通知“计划内”）
   - 未命中 → 走 C1（弹卡）
   - 计划有有效期；换轮/停止/拒绝即失效
5. **Agent 约束**
   - 项目的 `AGENTS.md` 要求：任何写文件/跑脚本前先调用 `vance_plan`
   - 没调用计划工具时，C1 仍会弹卡兜底；不会退回到“先做后说”

## 为什么先 C1

没有 C1，C2 只是装饰：Agent 不交计划时仍然自动写；计划外也没有“再问”的基线。
C1 让“计划外”真的会停下来，C2 才有意义。

## 后果

- 现在 workspace 写/脚本会多一次打断；批准后同类不再问。
- `full` 仍是任务级；硬禁止不变。
- C2 需要新协议、MCP 工具、计划卡；**未实现前不要声称“计划级审批已完成”**。
- 计划审批不是“AI 摘要”；计划步骤来自 Agent 的事实/动作，人批的是具体动作。

## 没做什么

- 没有实现 `vance_plan` MCP 工具、`/plan` 端点、计划卡。
- 没有把“计划内自动”接进 `classifyApproval`。
- 没有做计划模板/计划变更重批。
- 没有做多 Agent 的计划合并。
