import { PcIcon } from "./PcIcon";
import type { PcAppInfo, PcSnapshot } from "./pcData";

export function PcSoftware({
  snapshot,
  onAction,
  onRefresh,
  onShowQr,
}: {
  snapshot: PcSnapshot;
  onAction: (app: PcAppInfo) => void;
  onRefresh: () => void;
  onShowQr: () => void;
}) {
  return (
    <main className="pc-main">
      <div className="pc-page">
        <div className="pc-page-head">
          <div>
            <div className="pc-eyebrow">软件</div>
            <h1>电脑上的软件</h1>
            <p className="pc-page-sub">把要接力的软件接入梵境；手机只操作目标窗口，不碰其他内容。</p>
          </div>
          <div className="pc-head-actions">
            <button type="button" className="pc-btn ghost" onClick={onShowQr}>
              <PcIcon name="phone" size={13} />
              连接手机
            </button>
            <button type="button" className="pc-btn ghost" onClick={onRefresh}>
              <PcIcon name="refresh" size={13} />
              重新发现
            </button>
          </div>
        </div>

        <section className="pc-card pc-software-card">
          <div className="pc-section-head">
            <h3>发现结果</h3>
            <span className="pc-software-count">{snapshot.apps.length} 个软件</span>
          </div>
          <div className="pc-software-list">
            {snapshot.apps.map((app) => (
              <div key={app.id} className="pc-software-row">
                <span className={`pc-app-icon lg ${app.tone}`}>{app.initial}</span>
                <span className="pc-software-name">
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
                <button
                  type="button"
                  className={app.action === "install" ? "pc-btn ghost sm" : "pc-btn primary sm"}
                  onClick={() => onAction(app)}
                >
                  {app.action === "attach" && "接入窗口"}
                  {app.action === "install" && "获取安装"}
                  {app.action === "open" && "打开"}
                  {app.action === "detect" && "检测"}
                </button>
              </div>
            ))}
          </div>
          <div className="pc-software-foot">
            <PcIcon name="lock" size={13} />
            只读发现：不启动、不登录、不读取软件内容；接入只绑定目标窗口。
          </div>
        </section>

        <section className="pc-card pc-software-note">
          <div>
            <h3>没有看到你的软件？</h3>
            <p>v1 先支持常见桌面 AI 和浏览器；未安装的给官方入口，不静默安装。</p>
          </div>
          <button type="button" className="pc-btn ghost sm">
            提交软件
          </button>
        </section>

        <div className="pc-home-foot">
          <span className="pc-setup-status">
            <i className={snapshot.hostOnline ? "on" : ""} />
            Host {snapshot.hostOnline ? "已启动" : "未连接"}
          </span>
          <span className="pc-foot-links">只支持明确列出的软件</span>
        </div>
      </div>
    </main>
  );
}
