import { useState, useSyncExternalStore } from "react";
import { getFrame, subscribeFrame } from "../net/frames";

export function ScreenMini({ ready }: { ready: boolean }) {
  const frame = useSyncExternalStore(subscribeFrame, getFrame, getFrame);
  const [open, setOpen] = useState(false);

  const time = frame.at ? new Date(frame.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <>
      <button className={`mini ${frame.url ? "has-frame" : ""}`} type="button" onClick={() => setOpen(true)} aria-label="电脑画面">
        {frame.url ? <img src={frame.url} alt="电脑屏幕" /> : <span className="mini-empty">等待画面</span>}
        {!ready && <span className="mini-stale">{frame.at ? `已过期 · ${time}` : "未连接"}</span>}
        {ready && frame.url && <span className="mini-badge">实时</span>}        {frame.url && ready && frame.frames > 0 && <span className="mini-live" />}
      </button>

      {open && (
        <div className="viewer" onClick={() => setOpen(false)}>
          <div className="viewer-inner" onClick={(e) => e.stopPropagation()}>
            {frame.url ? <img src={frame.url} alt="电脑屏幕" /> : <div className="viewer-empty">还没有收到画面</div>}
            <div className="viewer-bar">
              <span>{ready ? "实时画面" : "连接已断开"} · 最后更新 {time ?? "—"}</span>
              <button type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
