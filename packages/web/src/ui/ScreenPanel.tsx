import { useState, useSyncExternalStore } from "react";
import { getFrame, subscribeFrame } from "../net/frames";

/** 控制页里的大画面；点开是全屏 viewer。 */
export function ScreenPanel({ ready }: { ready: boolean }) {
  const frame = useSyncExternalStore(subscribeFrame, getFrame, getFrame);
  const [open, setOpen] = useState(false);
  const time = frame.at
    ? new Date(frame.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <>
      <button className="screen-panel" type="button" onClick={() => setOpen(true)} aria-label="电脑画面">
        {frame.url ? (
          <img src={frame.url} alt="电脑屏幕" />
        ) : (
          <span className="screen-empty">还没有收到画面</span>
        )}
        <span className={`screen-badge${ready ? "" : " stale"}`}>
          {ready ? "实时 · 2 fps" : frame.at ? `已过期 · ${time}` : "未连接"}
        </span>
      </button>

      {open && (
        <div className="viewer" onClick={() => setOpen(false)}>
          <div className="viewer-inner" onClick={(e) => e.stopPropagation()}>
            {frame.url ? <img src={frame.url} alt="电脑屏幕" /> : <div className="viewer-empty">还没有收到画面</div>}
            <div className="viewer-bar">
              <span>
                {ready ? "实时画面" : "连接已断开"} · 最后更新 {time ?? "—"}
              </span>
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
