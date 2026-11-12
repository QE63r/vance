import { useEffect, useRef } from "react";
import { store, useVance } from "../model/store";
import { canSend, canStop, execText, hintText, latestArtifacts } from "../model/selectors";
import { send } from "../net/ws";
import { Timeline } from "../ui/Timeline";
import { Composer } from "../ui/Composer";
import type { Theme } from "./theme";

export function TaskDetail({
  id,
  now,
  theme,
  onBack,
  onOpenArtifacts,
  onToggleTheme,
}: {
  id: string;
  now: number;
  theme: Theme;
  onBack: () => void;
  onOpenArtifacts: () => void;
  onToggleTheme: () => void;
}) {
  const s = useVance();
  const feedRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const attached = useRef("");
  const isCurrent = !id || id === s.sessionId;
  const title = s.task || s.project || "当前任务";
  const artifacts = latestArtifacts(s);
  const result = artifacts?.data ?? null;
  const lastItem = s.timeline[s.timeline.length - 1];
  const streamLen = lastItem?.kind === "agent" ? lastItem.text.length : 0;

  // 从别的任务点进来：先 attach 看历史；只有当前任务才允许发指令
  useEffect(() => {
    if (!id || id === s.sessionId || attached.current === id) return;
    attached.current = id;
    send({ type: "session/attach", sessionId: id });
  }, [id, s.sessionId]);

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (!stick.current && lastItem?.kind !== "user") return;
    el.scrollTop = el.scrollHeight;
  }, [s.timeline.length, s.approvals, lastItem?.id, streamLen, lastItem?.kind, s.exec.phase, s.pendingUser]);

  return (
    <div className="task">
      <header className="task-head">
        <button className="back-btn" type="button" onClick={onBack} aria-label="返回总览">
          ‹
        </button>
        <div className="task-title">
          <b>{title}</b>
          <small>
            {s.project || "会话"} · {execText(s)}
          </small>
        </div>
        <button
          className="task-theme"
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "切换白天" : "切换夜晚"}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
        <span className={`pill ${s.exec.phase === "running" ? "accent" : "quiet"}`}>
          {s.exec.phase === "running" ? "执行中" : "空闲"}
        </span>
      </header>

      {!isCurrent && (
        <div className="readonly-banner">这是别的任务，只读；回任务列表点「切到此任务」后才能发指令。</div>
      )}

      <main
        className="task-feed"
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        <Timeline state={s} now={now} />
      </main>

      <button className="task-dock" type="button" onClick={onOpenArtifacts} disabled={!result}>
        <span>本轮产出</span>
        {result ? (
          <span className="task-dock-value">
            新增 {result.added.length} · 改动 {result.changed.length} · 删除 {result.removed.length}
            {result.warnings.length > 0 ? ` · ${result.warnings.length} 条提醒` : ""}
          </span>
        ) : (
          <span className="task-dock-empty">还没有产出</span>
        )}
        <span className="task-dock-arrow">›</span>
      </button>

      <Composer
        canSend={isCurrent && canSend(s)}
        canStop={isCurrent && canStop(s)}
        hint={isCurrent ? hintText(s, now) : "只读任务"}
        onSend={(text) => {
          if (!isCurrent) return false;
          const ok = send({ type: "prompt", text });
          if (ok) {
            store.dispatch({ type: "localUser", text, at: Date.now() });
            stick.current = true;
          }
          return ok;
        }}
        onStop={() => {
          if (isCurrent) send({ type: "stop" });
        }}
      />
    </div>
  );
}
