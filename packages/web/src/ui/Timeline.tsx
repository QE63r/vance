import type { State } from "../model/reduce";
import { ApprovalCard } from "./ApprovalCard";

const MARK: Record<string, string> = { pending: "○", running: "●", done: "✓", failed: "✗" };
const KIND: Record<string, string> = { execute: "执行", edit: "编辑", read: "读取", fetch: "联网" };

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("\\");
}

export function Timeline({ state, now }: { state: State; now: number }) {
  if (state.timeline.length === 0) {
    return (
      <div className="empty">
        <div className="empty-title">还没开始</div>
        <div className="empty-sub">在下面说一句，让电脑上的 Agent 动手</div>
      </div>
    );
  }

  return (
    <div className="timeline">
      {state.timeline.map((item) => {
        switch (item.kind) {
          case "user":
            return (
              <div className="row row-user" key={item.id}>
                <div className="bubble user">{item.text}</div>
                <div className="stamp">{clock(item.at)}</div>
              </div>
            );

          case "agent":
            return (
              <div className="row row-agent" key={item.id}>
                <div className="bubble agent">
                  {item.text}
                  {item.streaming && <span className="caret" />}
                </div>
              </div>
            );

          case "step":
            return (
              <div className={`step step-${item.step.status}`} key={item.id}>
                <span className="step-mark">{MARK[item.step.status] ?? "○"}</span>
                <span className="step-kind">{KIND[item.step.kind ?? ""] ?? ""}</span>
                <span className="step-title">{item.step.title}</span>
              </div>
            );

          case "approval": {
            const entry = state.approvals[item.requestId];
            if (!entry) return null;
            return <ApprovalCard key={item.id} entry={entry} now={now} linkReady={state.link.phase === "ready"} />;
          }

          case "notice":
            return (
              <div className={`notice notice-${item.level}`} key={item.id}>
                <span className="notice-dot" />
                <span>{item.text}</span>
              </div>
            );

          case "artifacts": {
            const d = item.data;
            const names = [...d.added, ...d.changed, ...d.removed].slice(0, 2).map(shortPath);
            return (
              <div className="settle" key={item.id}>
                <div className="settle-head">
                  本轮产出 · 新增 {d.added.length} · 改动 {d.changed.length} · 删除 {d.removed.length}
                </div>
                {names.length > 0 && <div className="settle-names">{names.join(" · ")}</div>}
                {d.warnings.map((w) => (
                  <div className="settle-warn" key={w}>
                    ⚠ {w}
                  </div>
                ))}
              </div>
            );
          }

          case "image":
            return (
              <div className="row row-image" key={item.id}>
                <img src={item.dataUrl} alt="电脑屏幕" />
              </div>
            );
        }
      })}
    </div>
  );
}
