import { useEffect, useRef, useState } from "react";
import { getToken } from "../net/ws";

interface Ticket {
  ticket: string;
  path: string;
  sha256: string;
  size: number;
  content_type: string;
  expires_at: number;
}

function shortHash(hash: string): string {
  return hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "";
}

function kindOf(contentType: string): "image" | "pdf" | "html" | "text" | "other" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("application/pdf")) return "pdf";
  if (contentType.startsWith("text/html")) return "html";
  if (contentType.startsWith("text/")) return "text";
  return "other";
}

export function ArtifactPreview({ path, sessionId, onClose }: { path: string; sessionId?: string; onClose: () => void }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"accept" | "reject" | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/artifacts/ticket", {
          method: "POST",
          headers: { "content-type": "application/json", "x-vance-token": getToken() },
          body: JSON.stringify({ path, ...(sessionId ? { session_id: sessionId } : {}) }),
        });
        const body = (await res.json()) as any;
        if (!alive) return;
        if (!res.ok) {
          setError(body?.error === "not-an-artifact" ? "这个文件不在本轮产出里" : "取不到原件");
          return;
        }
        setTicket(body as Ticket);
        if (kindOf(body.content_type) === "text") {
          const raw = await fetch(`/artifacts/${body.ticket}`);
          if (alive) setText(await raw.text());
        }
      } catch {
        if (alive) setError("网络失败，取不到原件");
      }
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  const decide = async (decision: "accept" | "reject") => {
    if (!ticket || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/artifacts/accept", {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": getToken() },
        body: JSON.stringify({ ticket: ticket.ticket, decision, note: note.trim() }),
      });
      const body = (await res.json()) as any;
      if (res.status === 409) {
        setError("文件已变化，请关闭后重新打开再确认");
        return;
      }
      if (!res.ok) {
        setError("验收失败，请重试");
        return;
      }
      setDone(decision);
    } catch {
      setError("网络失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const kind = ticket ? kindOf(ticket.content_type) : "other";

  const openFullscreen = async () => {
    const el = frameRef.current;
    if (!el) return;
    try {
      await el.requestFullscreen();
    } catch {
      setError("当前浏览器不支持全屏预览，请下载原件或在电脑上打开");
    }
  };

  const canFullscreen = kind === "html" || kind === "pdf";

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet preview-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>交付物</span>
          <div className="preview-head-actions">
            {ticket && !done && canFullscreen && (
              <button className="preview-open" type="button" onClick={openFullscreen}>
                全屏查看
              </button>
            )}
            <button className="icon-btn" type="button" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="preview-path" title={path}>
          {path}
        </div>

        {error && <div className="preview-error">{error}</div>}
        {!ticket && !error && <div className="sheet-empty">取原件中…</div>}

        {ticket && !done && (
          <>
            <div className="preview-body">
              <div className="preview-frame">
                {kind === "image" && <img src={`/artifacts/${ticket.ticket}`} alt="产出原件" />}
                {kind === "pdf" && (
                  <iframe
                    ref={frameRef}
                    title="产出原件"
                    src={`/artifacts/${ticket.ticket}`}
                    allow="fullscreen"
                    allowFullScreen
                  />
                )}
                {kind === "html" && (
                  <iframe
                    ref={frameRef}
                    className="preview-html"
                    title="交付页面"
                    sandbox="allow-scripts allow-forms allow-popups"
                    allow="fullscreen"
                    allowFullScreen
                    src={`/artifacts/${ticket.ticket}`}
                  />
                )}
                {kind === "text" && <pre className="preview-text">{text}</pre>}
                {kind === "other" && (
                  <div className="preview-other">
                    手机上无法预览这类文件。请下载原件，或回电脑上打开。
                    <a className="btn ghost" href={`/artifacts/${ticket.ticket}`} download>
                      下载原件
                    </a>
                  </div>
                )}
              </div>
              <div className="preview-meta">
                {Math.max(1, Math.round(ticket.size / 1024))} KB · sha256 {shortHash(ticket.sha256)}
              </div>
              <textarea
                className="preview-note"
                rows={2}
                placeholder="打回时写一句意见（可不填）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="preview-actions">
              <button className="btn deny" type="button" disabled={busy} onClick={() => decide("reject")}>
                打回重做
              </button>
              <button className="btn allow" type="button" disabled={busy} onClick={() => decide("accept")}>
                确认交付
              </button>
            </div>
          </>
        )}

        {done && (
          <div className="preview-done">
            {done === "accept" ? "已确认交付。" : "已打回，意见已交给 Agent。"}
            <button className="btn ghost" type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
