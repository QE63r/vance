import type { Theme } from "../app/theme";
import { PcIcon } from "./PcIcon";

export function PcTitlebar({
  hostOnline,
  demo,
  theme,
  onToggleTheme,
}: {
  hostOnline: boolean;
  demo: boolean;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  return (
    <header className="pc-titlebar">
      <div className="pc-tb-left">
        <img
          className="pc-logo"
          src={`${import.meta.env.BASE_URL}icons/fanjing-256.png`}
          alt=""
          draggable={false}
        />
        <span className="pc-brand">
          梵境<em>Vance</em>
        </span>
        <span className={`pc-host-pill ${hostOnline ? "on" : "off"}`}>
          <i />
          {hostOnline ? "Host 已启动" : "Host 未连接"}
        </span>
        {demo && <span className="pc-demo-pill">预览</span>}
      </div>
      <div className="pc-tb-right">
        <button
          type="button"
          className="pc-icon-btn"
          onClick={onToggleTheme}
          title={theme === "dark" ? "切换白天" : "切换夜晚"}
          aria-label={theme === "dark" ? "切换白天" : "切换夜晚"}
        >
          <PcIcon name={theme === "dark" ? "sun" : "moon"} size={14} />
        </button>
        <div className="pc-window-controls" aria-label="窗口控制">
          <button type="button" className="pc-win-btn" title="最小化" aria-label="最小化">
            <PcIcon name="minimize" size={10} />
          </button>
          <button type="button" className="pc-win-btn" title="最大化" aria-label="最大化">
            <PcIcon name="maximize" size={10} />
          </button>
          <button type="button" className="pc-win-btn close" title="关闭" aria-label="关闭">
            <PcIcon name="close" size={10} />
          </button>
        </div>
      </div>
    </header>
  );
}
