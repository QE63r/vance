import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../app/theme";
import { PcAccountMenu } from "./PcAccountMenu";
import { PcDevices } from "./PcDevices";
import { PcHome } from "./PcHome";
import { PcIcon } from "./PcIcon";
import { PcQr } from "./PcQr";
import { PcSettings } from "./PcSettings";
import { PcSetup } from "./PcSetup";
import { PcSidebar } from "./PcSidebar";
import { PcSoftware } from "./PcSoftware";
import { PcTitlebar } from "./PcTitlebar";
import { usePcSnapshot, type PcAppInfo, type PcMode, type PcView } from "./pcData";
import { pcQuery } from "./pcMode";
import "./pc.css";

export function PcApp() {
  const { snapshot, refresh } = usePcSnapshot();
  const { choice, theme, setChoice } = useTheme();
  const query = useMemo(() => pcQuery(window.location), []);
  const [view, setView] = useState<PcView>(() => {
    const v = query.get("view");
    return v === "home" || v === "software" || v === "devices" || v === "settings" ? v : "setup";
  });
  const [step, setStep] = useState(() => {
    const n = Number(query.get("step") ?? "1");
    return Number.isFinite(n) ? Math.min(4, Math.max(1, Math.trunc(n))) : 1;
  });
  const [mode, setMode] = useState<PcMode>("remote");
  const [account, setAccount] = useState(() => query.get("account") === "1");
  const [qrOpen, setQrOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const forced = query.get("theme");
    if (forced === "light" || forced === "dark") setChoice(forced);
  }, [query]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const go = (next: PcView) => {
    setView(next);
    setAccount(false);
  };

  const onAction = (app: PcAppInfo) => {
    if (app.action === "detect") {
      refresh();
      flash(`${app.name}：已重新检测。`);
      return;
    }
    if (app.action === "install") {
      flash(`${app.name}：安装入口待接。`);
      return;
    }
    if (app.action === "attach") {
      flash(`${app.name}：窗口已发现；远控引擎下一步接。`);
      return;
    }
    flash(`${app.name}：打开入口待接。`);
  };

  return (
    <div className="pc-root">
      <div className={`pc-window pc-view-${view}`}>
        <PcTitlebar
          hostOnline={snapshot.hostOnline}
          demo={snapshot.demo}
          theme={theme}
          onToggleTheme={() => setChoice(theme === "dark" ? "light" : "dark")}
        />

        {view === "setup" ? (
          <PcSetup
            snapshot={snapshot}
            step={step}
            onStep={setStep}
            onFinish={() => {
              setStep(4);
              setView("home");
            }}
          />
        ) : (
          <>
            <div className="pc-body">
              <PcSidebar
                view={view}
                snapshot={snapshot}
                onNavigate={go}
                onSettings={() => go("settings")}
                onHelp={() => flash("日志和帮助入口待接；终端信息之后只进日志。")}
                onAccount={() => setAccount(true)}
              />
              {view === "home" && (
                <PcHome
                  snapshot={snapshot}
                  mode={mode}
                  onMode={setMode}
                  onShowQr={() => setQrOpen(true)}
                  onNavigate={(next) => go(next)}
                  onAction={onAction}
                  onContinue={() => {
                    if (!snapshot.phone) {
                      setQrOpen(true);
                      return;
                    }
                    flash("远控引擎下一步接；当前已配对、已发现窗口。");
                  }}
                  onRefresh={refresh}
                />
              )}
              {view === "software" && (
                <PcSoftware
                  snapshot={snapshot}
                  onAction={onAction}
                  onRefresh={refresh}
                  onShowQr={() => setQrOpen(true)}
                />
              )}
              {view === "devices" && <PcDevices snapshot={snapshot} onShowQr={() => setQrOpen(true)} />}
              {view === "settings" && (
                <PcSettings
                  snapshot={snapshot}
                  mode={mode}
                  onMode={setMode}
                  theme={theme}
                  themeChoice={choice}
                  onTheme={setChoice}
                />
              )}
            </div>
            {account && (
              <PcAccountMenu
                onClose={() => setAccount(false)}
                onDevices={() => go("devices")}
                onSettings={() => go("settings")}
              />
            )}
          </>
        )}

        {qrOpen && (
          <div className="pc-modal-layer">
            <button type="button" className="pc-modal-backdrop" aria-label="关闭" onClick={() => setQrOpen(false)} />
            <div className="pc-modal" role="dialog" aria-modal="true" aria-label="连接手机">
              <div className="pc-modal-head">
                <div>
                  <div className="pc-eyebrow">PAIR</div>
                  <h2>连接手机</h2>
                </div>
                <button type="button" className="pc-icon-btn" onClick={() => setQrOpen(false)} aria-label="关闭">
                  <PcIcon name="close" size={15} />
                </button>
              </div>
              <div className="pc-modal-qr">
                {snapshot.demo ? (
                  <>
                    <div className="pc-qr-wrap">
                      <PcQr size={176} />
                    </div>
                    <div className="pc-pair-code">
                      配对码 <b>VANCE-7K2M</b>
                    </div>
                    <p>手机扫码后进入配对；同一 Wi-Fi 最快。公网入口下一步接。</p>
                  </>
                ) : snapshot.pair ? (
                  <>
                    <div className="pc-qr-wrap">
                      <img className="pc-qr-image" src={snapshot.pair.qr} alt="配对二维码" />
                    </div>
                    <div className="pc-pair-code">扫码后手机进入配对</div>
                    <p>
                      {snapshot.pair.mode === "public"
                        ? "公网固定入口，手机流量或同一 Wi-Fi 都能扫。"
                        : "二维码由本机 Host 生成；手机和电脑连同一个 Wi-Fi 时最稳。"}
                    </p>
                  </>
                ) : (
                  <div className="pc-qr-empty compact">
                    <PcIcon name="qr" size={28} />
                    <b>{snapshot.error ?? "正在生成二维码"}</b>
                    <small>{snapshot.error ? "请在电脑本机打开 PC 页面。" : "Host 就绪后会自动出现。"}</small>
                  </div>
                )}
              </div>
              <div className="pc-modal-foot">
                <span>
                  <PcIcon name="lock" size={12} /> 本地配对 · 不用账号
                </span>
                <button type="button" className="pc-btn primary sm" onClick={() => setQrOpen(false)}>
                  完成
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && <div className="pc-toast">{toast}</div>}
      </div>
    </div>
  );
}
