import { useEffect, useState } from "react";
import type { State } from "../model/reduce";
import type { Profile } from "../model/types";
import { canStop, deviceText, linkReady, linkText } from "../model/selectors";
import { ScreenPanel } from "../ui/ScreenPanel";
import type { Theme } from "./theme";
import { PageHeader } from "./Chrome";

const PROFILES: Array<[Profile, string, string]> = [
  ["read-only", "只读", "改动都问"],
  ["workspace", "工作区", "先问一次"],
  ["full", "完全", "长期放行"],
];

export function ControlPage({
  state,
  theme,
  onToggleTheme,
  onDrawer,
  onProfile,
  onOpenRules,
  onStop,
}: {
  state: State;
  theme: Theme;
  onToggleTheme: () => void;
  onDrawer: () => void;
  onProfile: (profile: Profile) => void;
  onOpenRules: () => void;
  onStop: () => void;
}) {
  const [ruleCount, setRuleCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/rules")
      .then(async (res) => (res.ok ? ((await res.json()) as { rules?: string[] }) : { rules: [] }))
      .then((data) => {
        if (alive) setRuleCount((data.rules ?? []).length);
      })
      .catch(() => {
        if (alive) setRuleCount(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page">
      <PageHeader eyebrow="CONTROL" title="控制" theme={theme} onToggleTheme={onToggleTheme} onDrawer={onDrawer} />

      <ScreenPanel ready={linkReady(state)} />

      <section className="card">
        <div className="section-head">
          <h2>权限档位</h2>
          <span className={`pill ${state.profile === "full" ? "warn" : "quiet"}`}>
            {PROFILES.find(([value]) => value === state.profile)?.[1] ?? state.profile}
          </span>
        </div>
        <div className="profiles">
          {PROFILES.map(([value, label, desc]) => (
            <button
              key={value}
              className={`profile-option${value === state.profile ? " on" : ""}`}
              type="button"
              onClick={() => onProfile(value)}
            >
              {label}
              <small>{desc}</small>
            </button>
          ))}
        </div>
        <div className="page-note">硬禁止（系统目录 / 凭据 / 磁盘）任何档位都不放。</div>
      </section>

      <section className="card">
        <div className="control-row">
          <span>
            <b>已配对设备</b>
            <small>{state.device.name || "本机"} · 第一台自动信任</small>
          </span>
          <span className={`pill ${linkReady(state) ? "accent" : "quiet"}`}>{deviceText(state)}</span>
        </div>
        <button className="control-row" type="button" onClick={onOpenRules}>
          <span>
            <b>记住的规则</b>
            <small>{ruleCount === null ? "读不到条数" : `${ruleCount} 条 · 同类不再问`}</small>
          </span>
          <span className="link">撤销 ›</span>
        </button>
        <div className="control-row">
          <span>
            <b>当前入口</b>
            <small>{location.host}</small>
          </span>
          <span className={`pill ${linkReady(state) ? "accent" : "quiet"}`}>{linkText(state)}</span>
        </div>
        <div className="control-row">
          <span>
            <b>电脑指标</b>
            <small>CPU / 内存 · 未接</small>
          </span>
          <span className="pill quiet">未接</span>
        </div>
      </section>

      <button className="stop-btn" type="button" disabled={!canStop(state)} onClick={onStop}>
        {canStop(state) ? "停止当前任务" : "当前没有在跑的任务"}
      </button>
      <div className="page-note">停止只作用于当前活动任务；不会停掉别的会话。</div>
    </div>
  );
}
