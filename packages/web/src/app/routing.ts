/** 壳的 hash 路由：4 个 tab + 任务详情。token/session 的旧 hash 都回落到总览。 */
export type Tab = "overview" | "agents" | "artifacts" | "control";
export type Route = { kind: "tab"; tab: Tab } | { kind: "task"; id: string };

const TABS: Tab[] = ["overview", "agents", "artifacts", "control"];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const task = /^\/task\/(.+)$/.exec(raw);
  if (task?.[1]) {
    try {
      return { kind: "task", id: decodeURIComponent(task[1]) };
    } catch {
      return { kind: "tab", tab: "overview" };
    }
  }
  const tab = raw.replace(/^\/+/, "").split(/[?&]/)[0] as Tab;
  return { kind: "tab", tab: TABS.includes(tab) ? tab : "overview" };
}

export function tabHref(tab: Tab): string {
  return `#/${tab}`;
}

export function taskHref(id: string): string {
  return `#/task/${encodeURIComponent(id)}`;
}

export function tabTitle(tab: Tab): string {
  switch (tab) {
    case "overview":
      return "总览";
    case "agents":
      return "智能体";
    case "artifacts":
      return "交付物";
    case "control":
      return "控制";
  }
}
