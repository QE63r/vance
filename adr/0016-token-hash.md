# ADR-0016：App 链接里的 token 从 query 挪到 hash

- 状态：已接受并落地（2026-11-09）
- 日期：2026-11-09
- 关联：ADR-0014（固定入口）、ADR-0015（PWA）、`docs/frontend-ia.md` §1 缺口 8

## 背景

固定入口的二维码/链接原来是：

```
https://desktop-i999ip2.tailfa032f.ts.net/app/?token=<token>
```

query 会被浏览器历史、截图、代理日志、Referer 看到；token 是唯一门槛，泄漏面太大。
前端已经同时支持 `?token=` 和 `#token=`，也有“读一次即抹”的逻辑；缺的是**生成端**没改。

## 决定

1. **所有新生成的 App 链接统一用 hash**：

   ```
   https://desktop-i999ip2.tailfa032f.ts.net/app/#token=<token>
   ```

   hash 不发给服务器，也不进 Referer；前端读完立即 `history.replaceState` 抹掉。

2. **旧 `?token=` 继续兼容**：已配对手机、旧二维码、旧 `tunnel-url.txt` 不失效。
   新链接不再生成 query。

3. **WebSocket 继续用 `?token=`**：WS 的 URL 不进浏览器历史，也不该把 token 放
   `Sec-WebSocket-Protocol` 里增加复杂度；这是传输层，不是可分享的入口。

4. **生成端一起改**：`tools/host-demo.mjs`、`tools/print-connect.mjs`、
   `tools/print-url.mjs`、`tools/setup-tunnel.mjs`、`tools/check-render.mjs`、
   `tunnel-url.txt`、二维码、文档示例。

## 后果

- 地址栏/历史/截图里的 token 不再是“服务器能收到”的东西；但截图仍可能看到完整 hash，
  所以**短时配对票据**仍值得后面做。
- 旧链接还能用；不需要强制所有人重扫。
- `print-connect` 读旧 `tunnel-url.txt` 时会把 `/app/?token=` 归一化成 hash，避免旧文件
  把 query 又带回来。
- 如果用户把“去掉 hash”的地址发给别人：页面能打开，但没有 token，连不上；符合预期。

## 没做什么

- 没有做短时配对票据/一次性码；token 仍是长期口令。
- 没有把 token 移出浏览器存储；PWA 边界不变。
