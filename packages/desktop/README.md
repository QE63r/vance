# 桌面壳 v0

双击 `bin\VanceDesktop.exe`（或桌面快捷方式 `梵境桌面.lnk`）：

- 如果 8787 没有 Host，隐藏启动 `tools/host-demo.mjs`（无终端，日志写 `~/.vance/desktop-host.log`）；
- 如果已有 Host，直接复用，不重复启动；
- 已经有一个桌面壳在托盘时，再双击只打开面板，不再弹“已在运行”；
- 用 Edge app 模式打开 `http://127.0.0.1:8787/pc?shell=1&view=home`；
- 托盘常驻：打开面板 / 开机自启 / 打开日志 / 退出；
- 关掉 Edge 窗口只关面板，Host 和托盘还在；从托盘退出时才停掉自己启动的 Host。

## 构建

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packages/desktop/build.ps1
```

产物：`packages/desktop/bin/VanceDesktop.exe`（不提交）。

## v0 边界

- 用 Edge app 窗口承载页面，不是 WebView2/Tauri 原生壳；先验证“无终端 + 托盘 + 内置启动”的路径。
- 依赖本机 Node 和 Edge；安装包（第 4 张）再打包运行时。
- 页面 `?shell=1` 会隐藏网页里的假窗口按钮，保留品牌栏；窗口控制交给 Edge 原生边框。
- 托盘退出只停止“桌面壳自己启动的 Host”；复用的已有 Host 不动。
