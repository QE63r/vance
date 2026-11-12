import { useState } from "react";
import { PcIcon } from "./PcIcon";
import { PcQr } from "./PcQr";
import type { PcMode, PcSnapshot } from "./pcData";

const STEPS = [
  ["连接手机", "扫码配对"],
  ["发现软件", "豆包 / DeepSeek / Cursor"],
  ["选择模式", "远控，或装 Agent"],
  ["完成", "在手机上继续"],
] as const;

export function PcSetup({
  snapshot,
  step,
  onStep,
  onFinish,
}: {
  snapshot: PcSnapshot;
  step: number;
  onStep: (step: number) => void;
  onFinish: () => void;
}) {
  const [network, setNetwork] = useState<"lan" | "wan">("lan");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(snapshot.apps.filter((a) => a.status !== "missing").map((a) => a.id)),
  );
  const [mode, setMode] = useState<PcMode>("remote");

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="pc-body">
      <aside className="pc-sidebar pc-setup-side">
        <div className="pc-brand-block">
          <span className="pc-brand-mark">
            <PcIcon name="spark" size={19} />
          </span>
          <div className="pc-brand-title">
            把电脑上的 AI
            <br />
            带到手机
          </div>
          <div className="pc-brand-sub">离开电脑，也能继续同一个窗口；回来还是原来的对话。</div>
        </div>
        <ol className="pc-steps">
          {STEPS.map(([title, sub], i) => {
            const n = i + 1;
            const state = n === step ? "active" : n < step ? "done" : "";
            return (
              <li key={title} className={`pc-step ${state}`}>
                <button type="button" onClick={() => n <= step && onStep(n)} disabled={n > step}>
                  <span className="pc-step-num">{n < step ? <PcIcon name="check" size={11} /> : n}</span>
                  <span>
                    <b>{title}</b>
                    <small>{sub}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="pc-side-foot">
          <span className="pc-trust-line">
            <PcIcon name="lock" size={12} />
            本地运行 · 屏幕内容不上传
          </span>
        </div>
      </aside>

      <main className="pc-main">
        <div className="pc-page">
          <div className="pc-page-head">
            <div>
              <div className="pc-eyebrow">SETUP · {step} / 4</div>
              <h1>
                {step === 1 && "连接手机"}
                {step === 2 && "发现软件"}
                {step === 3 && "选择模式"}
                {step === 4 && "可以开始了"}
              </h1>
              <p className="pc-page-sub">
                {step === 1 && "手机扫码后，电脑上的 AI 软件会出现在梵境里。"}
                {step === 2 && "选一个要接力的软件；已安装的直接接入，未安装的可以稍后处理。"}
                {step === 3 && "远控不需要装 Agent；只有自动化才需要组件。"}
                {step === 4 && "手机会看到「接力」入口；离开电脑也能继续同一个窗口。"}
              </p>
            </div>
          </div>

          {step === 1 && (
            <div className="pc-setup-grid">
              <section className="pc-qr-card">
                <div className="pc-qr-title">手机扫码连接</div>
                {snapshot.demo ? (
                  <>
                    <div className="pc-qr-wrap">
                      <PcQr size={180} />
                    </div>
                    <div className="pc-pair-code">
                      配对码 <b>VANCE-7K2M</b>
                    </div>
                    <p className="pc-qr-note">打开手机相机，或梵境 App 里的「扫一扫」。</p>
                  </>
                ) : (
                  <div className="pc-qr-empty">
                    <span className="pc-qr-empty-icon">
                      <PcIcon name="qr" size={34} />
                    </span>
                    <b>等待 Host 生成二维码</b>
                    <small>开发版尚未接本机配对接口；先看界面，下一步再接。</small>
                  </div>
                )}
              </section>

              <section className="pc-connect-panel">
                <div className="pc-segmented">
                  <button
                    type="button"
                    className={network === "lan" ? "active" : ""}
                    onClick={() => setNetwork("lan")}
                  >
                    同一 Wi-Fi
                  </button>
                  <button
                    type="button"
                    className={network === "wan" ? "active" : ""}
                    onClick={() => setNetwork("wan")}
                  >
                    不在同一网络
                  </button>
                </div>
                <div className="pc-field-label">电脑地址</div>
                <div className="pc-address">
                  <code>{snapshot.demo ? "192.168.1.8:8787" : `${location.host}`}</code>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(location.host)}>
                    复制
                  </button>
                </div>
                <div className="pc-hint">
                  {network === "lan"
                    ? "手机和电脑连同一个 Wi-Fi 时，用这个地址最快。换网络后地址会变，重新扫码即可。"
                    : "不在同一网络需要 Tailscale/中继；v1 先支持同一 Wi-Fi，公网入口还在接。"}
                </div>
                <div className="pc-trust-box">
                  <PcIcon name="lock" size={14} />
                  <span>
                    <b>只在你的设备之间</b>
                    <small>屏幕和输入走本机 Host，不上传云端；配对后可在设备页随时移除。</small>
                  </span>
                </div>
                <div className="pc-connect-actions">
                  <button type="button" className="pc-btn primary lg" onClick={() => onStep(2)}>
                    下一步：发现软件
                    <PcIcon name="arrow" size={13} />
                  </button>
                  <button type="button" className="pc-btn quiet" onClick={onFinish}>
                    稍后连接，先看看
                  </button>
                </div>
              </section>
            </div>
          )}

          {step === 2 && (
            <section className="pc-card pc-pick-card">
              <div className="pc-pick-head">
                <span>
                  <b>电脑上发现的软件</b>
                  <small>只读检测；不启动、不登录、不读取内容</small>
                </span>
                <button type="button" className="pc-btn ghost sm" onClick={() => undefined}>
                  <PcIcon name="refresh" size={12} />
                  重新发现
                </button>
              </div>
              <div className="pc-pick-list">
                {snapshot.apps.map((app) => (
                  <label key={app.id} className={`pc-pick-row${selected.has(app.id) ? " checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(app.id)}
                      onChange={() => toggle(app.id)}
                      aria-label={`接入 ${app.name}`}
                    />
                    <span className={`pc-app-icon ${app.tone}`}>{app.initial}</span>
                    <span className="pc-pick-main">
                      <b>{app.name}</b>
                      <small>{app.note}</small>
                    </span>
                    <span className={`pc-status ${app.status}`}>
                      {app.status === "running" && "运行中"}
                      {app.status === "installed" && "已安装"}
                      {app.status === "missing" && "未安装"}
                      {app.status === "unknown" && "未检测"}
                    </span>
                  </label>
                ))}
              </div>
              <div className="pc-pick-foot">
                <button type="button" className="pc-btn quiet" onClick={() => onStep(1)}>
                  上一步
                </button>
                <button type="button" className="pc-btn primary" onClick={() => onStep(3)}>
                  下一步：选择模式
                  <PcIcon name="arrow" size={13} />
                </button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="pc-mode-choice">
              <button
                type="button"
                className={`pc-mode-option${mode === "remote" ? " active" : ""}`}
                onClick={() => setMode("remote")}
              >
                <span className="pc-mode-icon">
                  <PcIcon name="phone" size={20} />
                </span>
                <b>手机远控</b>
                <small>看、点、打字、粘贴，继续软件 AI 的同一窗口。不装 Agent。</small>
                <span className="pc-radio">{mode === "remote" && <i />}</span>
              </button>
              <button
                type="button"
                className={`pc-mode-option${mode === "agent" ? " active" : ""}`}
                onClick={() => setMode("agent")}
              >
                <span className="pc-mode-icon">
                  <PcIcon name="spark" size={20} />
                </span>
                <b>自动化</b>
                <small>让 Agent 改文件、跑脚本；需要安装可选组件，远控仍可用。</small>
                <span className="pc-radio">{mode === "agent" && <i />}</span>
              </button>
              <div className="pc-pick-foot">
                <button type="button" className="pc-btn quiet" onClick={() => onStep(2)}>
                  上一步
                </button>
                <button type="button" className="pc-btn primary" onClick={() => onStep(4)}>
                  下一步：完成
                  <PcIcon name="arrow" size={13} />
                </button>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="pc-done">
              <span className="pc-done-icon">
                <PcIcon name="check" size={28} />
              </span>
              <h2>Host 已就绪</h2>
              <p>
                手机端现在可以进入「接力」；电脑上的软件会出现在列表里。
                <br />
                远控模式不需要安装 Agent。
              </p>
              <div className="pc-done-actions">
                <button type="button" className="pc-btn primary lg" onClick={onFinish}>
                  进入主页
                  <PcIcon name="arrow" size={13} />
                </button>
                <button type="button" className="pc-btn quiet" onClick={() => onStep(1)}>
                  返回连接手机
                </button>
              </div>
            </section>
          )}

          <div className="pc-setup-foot">
            <span className="pc-setup-status">
              <i className={snapshot.hostOnline ? "on" : ""} />
              {snapshot.hostOnline ? `Host 已启动 · 端口 ${snapshot.port}` : "Host 未连接"}
            </span>
            <button type="button" className="pc-link" onClick={onFinish}>
              遇到问题？查看日志
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

