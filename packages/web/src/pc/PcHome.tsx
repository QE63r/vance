import { PcIcon } from "./PcIcon";
import type { PcAppInfo, PcMode, PcSnapshot } from "./pcData";

export function PcHome({
  snapshot,
  mode,
  onMode,
  onShowQr,
  onNavigate,
  onAction,
  onContinue,
  onRefresh,
}: {
  snapshot: PcSnapshot;
  mode: PcMode;
  onMode: (mode: PcMode) => void;
  onShowQr: () => void;
  onNavigate: (view: "software" | "devices" | "settings") => void;
  onAction: (app: PcAppInfo) => void;
  onContinue: () => void;
  onRefresh: () => void;
}) {
  const phone = snapshot.phone;
  const apps = snapshot.apps.slice(0, 4);

  return (
    <main className="pc-main">
      <div className="pc-page">
        <div className="pc-page-head">
          <div>
            <div className="pc-eyebrow">接力</div>
            <h1>在手机上继续</h1>
            <p className="pc-page-sub">
              {phone
                ? `${phone.name} 已连接 · 同一 Wi-Fi · ${phone.lastSeen}`
                : "手机还没连接；扫码后就能继续电脑上的 AI 窗口。"}
            </p>
          </div>
          <div className="pc-head-actions">
            <button type="button" className="pc-btn ghost" onClick={onShowQr}>
              <PcIcon name="plus" size={13} />
              添加设备
            </button>
            <button type="button" className="pc-btn ghost icon-only" onClick={onRefresh} title="刷新状态" aria-label="刷新状态">
              <PcIcon name="refresh" size={14} />
            </button>
          </div>
        </div>

        <div className="pc-home-grid">
          <div className="pc-col">
            <section className={`pc-relay-card${phone ? "" : " empty"}`}>
              <span className="pc-relay-icon">
                <PcIcon name={phone ? "phone" : "qr"} size={21} />
              </span>
              <div className="pc-relay-main">
                <h2>
                  {phone ? "手机已连接" : "手机未连接"}
                  {phone && (
                    <span className="pc-live">
                      <i />
                      远控空闲
                    </span>
                  )}
                </h2>
                <p>{phone ? `${phone.name} · 同一 Wi-Fi · ${phone.lastSeen}` : "扫码配对后，手机会看到电脑上的软件。"}</p>
              </div>
              <div className="pc-relay-actions">
                <button type="button" className="pc-btn ghost" onClick={onShowQr}>
                  显示二维码
                </button>
                <button type="button" className="pc-btn primary" onClick={onContinue} disabled={!phone}>
                  在手机上继续
                  <PcIcon name="arrow" size={13} />
                </button>
              </div>
            </section>

            <section className="pc-card">
              <div className="pc-section-head">
                <h3>电脑上的软件</h3>
                <button type="button" className="pc-link" onClick={() => onNavigate("software")}>
                  全部软件
                </button>
              </div>
              <div className="pc-app-list">
                {apps.map((app) => (
                  <div key={app.id} className="pc-app-row">
                    <span className={`pc-app-icon ${app.tone}`}>{app.initial}</span>
                    <span className="pc-app-name">
                      <b>{app.name}</b>
                      <small>{app.note}</small>
                    </span>
                    <span className={`pc-status ${app.status}`}>
                      <i />
                      {app.status === "running" && "运行中"}
                      {app.status === "installed" && "已安装"}
                      {app.status === "missing" && "未安装"}
                      {app.status === "unknown" && "未检测"}
                    </span>
                    <button type="button" className="pc-btn ghost sm" onClick={() => onAction(app)}>
                      {app.action === "attach" && "接入"}
                      {app.action === "install" && "安装"}
                      {app.action === "open" && "打开"}
                      {app.action === "detect" && "检测"}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="pc-card pc-mode-card">
              <div className="pc-section-head compact">
                <h3>模式</h3>
                <button type="button" className="pc-link" onClick={() => onNavigate("settings")}>
                  了解区别
                </button>
              </div>
              <div className="pc-mode-body">
                <div className="pc-segmented">
                  <button type="button" className={mode === "remote" ? "active" : ""} onClick={() => onMode("remote")}>
                    远控
                  </button>
                  <button type="button" className={mode === "agent" ? "active" : ""} onClick={() => onMode("agent")}>
                    自动化
                  </button>
                </div>
                <div className="pc-mode-desc">
                  <b>{mode === "remote" ? "远控" : "自动化"}</b>：
                  {mode === "remote"
                    ? "人从手机看/点/打字，继续软件 AI；不需要装 Agent。"
                    : "Agent 改文件/跑脚本；需要安装组件，远控仍可用。"}
                </div>
              </div>
            </section>
          </div>

          <div className="pc-right-col">
            <section className="pc-card pc-status-card">
              <div className="pc-status-head">
                <h3>运行状态</h3>
                <span>本机</span>
              </div>
              <div className="pc-status-main">
                <i className={snapshot.hostOnline ? "on" : "off"} />
                <div>
                  <b>{snapshot.hostOnline ? "Host 已启动" : "Host 未连接"}</b>
                  <small>{snapshot.hostOnline ? `端口 ${snapshot.port} · 局域网可连` : "检查 Host 是否在运行"}</small>
                </div>
              </div>
              <div className="pc-status-lines">
                <div>
                  <span>手机</span>
                  <b>{snapshot.devicesOnline} 台在线</b>
                </div>
                <div>
                  <span>待你决定</span>
                  <b>{snapshot.pending === null ? "—" : `${snapshot.pending} 件`}</b>
                </div>
                <div>
                  <span>远控</span>
                  <b>{phone ? "空闲" : "未连接"}</b>
                </div>
              </div>
              <div className="pc-status-foot">
                <span>版本 {snapshot.version}</span>
                <button type="button" className="pc-link" onClick={() => onNavigate("devices")}>
                  查看设备
                </button>
              </div>
            </section>

            <section className="pc-card pc-recent-card">
              <div className="pc-section-head compact">
                <h3>最近产出</h3>
                <button type="button" className="pc-link">
                  全部
                </button>
              </div>
              {snapshot.recent.length === 0 ? (
                <div className="pc-recent-empty">
                  <PcIcon name="folder" size={18} />
                  <span>还没有产出</span>
                  <small>远控留存或文件产出会出现在这里。</small>
                </div>
              ) : (
                snapshot.recent.map((item) => (
                  <div key={item.id} className="pc-recent-row">
                    <span className={`pc-file-icon ${item.kind === "PNG" ? "image" : ""}`}>{item.kind}</span>
                    <span className="pc-recent-name">
                      <b>{item.title}</b>
                      <small>{item.note}</small>
                    </span>
                    <span className="pc-recent-time">{item.at}</span>
                  </div>
                ))
              )}
              {snapshot.recent.length > 0 && (
                <div className="pc-recent-all">
                  <button type="button" className="pc-link">
                    查看全部产出 ›
                  </button>
                </div>
              )}
            </section>

            <section className="pc-card pc-tip-card">
              <PcIcon name="lock" size={14} />
              <span>
                <b>远控时随时可停</b>
                <small>手机顶部会显示「远控中」；断开连接自动停止，不会后台继续操作。</small>
              </span>
            </section>
          </div>
        </div>

        <div className="pc-home-foot">
          <span className="pc-setup-status">
            <i className={snapshot.hostOnline ? "on" : ""} />
            本地运行 · 屏幕内容不上传
          </span>
          <span className="pc-foot-links">
            <button type="button" className="pc-link">
              帮助
            </button>
            <button type="button" className="pc-link">
              检查更新
            </button>
          </span>
        </div>
      </div>
    </main>
  );
}
