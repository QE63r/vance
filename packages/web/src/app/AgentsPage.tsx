import type { State } from "../model/reduce";
import { execText } from "../model/selectors";
import type { Theme } from "./theme";
import { PageHeader } from "./Chrome";

const P2 = ["Planner", "Reviewer", "Coder", "Researcher", "Operator"];

export function AgentsPage({
  state,
  theme,
  onToggleTheme,
  onDrawer,
  onOpenTask,
}: {
  state: State;
  theme: Theme;
  onToggleTheme: () => void;
  onDrawer: () => void;
  onOpenTask: () => void;
}) {
  const running = state.exec.phase === "running";

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
          <span className="agent-name">Executor</span>
          <span className={`pill ${running ? "accent" : "quiet"}`}>{running ? "运行中" : "待命"}</span>
        </span>
        <span className="agent-sub">执行 · opencode · ACP</span>
        <span className="agent-line">{running ? `正在做：${state.task || state.project || "当前任务"}` : "点开当前任务"}</span>
      </button>

      <div className="agent-list">
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
        <div className="agent-row p2">
          <span className="agent-ico">AI</span>
          <span className="agent-row-main">
            <b>外部 AI</b>
            <small>DeepSeek / 豆包 · 未接（D）</small>
          </span>
          <span className="pill quiet">未接</span>
        </div>
      </div>

      <button className="pull-disabled" type="button" disabled>
        + 拉取 Agent（P2 · 未接）
      </button>
      <div className="page-note">
        只有 Executor 是真实运行的；其余虚线卡不可点，也不显示伪造的在线状态。
      </div>
    </div>
  );
}
