import { useEffect, useState } from "react";
import { store, useVance } from "../model/store";
import { latestArtifacts } from "../model/selectors";
import { send, getToken } from "../net/ws";
import type { Profile } from "../model/types";
import { ArtifactPreview } from "../ui/ArtifactPreview";
import {
  ArtifactsSheet,
  ArtifactRepoSheet,
  DeviceSheet,
  RulesSheet,
  SessionsSheet,
  UndoSheet,
  type SessionRow,
} from "../ui/Sheets";
import { AgentsPage } from "./AgentsPage";
import { ArtifactsPage } from "./ArtifactsPage";
import { ControlPage } from "./ControlPage";
import { Drawer } from "./Drawer";
import { Overview } from "./Overview";
import { TabBar } from "./Chrome";
import { parseHash, tabHref, taskHref, type Tab } from "./routing";
import { TaskDetail } from "./TaskDetail";
import { useTheme } from "./theme";

type Sheet = "repo" | "sessions" | "rules" | "undo" | "artifacts" | null;

export function Shell() {
  const s = useVance();
  const { choice, theme, setChoice } = useTheme();
  const [hash, setHash] = useState(() => location.hash);
  const [now, setNow] = useState(() => Date.now());
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [rules, setRules] = useState<string[]>([]);
  const [artifactPath, setArtifactPath] = useState<string | null>(null);
  const [artifactSession, setArtifactSession] = useState<string | undefined>(undefined);
  const route = parseHash(hash);
  const result = latestArtifacts(s)?.data ?? null;

  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      store.dispatch({ type: "tick", now: at });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const go = (href: string) => {
    setDrawer(false);
    setSheet(null);
    if (location.hash === href) setHash(href);
    else location.hash = href;
  };

  const openTask = () => {
    if (!s.sessionId) return;
    go(taskHref(s.sessionId));
  };

  const openSessions = async () => {
    try {
      const res = await fetch("/sessions");
      const data = (await res.json()) as { sessions?: SessionRow[] };
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    }
    setDrawer(false);
    setSheet("sessions");
  };

  const openRules = async () => {
    try {
      const res = await fetch("/rules");
      const data = (await res.json()) as { rules?: string[] };
      setRules(data.rules ?? []);
    } catch {
      setRules([]);
    }
    setDrawer(false);
    setSheet("rules");
  };

  const revokeRule = async (key: string) => {
    try {
      const res = await fetch("/rules/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (res.ok) setRules((list) => list.filter((k) => k !== key));
    } catch {
      /* 网络失败保持原样 */
    }
  };

  const pickProfile = async (profile: Profile) => {
    try {
      const res = await fetch("/profile", {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": getToken() },
        body: JSON.stringify({ profile }),
      });
      if (!res.ok) throw new Error(String(res.status));
      store.dispatch({ type: "localProfile", profile });
    } catch {
      window.alert("权限切换失败：网络或口令问题。刷新页面后重试。");
    }
  };

  const pickSession = (id: string) => {
    send({ type: "session/attach", sessionId: id });
    go(taskHref(id));
  };

  const newTask = () => {
    send({ type: "session/new" });
    setSheet(null);
    go(tabHref("overview"));
  };

  const switchTask = (id: string) => {
    send({ type: "session/switch", sessionId: id });
    go(taskHref(id));
  };

  return (
    <div className="shell">
      {route.kind === "task" ? (
        <TaskDetail
          id={route.id}
          now={now}
          theme={theme}
          onBack={() => go(tabHref("overview"))}
          onOpenArtifacts={() => setSheet("artifacts")}
          onToggleTheme={() => setChoice(theme === "dark" ? "light" : "dark")}
        />
      ) : (
        <>
          <main className="shell-main">
            {route.tab === "overview" && (
              <Overview
                state={s}
                now={now}
                theme={theme}
                onToggleTheme={() => setChoice(theme === "dark" ? "light" : "dark")}
                onDrawer={() => setDrawer(true)}
                onOpenTask={openTask}
                onTab={(tab: Tab) => go(tabHref(tab))}
                onOpenArtifact={(path) => {
                  setArtifactSession(s.sessionId);
                  setArtifactPath(path);
                }}
              />
            )}
            {route.tab === "agents" && (
              <AgentsPage
                state={s}
                theme={theme}
                onToggleTheme={() => setChoice(theme === "dark" ? "light" : "dark")}
                onDrawer={() => setDrawer(true)}
                onOpenTask={openTask}
              />
            )}
            {route.tab === "artifacts" && (
              <ArtifactsPage
                artifacts={result}
                theme={theme}
                onToggleTheme={() => setChoice(theme === "dark" ? "light" : "dark")}
                onDrawer={() => setDrawer(true)}
                onOpenRepo={() => setSheet("repo")}
                onOpen={(path, sessionId) => {
                  setArtifactSession(sessionId ?? s.sessionId);
                  setArtifactPath(path);
                }}
              />
            )}
            {route.tab === "control" && (
              <ControlPage
                state={s}
                theme={theme}
                onToggleTheme={() => setChoice(theme === "dark" ? "light" : "dark")}
                onDrawer={() => setDrawer(true)}
                onProfile={pickProfile}
                onOpenRules={openRules}
                onStop={() => send({ type: "stop" })}
              />
            )}
          </main>
          <TabBar active={route.tab} onChange={(tab) => go(tabHref(tab))} />
        </>
      )}

      {drawer && (
        <Drawer
          themeChoice={choice}
          theme={theme}
          onTheme={setChoice}
          deviceName={s.device.name}
          deviceLabel={s.device.phase === "trusted" ? "已配对" : s.device.phase === "pending" ? "等待允许" : "未识别"}
          onClose={() => setDrawer(false)}
          onSessions={openSessions}
          onRules={openRules}
          onUndo={() => {
            setDrawer(false);
            setSheet("undo");
          }}
          onRepo={() => {
            setDrawer(false);
            setSheet("repo");
          }}
        />
      )}

      {sheet === "repo" && (
        <ArtifactRepoSheet
          onOpen={(path, sessionId) => {
            setSheet(null);
            setArtifactSession(sessionId);
            setArtifactPath(path);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "artifacts" && result && (
        <ArtifactsSheet
          data={result}
          onOpen={(p) => {
            setSheet(null);
            setArtifactPath(p);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "sessions" && (
        <SessionsSheet
          sessions={sessions}
          currentId={s.sessionId}
          onPick={pickSession}
          onNew={newTask}
          onSwitch={switchTask}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "rules" && <RulesSheet rules={rules} onRevoke={revokeRule} onClose={() => setSheet(null)} />}
      {sheet === "undo" && <UndoSheet onClose={() => setSheet(null)} />}

      {artifactPath && (
        <ArtifactPreview
          path={artifactPath}
          sessionId={artifactSession ?? s.sessionId}
          onClose={() => {
            setArtifactPath(null);
            setArtifactSession(undefined);
          }}
        />
      )}

      {s.device.incoming.length > 0 && (
        <DeviceSheet
          request={s.device.incoming[0]!}
          onDecide={(allow) => {
            const req = s.device.incoming[0];
            if (!req) return;
            const sent = send({ type: "device_decision", deviceId: req.deviceId, allow });
            if (sent) store.dispatch({ type: "device-decided", deviceId: req.deviceId });
          }}
        />
      )}
    </div>
  );
}
