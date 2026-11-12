# 桌面壳 v0（WebView2）

双击 `bin\VanceDesktop.exe`（或桌面快捷方式 `梵境桌面.lnk`）：

- 如果 8787 没有 Host，隐藏启动 `tools/host-demo.mjs`（无终端，日志写 `~/.vance/desktop-host.log`）；
- 如果已有 Host，直接复用，不重复启动；
- 已经有一个桌面壳在托盘时，再双击只打开面板，不再弹“已在运行”；
- 用无边框 WebView2 原生窗口打开 `http://127.0.0.1:8787/pc?shell=1&frameless=1&view=home`；
- **无原生标题栏**：页面标题栏负责最小化/最大化/关闭/拖动，窗口四边 5px 可缩放；
- **缩放固定 1.0，禁用浏览器缩放/加速键**，避免 Edge app 的磨砂和缩放问题；
- 托盘常驻：打开面板 / 开机自启 / 打开日志 / 退出；
- 关窗口只关面板，Host 和托盘还在；从托盘退出时才停掉自己启动的 Host。

## 构建

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packages/desktop/build.ps1
```

产物：`packages/desktop/bin/VanceDesktop.exe`（不提交；同目录的 DLL 必须一起保留）。
构建需要 .NET 8 SDK + NuGet（`Microsoft.Web.WebView2`）；运行需要 .NET 8 Desktop Runtime + WebView2 Runtime。

## v0 边界

- WebView2 无边框窗口，不是浏览器 app 模式；页面 `?shell=1&frameless=1` 显示网页窗口控制，原生标题栏已去掉。
- 依赖本机 Node 和 WebView2 Runtime；安装包（第 4 张）再打包运行时。
- 没做签名、自动更新、卸载向导。
- 托盘退出只停止“桌面壳自己启动的 Host”；复用的已有 Host 不动。
