import { useEffect, useState } from "react";
import type { State } from "../model/reduce";
import { deviceText, execText, latestArtifacts, linkReady, linkText, pendingApprovals, pendingPlans } from "../model/selectors";
import { getToken } from "../net/ws";
import type { Tab } from "./routing";
import type { Theme } from "./theme";
import { PageHeader } from "./Chrome";

interface PendingArtifact {
  id: string;
  path: string;
  at: number;
}

function ago(at: number, now: number): string {
  if (!at) return "";
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

function shortName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function Overview({
  state,
  now,
  theme,
  onToggleTheme,
  onDrawer,
  onOpenTask,
  onTab,
  onOpenArtifact,
}: {
  state: State;
  now: number;
  theme: Theme;
  onToggleTheme: () => void;
  onDrawer: () => void;
  onOpenTask: () => void;
  onTab: (tab: Tab) => void;
  onOpenArtifact: (path: string) => void;
}) {
  const [pendingArtifacts, setPendingArtifacts] = useState<PendingArtifact[]>([]);
  const approvals = pendingApprovals(state);
  const plans = pendingPlans(state);
  const latest = latestArtifacts(state);
  const result = latest?.data ?? null;
  const pending = approvals.length + plans.length;
  const artifactCount = result ? result.added.length + result.changed.length + result.removed.length : 0;
  const running = state.exec.phase === "running";
  const taskTitle = state.task || state.project || "当前会话";

  useEffect(() => {
    let alive = true;
    fetch("/artifacts?status=pending&limit=5", { headers: { "x-vance-token": getToken() } })
      .then(async (res) => (res.ok ? ((await res.json()) as { artifacts?: PendingArtifact[] }) : { artifacts: [] }))
      .then((data) => {
        if (alive) setPendingArtifacts((data.artifacts ?? []).slice(0, 5));
      })
      .catch(() => {
        if (alive) setPendingArtifacts([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page overview">
      <PageHeader
        eyebrow="CONTROL"
        title="总览"
        theme={theme}
        onToggleTheme={onToggleTheme}
        onDrawer={onDrawer}
      />

      <div className="chips">
        <span className={`chip${linkReady(state) ? " on" : ""}`}>
          <i />
          {linkText(state)}
        </span>
        <span className="chip">{deviceText(state)}</span>
        <span className={`chip${pending > 0 ? " warn" : ""}`}>待批 {pending}</span>
        <span className="chip">产出 {artifactCount}</span>
      </div>

      <section className="card pending-card">
        <div className="section-head">
          <h2>待你决定</h2>
          <span className="link" onClick={() => onTab("artifacts")} role="button" tabIndex={0}>
            交付物 ›
          </span>
        </div>
        {approvals.length === 0 && plans.length === 0 && pendingArtifacts.length === 0 && (
          <div className="page-empty">没有等你决定的事。</div>
        )}
        {approvals.map((entry) => (
          <button className="pending-row" key={entry.event.request_id} type="button" onClick={onOpenTask}>
            <span className="pending-main">
              <b>审批：{entry.event.action_display || "(无动作)"}</b>
              <small>执行 · {ago(entry.event.timestamp, now)}</small>
            </span>
            <span className="pill warn">待批</span>
          </button>
        ))}
        {plans.map((entry) => (
          <button className="pending-row" key={entry.event.plan_id} type="button" onClick={onOpenTask}>
            <span className="pending-main">
              <b>计划：{entry.event.title || entry.event.steps[0]?.action_display || entry.event.plan_id}</b>
              <small>{entry.event.steps.length} 步 · 等批准</small>
            </span>
            <span className="pill warn">待批</span>
          </button>
        ))}
        {pendingArtifacts.map((item) => (
          <button className="pending-row" key={item.id} type="button" onClick={() => onOpenArtifact(item.path)}>
            <span className="pending-main">
              <b>验收：{shortName(item.path)}</b>
              <small>交付物 · {ago(item.at, now)}</small>
            </span>
            <span className="pill warn">待验收</span>
          </button>
        ))}
      </section>

      <div className="section-head page-section">
        <h2>智能体</h2>
        <span className="link" onClick={() => onTab("agents")} role="button" tabIndex={0}>
          管理 ›
        </span>
      </div>
      <div className="agent-grid">
        <button className={`agent-card${running ? " active" : ""}`} type="button" onClick={onOpenTask}>
          <span className="agent-top">
            <span className="agent-name">Executor</span>
            <span className={`pill ${running ? "accent" : "quiet"}`}>{running ? "运行中" : "待命"}</span>
          </span>
          <span className="agent-sub">opencode · ACP</span>
          <span className="agent-line">{running ? `正在做：${taskTitle}` : "点开当前任务"}</span>
        </button>
        <div className="agent-card p2">
          <span className="agent-top">
            <span className="agent-name">Planner</span>
            <span className="pill quiet">P2</span>
          </span>
          <span className="agent-sub">拆解任务 · 未接</span>
        </div>
        <div className="agent-card p2">
          <span className="agent-top">
            <span className="agent-name">Reviewer</span>
            <span className="pill quiet">P2</span>
          </span>
          <span className="agent-sub">复核 · 未接</span>
        </div>
      </div>

      <button className="card run-card" type="button" onClick={onOpenTask}>
        <span className="section-head as-row">
          <span>
            <b>{running ? "运行中" : "当前任务"}</b>
            <small>Executor · {execText(state)}</small>
          </span>
          <span className={`pill ${running ? "accent" : "quiet"}`}>{running ? "执行中" : "空闲"}</span>
        </span>
        <span className="run-title">{taskTitle}</span>
        <span className="run-meta">
          {state.project || "会话"} · 点开任务详情
        </span>
      </button>

      <section className="card computer-card">
        <div className="section-head">
          <h2>电脑</h2>
          <span className="link" onClick={() => onTab("control")} role="button" tabIndex={0}>
            控制 ›
          </span>
        </div>
        <div className="computer-row">
          <span className="mono">{location.host}</span>
          <span className={`pill ${linkReady(state) ? "accent" : "quiet"}`}>{linkText(state)}</span>
        </div>
        <div className="computer-meta">
          {state.project || "未命名"} · 指标未接 · {deviceText(state)}
        </div>
      </section>

      <div className="section-head page-section">
        <h2>最近交付物</h2>
        <span className="link" onClick={() => onTab("artifacts")} role="button" tabIndex={0}>
          全部 ›
        </span>
      </div>
      {result ? (
        <div className="card file-list">
          {[...result.added, ...result.changed].slice(0, 2).map((path) => (
            <button className="file-row" key={path} type="button" onClick={() => onOpenArtifact(path)}>
              <span className="file-icon">{shortName(path).split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}</span>
              <span className="file-main">
                <b>{shortName(path)}</b>
                <small>{result.added.includes(path) ? "新增" : "改动"} · 本轮</small>
              </span>
              <span className="pill quiet">本轮</span>
            </button>
          ))}
          {result.added.length + result.changed.length === 0 && <div className="page-empty">本轮只删除了文件。</div>}
          {result.added.length + result.changed.length > 2 && (
            <div className="more-line">还有 {result.added.length + result.changed.length - 2} 个交付物</div>
          )}
        </div>
      ) : (
        <div className="card page-empty">还没有产出。等 Agent 做完一轮，这里会留下文件。</div>
      )}

      <button className="command-bar" type="button" onClick={onOpenTask}>
        <span>对 Agent 说…</span>
        <span className="command-go">打开任务 ›</span>
      </button>
    </div>
  );
}
