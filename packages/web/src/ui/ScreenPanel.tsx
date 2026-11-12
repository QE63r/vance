import {
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type PointerEvent,
} from "react";
import { getFrame, subscribeFrame } from "../net/frames";
import { send } from "../net/ws";

/** 控制页里的大画面；点开是全屏 viewer，可进入远控。 */
export function ScreenPanel({ ready }: { ready: boolean }) {
  const frame = useSyncExternalStore(subscribeFrame, getFrame, getFrame);
  const [open, setOpen] = useState(false);
  const [control, setControl] = useState(false);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const lastMove = useRef(0);
  const time = frame.at
    ? new Date(frame.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : null;

  const stopControl = () => {
    if (control) send({ type: "remote_stop" });
    setControl(false);
    setCursor(null);
  };

  const close = () => {
    stopControl();
    setOpen(false);
  };

  const startControl = () => {
    if (!ready) return;
    setControl(true);
  };

  const point = (event: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const pointer = (
    event: PointerEvent<HTMLImageElement>,
    action: "down" | "up" | "move" | "click",
  ) => {
    if (!control) return;
    const p = point(event);
    setCursor(p);
    send({ type: "remote_pointer", action, ...p });
  };

  const onText = (event: FormEvent) => {
    event.preventDefault();
    if (!control || !text.trim()) return;
    send({ type: "remote_text", text });
    setText("");
  };

  const key = (name: string) => {
    if (control) send({ type: "remote_key", key: name });
  };

  return (
    <>
      <button className="screen-panel" type="button" onClick={() => setOpen(true)} aria-label="电脑画面">
        {frame.url ? (
          <img src={frame.url} alt="电脑屏幕" />
        ) : (
          <span className="screen-empty">还没有收到画面</span>
        )}
        <span className={`screen-badge${ready ? "" : " stale"}`}>
          {ready ? "实时" : frame.at ? `已过期 · ${time}` : "未连接"}
        </span>
      </button>

      {open && (
        <div className="viewer" onClick={close}>
          <div className="viewer-inner viewer-remote" onClick={(e) => e.stopPropagation()}>
            {frame.url ? (
              <div className="remote-stage">
                <img
                  src={frame.url}
                  alt="电脑屏幕"
                  draggable={false}
                  className={control ? "remote-image controlling" : "remote-image"}
                  onPointerDown={(e) => {
                    if (!control) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    pointer(e, "down");
                  }}
                  onPointerMove={(e) => {
                    if (!control) return;
                    const now = performance.now();
                    if (now - lastMove.current < 45) return;
                    lastMove.current = now;
                    pointer(e, "move");
                  }}
                  onPointerUp={(e) => {
                    if (!control) return;
                    pointer(e, "up");
                    try {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    } catch {
                      /* 指针可能已经释放 */
                    }
                  }}
                  onContextMenu={(e) => {
                    if (!control) return;
                    e.preventDefault();
                    const p = point(e);
                    send({ type: "remote_pointer", action: "click", button: "right", ...p });
                  }}
                  onWheel={(e) => {
                    if (!control) return;
                    e.preventDefault();
                    const p = point(e);
                    const delta = Math.max(-600, Math.min(600, -e.deltaY));
                    send({ type: "remote_pointer", action: "wheel", deltaY: delta, ...p });
                  }}
                />
                {control && cursor && (
                  <span
                    className="remote-cursor"
                    style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
                  />
                )}
                {control && <span className="remote-hud">控制中 · 点击即操作电脑</span>}
              </div>
            ) : (
              <div className="viewer-empty">还没有收到画面</div>
            )}

            <div className="viewer-bar">
              <span>
                {ready ? (control ? "远控中" : "实时画面") : "连接已断开"} · 最后更新 {time ?? "—"}
              </span>
              <div className="viewer-actions">
                <button
                  type="button"
                  className={control ? "danger" : ""}
                  disabled={!ready}
                  onClick={() => (control ? stopControl() : startControl())}
                >
                  {control ? "停止控制" : "开始控制"}
                </button>
                <button type="button" onClick={close}>
                  关闭
                </button>
              </div>
            </div>

            {control && (
              <div className="remote-tools">
                <form className="remote-send" onSubmit={onText}>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="输入文字，回车发送到电脑"
                    aria-label="远控文字"
                  />
                  <button type="submit">发送</button>
                </form>
                <div className="remote-keys">
                  {[
                    ["Enter", "回车"],
                    ["Backspace", "退格"],
                    ["Escape", "Esc"],
                    ["ArrowUp", "↑"],
                    ["ArrowDown", "↓"],
                    ["ArrowLeft", "←"],
                    ["ArrowRight", "→"],
                  ].map(([name, label]) => (
                    <button key={name} type="button" onClick={() => key(name)}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="remote-hint">
                  点击画面等于鼠标左键；长按/拖动可拖拽；右键菜单会被发送为右键点击。随时可停。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
