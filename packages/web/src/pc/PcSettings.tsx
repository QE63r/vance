import { useState } from "react";
import type { Theme, ThemeChoice } from "../app/theme";
import { PcIcon } from "./PcIcon";
import type { PcMode, PcSnapshot } from "./pcData";

function Toggle({
  on,
  onChange,
  disabled = false,
}: {
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pc-toggle${on ? " on" : ""}`}
      onClick={onChange}
      disabled={disabled}
      role="switch"
      aria-checked={on}
    >
      <i />
    </button>
  );
}

export function PcSettings({
  snapshot,
  mode,
  onMode,
  theme,
  themeChoice,
  onTheme,
}: {
  snapshot: PcSnapshot;
  mode: PcMode;
  onMode: (mode: PcMode) => void;
  theme: Theme;
  themeChoice: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
}) {
  const [clipboard, setClipboard] = useState(true);
  const [targetOnly, setTargetOnly] = useState(true);
  const [autoStop, setAutoStop] = useState(true);

  return (
    <main className="pc-main">
      <div className="pc-page pc-settings-page">
        <div className="pc-page-head">
          <div>
            <div className="pc-eyebrow">设置</div>
            <h1>设置</h1>
            <p className="pc-page-sub">本机偏好、网络、远控和可选组件。v1 是本地模式，不需要账号。</p>
          </div>
        </div>

        <div className="pc-settings">
          <section className="pc-settings-section">
            <div className="pc-settings-head">
              <span className="pc-settings-icon">
                <PcIcon name="settings" size={16} />
              </span>
              <div>
                <h2>通用</h2>
                <p>外观和启动方式</p>
              </div>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>主题</b>
                <small>当前：{theme === "dark" ? "夜晚" : "白天"}</small>
              </span>
              <div className="pc-segmented">
                <button type="button" className={themeChoice === "system" ? "active" : ""} onClick={() => onTheme("system")}>
                  跟随系统
                </button>
                <button type="button" className={themeChoice === "light" ? "active" : ""} onClick={() => onTheme("light")}>
                  白天
                </button>
                <button type="button" className={themeChoice === "dark" ? "active" : ""} onClick={() => onTheme("dark")}>
                  夜晚
                </button>
              </div>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>开机自启</b>
                <small>开发版未接系统启动项；正式安装包再接</small>
              </span>
              <Toggle on={false} onChange={() => undefined} disabled />
            </div>
            <div className="pc-settings-row">
              <span>
                <b>语言</b>
                <small>跟随系统</small>
              </span>
              <span className="pc-settings-value">简体中文</span>
            </div>
          </section>

          <section className="pc-settings-section">
            <div className="pc-settings-head">
              <span className="pc-settings-icon">
                <PcIcon name="monitor" size={16} />
              </span>
              <div>
                <h2>网络</h2>
                <p>手机怎么连到这台电脑</p>
              </div>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>当前入口</b>
                <small>同一 Wi-Fi · 局域网</small>
              </span>
              <code className="pc-settings-code">{location.host}</code>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>公网 / Tailscale</b>
                <small>跨网络需要中继；v1 未接</small>
              </span>
              <span className="pc-badge-muted">未接</span>
            </div>
          </section>

          <section className="pc-settings-section">
            <div className="pc-settings-head">
              <span className="pc-settings-icon">
                <PcIcon name="phone" size={16} />
              </span>
              <div>
                <h2>远控</h2>
                <p>手机操作电脑窗口时的边界</p>
              </div>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>只操作目标窗口</b>
                <small>不采集、不操作其他窗口</small>
              </span>
              <Toggle on={targetOnly} onChange={() => setTargetOnly((v) => !v)} />
            </div>
            <div className="pc-settings-row">
              <span>
                <b>允许剪贴板粘贴</b>
                <small>中文和长文本走剪贴板，避免掉字符</small>
              </span>
              <Toggle on={clipboard} onChange={() => setClipboard((v) => !v)} />
            </div>
            <div className="pc-settings-row">
              <span>
                <b>断开自动停止</b>
                <small>手机断开或锁屏后不再输入</small>
              </span>
              <Toggle on={autoStop} onChange={() => setAutoStop((v) => !v)} />
            </div>
            <div className="pc-settings-note">
              <PcIcon name="lock" size={13} />
              以上开关先落界面；远控引擎和一次性会话确认下一步接。
            </div>
          </section>

          <section className="pc-settings-section">
            <div className="pc-settings-head">
              <span className="pc-settings-icon">
                <PcIcon name="spark" size={16} />
              </span>
              <div>
                <h2>自动化</h2>
                <p>可选组件；不影响远控</p>
              </div>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>Agent 组件</b>
                <small>{snapshot.demo ? "可选 · 演示模式已就绪" : "未安装 · 需要时再装"}</small>
              </span>
              <button type="button" className="pc-btn ghost sm" disabled>
                安装组件
              </button>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>模式</b>
                <small>远控默认；自动化才用 Agent</small>
              </span>
              <div className="pc-segmented">
                <button type="button" className={mode === "remote" ? "active" : ""} onClick={() => onMode("remote")}>
                  远控
                </button>
                <button type="button" className={mode === "agent" ? "active" : ""} onClick={() => onMode("agent")}>
                  自动化
                </button>
              </div>
            </div>
          </section>

          <section className="pc-settings-section">
            <div className="pc-settings-head">
              <span className="pc-settings-icon">
                <PcIcon name="folder" size={16} />
              </span>
              <div>
                <h2>日志与更新</h2>
                <p>排错和版本</p>
              </div>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>版本</b>
                <small>本地模式 · 开发版</small>
              </span>
              <span className="pc-settings-value">{snapshot.version}</span>
            </div>
            <div className="pc-settings-row">
              <span>
                <b>日志</b>
                <small>终端信息收进日志，不放在主界面</small>
              </span>
              <button type="button" className="pc-btn ghost sm" disabled>
                查看日志
              </button>
            </div>
          </section>
        </div>

        <div className="pc-home-foot">
          <span className="pc-setup-status">
            <i className={snapshot.hostOnline ? "on" : ""} />
            本地运行 · 数据不出电脑
          </span>
          <span className="pc-foot-links">梵境 {snapshot.version}</span>
        </div>
      </div>
    </main>
  );
}
