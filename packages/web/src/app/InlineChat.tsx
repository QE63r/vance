import { useEffect, useRef } from "react";
import { store, useVance } from "../model/store";
import { canSend, canStop, hintText, latestArtifacts } from "../model/selectors";
import { send } from "../net/ws";
import { Timeline } from "../ui/Timeline";
import { Composer } from "../ui/Composer";

/** 总览里的对话态：控制卡片折叠，时间线和输入栏在同一页出现。 */
export function InlineChat({
  now,
  onClose,
  onOpenArtifacts,
}: {
  now: number;
  onClose: () => void;
  onOpenArtifacts: () => void;
}) {
  const s = useVance();
  const feedRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const result = latestArtifacts(s)?.data ?? null;
  const lastItem = s.timeline[s.timeline.length - 1];
  const streamLen = lastItem?.kind === "agent" ? lastItem.text.length : 0;

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (!stick.current && lastItem?.kind !== "user") return;
    el.scrollTop = el.scrollHeight;
  }, [s.timeline.length, s.approvals, lastItem?.id, streamLen, lastItem?.kind, s.exec.phase, s.pendingUser]);

  return (
    <section className="inline-chat">
      <div className="inline-head">
        <div>
          <b>对话</b>
          <small>{s.task || s.project || "当前任务"}</small>
        </div>
        <button className="inline-collapse" type="button" onClick={onClose}>
          收起对话
        </button>
      </div>

      <div
        className="inline-feed"
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        <Timeline state={s} now={now} />
      </div>

      {result && (
        <button className="inline-dock" type="button" onClick={onOpenArtifacts}>
          <span>本轮产出</span>
          <span className="inline-dock-value">
            新增 {result.added.length} · 改动 {result.changed.length} · 删除 {result.removed.length}
            {result.warnings.length > 0 ? ` · ${result.warnings.length} 条提醒` : ""}
          </span>
          <span className="inline-dock-arrow">›</span>
        </button>
      )}

      <Composer
        autoFocus
        canSend={canSend(s)}
        canStop={canStop(s)}
        hint={hintText(s, now)}
        onSend={(text) => {
          const ok = send({ type: "prompt", text });
          if (ok) {
            store.dispatch({ type: "localUser", text, at: Date.now() });
            stick.current = true;
          }
          return ok;
        }}
        onStop={() => send({ type: "stop" })}
      />
    </section>
  );
}
