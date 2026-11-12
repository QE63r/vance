import { PcIcon } from "./PcIcon";

export function PcAccountMenu({
  onClose,
  onDevices,
  onSettings,
}: {
  onClose: () => void;
  onDevices: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="pc-menu-layer">
      <button type="button" className="pc-menu-backdrop" aria-label="关闭菜单" onClick={onClose} />
      <div className="pc-account-menu" role="menu">
        <div className="pc-account-head">
          <span className="pc-account-avatar">
            <PcIcon name="monitor" size={13} />
          </span>
          <span>
            <b>本地模式</b>
            <small>数据在本机 · 无需账号</small>
          </span>
        </div>
        <div className="pc-menu-divider" />
        <button
          type="button"
          className="pc-menu-item"
          role="menuitem"
          onClick={() => {
            onClose();
            onDevices();
          }}
        >
          <PcIcon name="device" size={14} />
          设备与配对
        </button>
        <button
          type="button"
          className="pc-menu-item"
          role="menuitem"
          onClick={() => {
            onClose();
            onSettings();
          }}
        >
          <PcIcon name="settings" size={14} />
          设置
        </button>
        <button type="button" className="pc-menu-item" role="menuitem" disabled>
          <PcIcon name="user" size={14} />
          账号与订阅
          <span className="pc-menu-tag">P2</span>
        </button>
        <div className="pc-menu-divider" />
        <div className="pc-menu-note">v1 不需要登录；账号、团队、订阅留到 P2。</div>
      </div>
    </div>
  );
}
