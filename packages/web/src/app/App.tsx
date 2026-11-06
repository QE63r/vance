import { useEffect, useRef, useState } from "react";
import { store, useVance } from "../model/store";
import { pendingCount, canSend, canStop, hintText, linkText, execText, deviceText, linkReady, latestArtifacts } from "../model/selectors";
import { send } from "../net/ws";
import { Timeline } from "../ui/Timeline";
import { Composer } from "../ui/Composer";
import { ScreenMini } from "../ui/ScreenMini";
import { ArtifactsSheet, DeviceSheet } from "../ui/Sheets";

export function App() {
  const s = useVance();
  const [now, setNow] = useState(() => Date.now());
  const [sheet, setSheet] = useState<null | "artifacts">(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);

  // 倒计时每秒走一次；只用来刷新审批卡上的秒数
  useEffect(() => {
    const t = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      store.dispatch({ type: "tick", now: at });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // 贴底时自动跟随；用户手动上翻后不抢
  useEffect(() => {
    const el = feedRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [s.timeline.length, s.approvals, now]);

  const pending = pendingCount(s);
  const artifacts = latestArtifacts(s);
  const result = artifacts ? artifacts.data : null;

  return (
    <div className="app">
      <header className={`hdr link-${s.link.phase}`}>
        <div className="hdr-row">
          <div className="proj">
            <span className="proj-name">{s.project || "会话"}</span>
            <span className="proj-sub">手机 · 控制端</span>
          </div>
          <div className="conn">
            <span className="dot" />
            <span className="conn-text">{linkText(s)}</span>
          </div>
        </div>
        <div className="rail">
          <span className={`chip exec-${s.exec.phase}`}>{execText(s)}</span>
          <span className={`chip appr-${pending > 0 ? "on" : "off"}`}>{pending > 0 ? `待批 ${pending}` : "无待批"}</span>
          <span className={`chip dev-${s.device.phase}`}>{deviceText(s)}</span>
        </div>
      </header>

      <main
        className="feed"
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <Timeline state={s} now={now} />
      </main>

      <button className="dock" type="button" onClick={() => result && setSheet("artifacts")} disabled={!result}>
        <span className="dock-label">本轮产出</span>
        {result ? (
          <span className="dock-value">
            新增 {result.added.length} · 改动 {result.changed.length} · 删除 {result.removed.length}
            {result.warnings.length > 0 && <span className="dock-warn"> · {result.warnings.length} 条提醒</span>}
          </span>
        ) : (
          <span className="dock-empty">还没有产出</span>
        )}
        <span className="dock-arrow">›</span>
      </button>

      <Composer
        canSend={canSend(s)}
        canStop={canStop(s)}
        hint={hintText(s, now)}
        onSend={(text) => send({ type: "prompt", text })}
        onStop={() => send({ type: "stop" })}
      />

      <ScreenMini ready={linkReady(s)} />

      {sheet === "artifacts" && result && <ArtifactsSheet data={result} onClose={() => setSheet(null)} />}
      {s.device.incoming.length > 0 && (
        <DeviceSheet
          request={s.device.incoming[0]}
          onDecide={(allow) => {
            const req = s.device.incoming[0];
            const sent = send({ type: "device_decision", deviceId: req.deviceId, allow });
            if (sent) store.dispatch({ type: "device-decided", deviceId: req.deviceId });
          }}
        />
      )}
    </div>
  );
}
