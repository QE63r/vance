# Labs: remote takeover (experimental)

> **Not part of Vance's core promise.** This is an experimental fallback for GUI-only
> blockers (login, captcha, file picker). The main product is the local-first approval
> layer; do not evaluate the project by this folder.

## 任务卡：远控 v1

- 状态：**实验性，功能可用（全屏画面 + 鼠标/键盘/文字 + 停止）**（2026-11-12）
- 关联：`packages/host/src/server.ts`、`labs/remote/tools/screen-stream.ps1`、`labs/remote/tools/remote-input.ps1`、`packages/web/src/ui/ScreenPanel.tsx`
- 基线：173 passed

【一句话】

手机「控制」页能看到电脑实时画面，并显式进入控制：点击、拖动、滚轮、文字、回车/退格/方向键；随时停。

【已接】

1. 画面
   - Host 在手机连上后启动原生 `screen-capture.exe`，目标 30 fps、960 宽、JPEG（质量 42）；
   - 没有原生 exe 时回退 `screen-stream.ps1`（5 fps）；
   - 二进制帧走现有 WebSocket，不经过 JSON/历史；
   - 画面没变化就不发，静态桌面不烧流量；没有手机看时自动停；
   - Host 侧对慢客户端丢帧（`bufferedAmount` 上限 100KB，约 2 帧），不堆积延迟。
   - 原生抓屏会补一个光标圆环，手机能看到电脑光标位置。
2. 输入
   - 手机发送归一化 `x/y`（0..1）+ 动作；
   - Host 白名单校验后交给 `remote-input.ps1`；
   - 常驻 PowerShell 输入进程，避免每帧/每点击起进程；
   - 鼠标 move/down/up/click/right/wheel；键盘 Enter/Backspace/Esc/Tab/Delete/方向/Home/End/PageUp/PageDown；
   - 文字通过剪贴板 + Ctrl+V，支持中文。
3. 手机 UI
   - 「控制」页点画面打开 viewer；viewer 全屏不透明，点背景不会误关；
   - **全屏 / 2/3** 两档布局；全屏会请求浏览器 Fullscreen + 尝试锁横屏；
   - 画面用 `<canvas>` 直接绘制，不依赖 `<img>` 的 blob 重绘；
   - 「手机键盘」按钮直接 focus 输入框，调起系统软键盘；「功能键」可收起/展开回车、退格、方向键；
   - 「开始控制」后画面变为可点击区；点击=左键，右键菜单=右键，滚轮=滚轮；
   - 关闭 viewer 自动发 `remote_stop`；断线后不再有输入。
4. 安全边界
   - 只有已授权 WS 设备能发；仍用现有 token；
   - 输入动作和键位白名单，不接受任意命令；
   - 必须手机显式「开始控制」；不做 Agent 盲点坐标；
   - 断开连接自动停止（没有持续输入状态）。

【已验证】

- Host 57 tests；全量 **173 passed**。
- WS 发 `remote_pointer`，Host 日志出现「远控输入已接」。
- WS 连 7 秒收到 149 帧（约 21.3 fps 实际，目标 30 fps），平均 43 KB/帧（960 宽更清晰）。
- 输入脚本单条 JSON smoke test 通过。
- 手机端本地加指针圆环，触摸/移动立即有反馈，不等下一帧。
- 手机页面 canvas 连续三次采样哈希不同（帧在重绘）；<img> 的 src 也持续变化。
- 2/3 档实测高度 496/752（66%）；「手机键盘」后 activeElement 是输入框、功能键收起。

【v1 边界（下一步再补）】

- 当前是**全屏画面**，不是只抓目标窗口；下一步做窗口选择/裁剪 + 坐标映射。
- 没有「一次会话授权/倒计时」和远端确认；现在靠手机显式开始/停止。
- 没有剪贴板读取、文件传输、音频、多指/手势。
- 没有账号/中继/E2E；仍只适合本机/可信 LAN + Funnel。
- 仍是 GDI 抓屏 + JPEG，实测约 20 fps，达不到 60fps/视频级；下一版可做窗口裁剪、脏区/编码优化。

【验收】

1. 手机打开梵境 → 控制 → 点画面 → 开始控制。
2. 在画面上点/拖/滚轮，电脑对应位置有反应。
3. 输入文字并发送，电脑当前焦点应用收到（中文也可）。
4. 按回车/退格/方向键有效。
5. 停止控制/关闭 viewer 后电脑不再收到输入。
6. `pnpm test` 173。

【下一步】

- 窗口级远控：选择豆包/Cursor/Edge 窗口，只抓该窗口并裁剪坐标；
- 一次性会话确认/超时自动停；
- 剪贴板读取与文件交接接第 5 张。
