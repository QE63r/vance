import { PcIcon } from "./PcIcon";
import { PcQr } from "./PcQr";
import type { PcSnapshot } from "./pcData";

export function PcDevices({
  snapshot,
  onShowQr,
}: {
  snapshot: PcSnapshot;
  onShowQr: () => void;
}) {
  return (
    <main className="pc-main">
      <div className="pc-page">
        <div className="pc-page-head">
          <div>
            <div className="pc-eyebrow">设备</div>
            <h1>已连接的手机</h1>
            <p className="pc-page-sub">配对才能看到电脑；不需要账号，设备可以随时移除。</p>
          </div>
          <div className="pc-head-actions">
            <button type="button" className="pc-btn primary" onClick={onShowQr}>
              <PcIcon name="plus" size={13} />
              添加设备
            </button>
          </div>
        </div>

        <div className="pc-devices-grid">
          <section className="pc-card pc-device-detail">
            <div className="pc-device-hero">
              <span className="pc-device-hero-icon">
                <PcIcon name="phone" size={23} />
              </span>
              <span>
                <h2>{snapshot.phone?.name ?? "还没有手机连接"}</h2>
                <p>{snapshot.phone ? "同一 Wi-Fi · 已配对 · 可随时移除" : "用二维码配对；不需要登录账号"}</p>
              </span>
            </div>
            <div className="pc-device-rows">
              <div>
                <span>状态</span>
                <b className={snapshot.phone ? "pc-ok" : "pc-muted"}>
                  {snapshot.phone ? "已连接" : "未连接"}
                </b>
              </div>
              <div>
                <span>最近活跃</span>
                <b>{snapshot.phone?.lastSeen ?? "—"}</b>
              </div>
              <div>
                <span>连接方式</span>
                <b>同一 Wi-Fi</b>
              </div>
              <div>
                <span>权限</span>
                <b>工作区</b>
              </div>
            </div>
            <div className="pc-device-actions">
              <button type="button" className="pc-btn primary" onClick={onShowQr}>
                <PcIcon name="qr" size={13} />
                显示二维码
              </button>
              <button type="button" className="pc-btn ghost" disabled={!snapshot.phone}>
                移除设备
              </button>
            </div>
          </section>

          <section className="pc-card pc-device-qr">
            <div className="pc-section-head compact">
              <h3>添加手机</h3>
              <span className="pc-badge-muted">同一 Wi-Fi</span>
            </div>
            {snapshot.pair ? (
              <>
                <div className="pc-qr-wrap small">
                  <img className="pc-qr-image" src={snapshot.pair.qr} alt="配对二维码" />
                </div>
                <p>
                  {snapshot.pair.mode === "public"
                    ? "手机扫码后进入配对；公网固定入口，流量也能扫。"
                    : "手机扫码后进入配对；二维码由本机 Host 生成。"}
                </p>
              </>
            ) : snapshot.demo ? (
              <>
                <div className="pc-qr-wrap small">
                  <PcQr size={150} />
                </div>
                <p>手机扫码后进入配对；配对本机不需要账号。</p>
              </>
            ) : (
              <div className="pc-qr-empty compact">
                <PcIcon name="qr" size={28} />
                <b>{snapshot.error ?? "正在生成二维码"}</b>
                <small>{snapshot.error ? "请在电脑本机打开 PC 页面。" : "Host 就绪后会自动出现。"}</small>
              </div>
            )}
            <button type="button" className="pc-btn ghost sm" onClick={onShowQr}>
              <PcIcon name="refresh" size={12} />
              刷新二维码
            </button>
          </section>
        </div>

        <div className="pc-home-foot">
          <span className="pc-setup-status">
            <i className={snapshot.hostOnline ? "on" : ""} />
            本地配对 · 不用账号
          </span>
          <span className="pc-foot-links">没看到设备？检查同一 Wi-Fi</span>
        </div>
      </div>
    </main>
  );
}
