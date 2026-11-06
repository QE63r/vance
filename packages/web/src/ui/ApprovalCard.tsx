import { useState } from "react";
import type { ApprovalEntry } from "../model/reduce";
import { approvalRemaining } from "../model/selectors";
import { store } from "../model/store";
import { send } from "../net/ws";

const KIND: Record<string, string> = { execute: "执行", edit: "编辑", read: "读取", fetch: "联网" };

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ApprovalCard({ entry, now, linkReady }: { entry: ApprovalEntry; now: number; linkReady: boolean }) {
  const [remember, setRemember] = useState(false);
  const ev = entry.event;
  const remaining = approvalRemaining(entry, now);
  const open = entry.phase === "offered" || entry.phase === "submitting";
  const facts = ev.facts ?? {};

  const decide = (decision: "allow" | "reject") => {
    if (!open || !linkReady || entry.phase === "submitting") return;
    const sent = send({ type: "decision", requestId: ev.request_id, decision: remember ? "remember" : decision });
    if (sent) store.dispatch({ type: "decide", requestId: ev.request_id, decision: remember ? "remember" : decision });
  };

  return (
    <div className={`card approval phase-${entry.phase}`}>
      <div className="card-kicker">
        {entry.phase === "offered" && <>需要你批准 · 还剩 {mmss(remaining)}</>}
        {entry.phase === "submitting" && <>提交中…</>}
        {entry.phase === "resolved" && <>已{entry.decision === "reject" ? "拒绝" : "批准"}{entry.by ? ` · ${entry.by}` : ""}</>}
        {entry.phase === "expired" && <>已过期</>}
        {entry.phase === "stale" && <>已失效 · 超时或另一台设备已处理</>}
      </div>

      <div className="card-action">{ev.action_display || "(无动作)"}</div>

      <div className="facts">
        {typeof facts.kind === "string" && <span className="tag">{KIND[facts.kind] ?? facts.kind}</span>}
        {facts.files !== undefined && <span className="tag">文件 {String(facts.files)}</span>}
        {facts.adds !== undefined && <span className="tag">+{String(facts.adds)}</span>}
        {facts.removes !== undefined && <span className="tag">−{String(facts.removes)}</span>}
      </div>

      {ev.preview && (
        <details className="preview">
          <summary>改动预览</summary>
          <pre>{ev.preview}</pre>
        </details>
      )}

      {open ? (
        <>
          <div className="card-actions">
            <button className="btn deny" type="button" disabled={!linkReady || entry.phase === "submitting"} onClick={() => decide("reject")}>
              拒绝
            </button>
            <button className="btn allow" type="button" disabled={!linkReady || entry.phase === "submitting"} onClick={() => decide("allow")}>
              {entry.phase === "submitting" ? "提交中…" : remember ? "批准并记住" : "批准"}
            </button>
          </div>
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            记住这个选择（以后不再问）
          </label>
          <div className="card-foot">
            原文 {ev.raw_ref?.length ?? 0} 字节 · 摘要 {ev.raw_digest.slice(0, 12)}…
            {!linkReady && <span className="card-off"> · 连接恢复后可操作</span>}
          </div>
        </>
      ) : (
        <div className="card-foot">
          原文 {ev.raw_ref?.length ?? 0} 字节 · 摘要 {ev.raw_digest.slice(0, 12)}…
        </div>
      )}
    </div>
  );
}
