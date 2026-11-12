import type { State } from "../model/reduce";
import type { Theme } from "./theme";
import { PageHeader } from "./Chrome";

const P2 = ["Planner", "Reviewer", "Coder", "Researcher", "Operator"];

const statusText: Record<string, string> = {
  connected: "已连接",
  available: "可接入",
  unavailable: "不可用",
};

export function AgentsPage({
  state,
  theme,
  onToggleTheme,
  onDrawer,
  onOpenTask,
  onSelectAgent,
}: {
  state: State;
  theme: Theme;
  onToggleTheme: () => void;
  onDrawer: () => void;
  onOpenTask: () => void;
  onSelectAgent: (id: string) => void;
}) {
  const running = state.exec.phase === "running";
  const active = state.agents.find((agent) => agent.id === state.activeAgent);
  const others = state.agents.filter((agent) => agent.id !== state.activeAgent);

  return (
    <div className="page">
      <PageHeader eyebrow="AGENTS" title="智能体" theme={theme} onToggleTheme={onToggleTheme} onDrawer={onDrawer} />
      <div className="segments">
        <span className="segment on">矩阵</span>
        <span className="segment">已安装</span>
        <span className="segment">可拉取</span>
      </div>

      <button className={`agent-card${running ? " active" : ""}`} type="button" onClick={onOpenTask}>
        <span className="agent-top">
          <span className="agent-name">{active?.name ?? "Executor"}</span>
          <span className={`pill ${running ? "accent" : "quiet"}`}>{running ? "运行中" : "待命"}</span>
        </span>
        <span className="agent-sub">
          {active ? `${active.kind} · ${statusText[active.status] ?? active.status}` : "执行 · opencode · ACP"}
        </span>
        <span className="agent-line">
          {running ? `正在做：${state.task || state.project || "当前任务"}` : "点开当前任务"}
        </span>
      </button>

      <div className="agent-list">
        {others.map((agent) => (
          <button
            className="agent-row"
            type="button"
            key={agent.id}
            onClick={() => onSelectAgent(agent.id)}
          >
            <span className="agent-ico">{agent.name.slice(0, 2).toUpperCase()}</span>
            <span className="agent-row-main">
              <b>{agent.name}</b>
              <small>{agent.note ?? agent.kind}</small>
            </span>
            <span className={`pill ${agent.status === "connected" ? "accent" : "quiet"}`}>
              {statusText[agent.status] ?? agent.status}
            </span>
          </button>
        ))}

        {P2.map((name) => (
          <div className="agent-row p2" key={name}>
            <span className="agent-ico">{name.slice(0, 2).toUpperCase()}</span>
            <span className="agent-row-main">
              <b>{name}</b>
              <small>
                {name === "Planner" && "拆解任务 · 未接"}
                {name === "Reviewer" && "复核 · 未接"}
                {name === "Coder" && "写代码 · P2 占位"}
                {name === "Researcher" && "检索 · P2 占位"}
                {name === "Operator" && "桌面操作 · P2 占位"}
              </small>
            </span>
            <span className="pill quiet">P2</span>
          </div>
        ))}
      </div>

      <button className="pull-disabled" type="button" disabled>
        + 拉取 Agent（P2 · 未接）
      </button>
      <div className="page-note">
        真实 Agent 由 Host 广告；点非当前 Agent 会发送 agent/select。P2 虚线卡只是占位。
      </div>
    </div>
  );
}
