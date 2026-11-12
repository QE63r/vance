import { PcIcon, type PcIconName } from "./PcIcon";
import type { PcSnapshot, PcView } from "./pcData";

const NAV: Array<{ view: Exclude<PcView, "setup" | "settings">; label: string; icon: PcIconName }> = [
  { view: "home", label: "接力", icon: "grid" },
  { view: "software", label: "软件", icon: "app" },
  { view: "devices", label: "设备", icon: "device" },
];

export function PcSidebar({
  view,
  snapshot,
  onNavigate,
  onSettings,
  onHelp,
  onAccount,
}: {
  view: Exclude<PcView, "setup">;
  snapshot: PcSnapshot;
  onNavigate: (view: PcView) => void;
  onSettings: () => void;
  onHelp: () => void;
  onAccount: () => void;
}) {
  return (
    <aside className="pc-sidebar">
      <div className="pc-workspace">
        <span className="pc-ws-icon">
          <PcIcon name="monitor" size={15} />
        </span>
        <span className="pc-ws-main">
          <b>本机</b>
          <small>{snapshot.hostLabel}</small>
        </span>
        <PcIcon name="chevron" size={12} className="pc-ws-chev" />
      </div>

      <nav className="pc-nav" aria-label="主导航">
        {NAV.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`pc-nav-item${view === item.view ? " active" : ""}`}
            onClick={() => onNavigate(item.view)}
            aria-current={view === item.view ? "page" : undefined}
          >
            <PcIcon name={item.icon} size={16} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="pc-nav-label">当前设备</div>
      {snapshot.phone ? (
        <div className="pc-device-card">
          <div className="pc-device-top">
            <span className="pc-device-icon">
              <PcIcon name="phone" size={15} />
            </span>
            <span>
              <b>{snapshot.phone.name}</b>
              <small>同一 Wi-Fi · 已配对</small>
            </span>
          </div>
          <div className="pc-device-state">
            <i />
            已连接 · {snapshot.phone.lastSeen}
          </div>
        </div>
      ) : (
        <button type="button" className="pc-device-empty" onClick={() => onNavigate("devices")}>
          <PcIcon name="qr" size={16} />
          <span>
            <b>手机未连接</b>
            <small>扫码配对</small>
          </span>
            <PcIcon name="arrow" size={13} />
        </button>
      )}

      <div className="pc-side-bottom">
        <button type="button" className={`pc-util${view === "settings" ? " active" : ""}`} onClick={onSettings}>
          <PcIcon name="settings" size={15} />
          设置
        </button>
        <button type="button" className="pc-util" onClick={onHelp}>
          <PcIcon name="help" size={15} />
          帮助与日志
        </button>
      </div>

      <button type="button" className="pc-account" onClick={onAccount} aria-label="打开本地模式菜单">
        <span className="pc-account-avatar">
          <PcIcon name="monitor" size={13} />
        </span>
        <span className="pc-account-main">
          <b>本地模式</b>
          <small>数据在本机 · 无需账号</small>
        </span>
        <PcIcon name="chevron" size={12} className="pc-account-chev" />
      </button>
    </aside>
  );
}
