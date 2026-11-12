import type { ThemeChoice, Theme } from "./theme";
import { clearCredentials } from "../net/credentials";

export function Drawer({
  themeChoice,
  theme,
  onTheme,
  deviceName,
  deviceLabel,
  onClose,
  onSessions,
  onRules,
  onUndo,
  onRepo,
}: {
  themeChoice: ThemeChoice;
  theme: Theme;
  onTheme: (choice: ThemeChoice) => void;
  deviceName: string;
  deviceLabel: string;
  onClose: () => void;
  onSessions: () => void;
  onRules: () => void;
  onUndo: () => void;
  onRepo: () => void;
}) {
  const install = () => {
    window.alert(
      "用浏览器菜单里的「添加到主屏幕」安装。\n\nAndroid Chrome 在部分启动器上只会生成新标签页快捷方式，这是浏览器的限制，不是页面问题。",
    );
  };

  const forget = () => {
    if (!window.confirm("清掉这台手机的配对信息？下次要重新扫码。")) return;
    clearCredentials(localStorage);
    location.replace(location.pathname);
  };

  const info = (title: string, text: string) => window.alert(`${title}\n\n${text}`);

  const themes: Array<[ThemeChoice, string, string]> = [
    ["system", "跟随系统", "默认"],
    ["light", "白天", "浅色"],
    ["dark", "夜晚", "深色"],
  ];

  return (
    <div className="drawer-mask" onClick={onClose}>
      <aside className="drawer-panel" onClick={(e) => e.stopPropagation()} aria-label="我的">
        <div className="drawer-head">
          <div className="drawer-avatar">我</div>
          <div>
            <div className="drawer-name">本地模式</div>
            <span className="drawer-mode">未登录 · 本机</span>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-label">外观</div>
          <div className="theme-options">
            {themes.map(([value, label, sub]) => (
              <button
                key={value}
                className={`theme-opt${themeChoice === value ? " on" : ""}`}
                type="button"
                onClick={() => onTheme(value)}
              >
                {label}
                <small>{sub}</small>
              </button>
            ))}
          </div>
          <div className="drawer-note">当前：{theme === "dark" ? "夜晚" : "白天"} · 只影响这台手机</div>
        </div>

        <div className="drawer-section">
          <div className="drawer-label">这台手机</div>
          <button className="drawer-row" type="button" onClick={install}>
            <span>安装到主屏</span>
            <span className="drawer-r">›</span>
          </button>
          <div className="drawer-row">
            <span>当前入口</span>
            <span className="drawer-r">{location.host}</span>
          </div>
          <div className="drawer-row">
            <span>已配对设备</span>
            <span className="drawer-r">
              {deviceName || "本机"} · {deviceLabel}
            </span>
          </div>
          <div className="drawer-row p2">
            <span>通知</span>
            <span className="drawer-r">P2</span>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-label">任务与交付</div>
          <button className="drawer-row" type="button" onClick={onSessions}>
            <span>任务列表</span>
            <span className="drawer-r">›</span>
          </button>
          <button className="drawer-row" type="button" onClick={onRepo}>
            <span>交付物仓库</span>
            <span className="drawer-r">›</span>
          </button>
          <button className="drawer-row" type="button" onClick={onUndo}>
            <span>撤销移动</span>
            <span className="drawer-r">›</span>
          </button>
          <button className="drawer-row" type="button" onClick={onRules}>
            <span>记住的规则</span>
            <span className="drawer-r">›</span>
          </button>
        </div>

        <div className="drawer-section">
          <div className="drawer-label">账号</div>
          <div className="drawer-row p2">
            <span>登录账号</span>
            <span className="drawer-r">P2</span>
          </div>
          <div className="drawer-row p2">
            <span>团队 / 订阅</span>
            <span className="drawer-r">P2</span>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-label">其他</div>
          <button
            className="drawer-row"
            type="button"
            onClick={() =>
              info("帮助", "手机是电脑上 Agent 的控制端。\n审批在卡片上点；任务详情里才能发指令。\n连不上时先看电脑端 host 是否在跑。")
            }
          >
            <span>帮助</span>
            <span className="drawer-r">›</span>
          </button>
          <button
            className="drawer-row"
            type="button"
            onClick={() =>
              info("隐私", "本地模式：任务、审批、产出都存在电脑上；手机只存入口、口令和设备 id。\n公网入口是明文，端到端加密留到 P2。")
            }
          >
            <span>隐私</span>
            <span className="drawer-r">›</span>
          </button>
          <button
            className="drawer-row"
            type="button"
            onClick={() => info("关于梵境", "v0.1 · 本地模式\n手机是电脑上 Agent 的控制面；聊天只是任务里的一种输入。")}
          >
            <span>关于梵境</span>
            <span className="drawer-r">v0.1 ›</span>
          </button>
        </div>

        <button className="drawer-row danger" type="button" onClick={forget}>
          <span>忘记这台设备</span>
          <span className="drawer-r">›</span>
        </button>

        <div className="drawer-foot">
          本地模式：数据只在电脑上；登录 / 中继 / 团队都在 P2。
          <br />
          忘记设备只清这台手机，电脑上的记录不删。
        </div>
      </aside>
    </div>
  );
}
