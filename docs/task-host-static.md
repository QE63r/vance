# 下一张任务卡：把真 host 接上前端

> 仓库：`C:\Users\1\Desktop\梵境\vance`（**不在 DSH 默认工作区**；若当前 cwd 不是它，先 cd 过去）
> 新会话第一件事：把下面【验收】原样复述一遍，确认无误再动手。
> 复述错了 = 卡没写清；复述对了 = 开工。

---

【任务】让 `packages/host` 托管 `packages/web` 的构建产物，并在真 host 上跑通会话第一屏

【验收】

1. `pnpm test` 全过（基线 **100 passed / 0 failed**），且新增 ≥2 条 host 静态路由用例
2. `pnpm --filter @vance/web build` 后，浏览器打开 `http://127.0.0.1:8787/app/`
   看到的是会话视图（不是 `public/index.html` 测试台）
3. 用 `tools/host-demo.mjs` 起真 host 时，手机页面能连上，顶栏显示 `hello` 里的 project

【边界】

- 不动 `packages/core` 的事件结构
- 不动 `packages/web` 的四轴 reducer 与 mock 协议（前端只加构建产物接入）
- 不做 session 多开、不做列表屏 / 设置屏
- **token 仍走 query**：hash 化单独一张卡（要动二维码、`start-dev.cmd`、文档）

【上下文】

- `HANDOFF.md` §6 第 1 步
- `adr/0006-frontend-first-screen.md`（这一屏做到哪、为什么）
- `docs/frontend-ia.md` §4.2（包与集成方式）
- 现状：host 只服务单文件 `pagePath`；`/app/*` 与 SPA fallback 都还没有

【开工前】

```
git status            :: 必须干净
git tag before-host-static
pnpm test             :: 记下测试数（应为 100 passed）
```

【完成后】

1. 贴 `pnpm test` 结果（passed / failed）
2. 贴 `git log --oneline -3`
3. 更新 `HANDOFF.md` §6（把「接真 host」划掉，换成下一张卡）
4. 若做了取舍（例如构建产物放哪、缓存头怎么给），加一条 ADR

【改坏了】

```
git reset --hard before-host-static
```

---

## 为什么是这张卡，不是 token 或列表

- **先接真 host**：前端现在只在 mock 上跑过。不接真 host，后面所有屏都是纸上谈兵。
- **token 单独一张**：它要改二维码生成、启动器、文档，还要考虑旧链接失效；混在一起会变成两个任务。
- **列表/设置最后做**：它们依赖 `session_id` 与 `sessions` 接口，而后端 P0 还没动。
