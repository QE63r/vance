# ADR-0014：固定入口与设备记住

- 状态：已接受
- 日期：2026-11-09
- 关联：ADR-0007（静态托管）、（内部任务卡已移除）、HANDOFF §10

## 背景

手机要“扫码一次、以后不再扫”，前置是入口地址不能每次重启都变。
quick tunnel 每次重启换域名，App 即使记住 token 也会失效。

之前 HANDOFF 里的结论是“Tailscale Funnel 在这条网络只解析到 `100.x`，手机没装
Tailscale 不可达”，所以把固定入口当成“要有域名 + Cloudflare”的问题。但后来
Funnel 实际是开着的：公网 DNS 能解析到 `103.84.155.153`，手机用 5G 也能打开
页面。旧结论是 Funnel 没开时的误判。

另一个问题在配对：设备批准只记在内存。host 一重启，手机就变回“第二台”，
而上一台已批准设备（电脑浏览器）可能已经离线，点不了“允许”——手机会一直卡在
“等待确认”。

## 决定

### 一、固定入口用 Tailscale Funnel

- 地址：`https://desktop-i999ip2.tailfa032f.ts.net`
- `tailscale funnel` 把 443 代理到 `127.0.0.1:8787`
- 不需要买域名，不需要 Cloudflare 账号，手机也不需要装 Tailscale
- 前提：这台机器的 Tailscale 机器名和 tailnet 不变

### 二、启动器优先固定入口

- `v` 新起 host 时带 `VANCE_FUNNEL=1`：`host-demo` 检测 Funnel 开着且代理 8787 就用
  固定地址、写 `tunnel-url.txt`、出固定二维码；没配 Funnel 才回退 quick tunnel
- host 已在跑时，`v` 只出二维码/地址，**不再打开电脑浏览器**
  （电脑浏览器会抢“第一台已批准设备”，手机反而要审批）
- `print-connect` 同样优先 Funnel；二维码改成 19 行半高块并先清屏，避免短终端把码顶出可见区

### 三、设备批准落盘

- 已批准设备写 `~/.vance/devices.json`（只写 approved，不写 pending）
- host 启动时恢复；恢复的设备没有 socket，等它重连再 attach
- 重连时把 `attached` 复位，否则第二次连接收不到 hello
- 第一台设备仍然自动信任；新设备要已有设备在线点头
- 临时 `approveAllDevices` 只留给单测/一次性排障，启动器默认不开

### 四、公开入口的边界

- Funnel 是公网入口，token 是唯一门槛；token 仍在 query，会进历史/截图
- 没有端到端加密；2 fps 画面走公网，带宽/延迟要真机看
- `devices.json` 是明文；`deviceId` 是客户端自报，设备审批不是强认证
- 这些是 PWA / APK 阶段要收紧的债，不在本 ADR 里假装解决

## 后果

- 手机 5G 可直连；host 重启后手机仍是“已配对”，不用再等允许
- 固定地址不随 host 重启变化；quick tunnel 只作为回退
- 测试 130 → 133（host 35 → 38）：落盘恢复、重启后新设备仍要审批、断开重连再收 hello
- 入口不再挡 PWA；下一张卡可以直接做 App v0

## 失效条件

- 若 Funnel 被关掉，或代理不指向 8787，启动器会回退 quick tunnel/局域网，固定入口失效
- 若 `devices.json` 被删，手机要重新走一次审批
- 若 token 重新生成，旧二维码和旧链接全部失效
- 若 Tailscale 机器名或 tailnet 改名，`.ts.net` 地址会变，需要重新出码
