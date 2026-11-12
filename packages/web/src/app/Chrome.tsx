import type { ReactNode } from "react";
import type { Tab } from "./routing";
import type { Theme } from "./theme";

export function PageHeader({
  eyebrow,
  title,
  theme,
  onToggleTheme,
  onDrawer,
}: {
  eyebrow: string;
  title: string;
  theme: Theme;
  onToggleTheme: () => void;
  onDrawer: () => void;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="page-actions">
        <button
          className="theme-btn"
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "切换白天" : "切换夜晚"}
          title={theme === "dark" ? "当前夜晚，点切换白天" : "当前白天，点切换夜晚"}
        >
          <span aria-hidden>{theme === "dark" ? "☾" : "☀"}</span>
          {theme === "dark" ? "夜晚" : "白天"}
        </button>
        <button className="avatar" type="button" onClick={onDrawer} aria-label="我的">
          我
        </button>
      </div>
    </header>
  );
}

const ICONS: Record<Tab, ReactNode> = {
  overview: (
    <svg viewBox="0 0 24 24">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  ),
  agents: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c.6-3.4 3.1-5 6.5-5s5.9 1.6 6.5 5" />
    </svg>
  ),
  artifacts: (
    <svg viewBox="0 0 24 24">
      <path d="M4 7.5h6l1.6 2H20v9H4z" />
      <path d="M4 7.5V5.8h5l1.5 1.7" />
    </svg>
  ),
  control: (
    <svg viewBox="0 0 24 24">
      <path d="M5 7h14M5 12h14M5 17h14" />
      <circle cx="9" cy="7" r="1.7" fill="var(--card)" />
      <circle cx="15" cy="12" r="1.7" fill="var(--card)" />
      <circle cx="10" cy="17" r="1.7" fill="var(--card)" />
    </svg>
  ),
};

const TABS: Array<[Tab, string]> = [
  ["overview", "总览"],
  ["agents", "智能体"],
  ["artifacts", "交付物"],
  ["control", "控制"],
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map(([tab, label]) => (
        <button
          key={tab}
          className={`tab${tab === active ? " active" : ""}`}
          type="button"
          onClick={() => onChange(tab)}
          aria-current={tab === active ? "page" : undefined}
        >
          {ICONS[tab]}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
