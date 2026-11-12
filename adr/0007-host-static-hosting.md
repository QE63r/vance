# ADR-0007：host 静态托管 `/app/*`

- 状态：已接受
- 日期：2026-11-06
- 关联：ADR-0006（第一屏）、（内部任务卡已移除）（任务卡）、`docs/frontend-ia.md` §4.2

## 背景

前端此前只在 `packages/web/mock` 上跑过；真 host 只服务单个 `pagePath`（测试台页面）。
手机要打开真前端，host 必须托管构建产物，并且 `/app/` 下的路由要能回落到 `index.html`。

约束有两个：干净检出时 `dist/` 不存在（`.gitignore` 里的 `dist/`），
而 `@vance/host:test` 的 `dependsOn` 只构建上游、不构建 web。测试不能靠"先手动 build"。

## 决定

### 一、产物放 `packages/web/dist`，路径由调用方注入

`HostOptions` 增加 `webDir?: string`，`tools/host-demo.mjs` 传
`join(HERE, "..", "packages", "web", "dist")`，环境变量 `VANCE_WEB_DIR` 可覆盖。
`server.ts` 里不出现仓库路径。

理由：`dist` 是 Vite 默认输出，零配置；把产物塞进 `packages/host/public/app/` 会让
构建物和源码混在一起，`.gitignore` 也容易漏。代价是 host 不知道 web 在哪，
必须由启动器告诉它——所以 host-demo 是唯一的装配点。

### 二、缓存按"会不会变"分三档

| 路径 | 头 |
|---|---|
| `/app/`、`/app/**` 的 `index.html` | `no-store` |
| `/app/assets/*`（Vite 带内容哈希） | `public, max-age=31536000, immutable` |
| 其余静态（如 `favicon.ico`） | `no-cache` |

`index.html` 必须每次回源：它指向新 hash，缓存住就会拿到已删除的旧资源。
`content-type` 按扩展名白名单给，未识别的按 `application/octet-stream`，
不猜、不回 `text/html`。

### 三、顺序固定：`/health` → `/app/assets/*` → `/app` fallback → 其余 404

- `/app` 与 `/app/**` 中**不带扩展名**的路径回 `index.html`（前端自己路由）。
- **带扩展名但文件不存在 → 404**，绝不回 `index.html`。
  理由：浏览器会把 HTML 当 JS 执行，只留白屏 + 一句语法错误，比 404 难查得多。
- `/app/assets/*` 永不 fallback；缺文件就是 404。
- `/ws` 走 upgrade 事件，不经过这条 HTTP 链。
- 拼接前先 `decodeURIComponent` 并校验解析后的路径仍在 `webDir` 内，防 `..` 跳出。

### 四、base 只在 build 时切成 `/app/`

```ts
defineConfig(({ command }) => ({ base: command === "build" ? "/app/" : "/" }))
```

dev 仍是 `http://127.0.0.1:5173/` 根路径，mock 与 5173 的流程不变；
只有构建产物里的资源 URL 带 `/app/` 前缀。

### 五、入口地址改为 `/app/`

`host-demo` 打印的局域网、Tailscale Funnel、命名隧道、临时隧道地址全部改为
`…/app/#token=…`，二维码随之更新。`/` 上的测试台保留为诊断页，不再作为手机入口。
token 仍走 query；hash 化是另一张卡（要动二维码、启动器、文档）。

### 六、静态用例不依赖真 `dist`

测试用 `mkdtemp` 造临时目录：`index.html` + `assets/app-abc123.js` + `favicon.ico`，
通过 `webDir` 指过去。覆盖：`/app/` 的 `no-store` 与 HTML、`/app/assets/*` 的
immutable 与 content-type、无扩展名路由回落、`/app/nope.js → 404`、
非 assets 静态 `no-cache`、未配置 `webDir` 时 404。共 6 条。

## 后果

- 手机扫码直接进会话视图；`npm run dev` 的开发流程完全不变。
- 没 build 时 `/app/` 是 404（不是 500，也不影响 `/` 与 `/ws`）。
  部署/验收前先 `pnpm --filter @vance/web build`。
- 回滚友好：`index.html` 不缓存，旧 hash 资源仍可命中，换回旧 `dist` 即可。
- 测试基线从 100 涨到 106。

## 失效条件

- 引入 Service Worker / 离线缓存时，`no-store` 与 `immutable` 的组合要重排。
- 出现第二个入口前缀（如 `/admin`）时，fallback 规则要按前缀拆开，不能再一条通吃。
- 静态产物改由 CDN 托管时，本 ADR 第一、二条作废，只保留路径与 fallback 约定。
