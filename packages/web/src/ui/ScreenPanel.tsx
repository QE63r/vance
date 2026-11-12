import {
  useEffect,
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [open, setOpen] = useState(false);
  const [control, setControl] = useState(false);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<"full" | "two-thirds">("full");
  const [showKeys, setShowKeys] = useState(true);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastMove = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame.url) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
    };
    image.src = frame.url;
    return () => {
      cancelled = true;
    };
  }, [frame.url, open]);
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
    setShowKeys(true);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  };

  const enterFullscreen = async () => {
    const el = viewerRef.current;
    if (!el) return;
    setSize("full");
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (mode: "landscape") => Promise<void>;
      };
      await orientation.lock?.("landscape").catch(() => undefined);
    } catch {
      /* iOS / 不支持全屏时保持页面内全屏样式 */
    }
    inputRef.current?.blur();
  };

  const useTwoThirds = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setSize("two-thirds");
  };

  const openPhoneKeyboard = () => {
    setShowKeys(false);
    inputRef.current?.focus();
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
    event: PointerEvent<HTMLCanvasElement>,
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
          <div
            ref={viewerRef}
            className={`viewer-inner viewer-remote size-${size}`}
            onClick={(e) => e.stopPropagation()}
          >
            {frame.url ? (
              <div className="remote-stage">
                <canvas
                  ref={canvasRef}
                  aria-label="电脑屏幕"
                  role="img"
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
                <button type="button" onClick={() => void enterFullscreen()}>
                  全屏
                </button>
                <button
                  type="button"
                  className={size === "two-thirds" ? "active" : ""}
                  onClick={useTwoThirds}
                >
                  2/3
                </button>
                <button type="button" onClick={openPhoneKeyboard}>
                  手机键盘
                </button>
                {!showKeys && (
                  <button type="button" onClick={() => setShowKeys(true)}>
                    功能键
                  </button>
                )}
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
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="输入文字，回车发送到电脑"
                    aria-label="远控文字"
                    inputMode="text"
                    enterKeyHint="send"
                    autoComplete="off"
                  />
                  <button type="submit">发送</button>
                </form>
                {showKeys && (
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
                )}
                <p className="remote-hint">
                  点「手机键盘」会调起系统软键盘；点画面等于鼠标左键，长按/拖动可拖拽。随时可停。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
