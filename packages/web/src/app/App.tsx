import { useEffect, useRef, useState } from "react";
import { store, useVance } from "../model/store";
import { pendingCount, canSend, canStop, hintText, linkText, execText, deviceText, linkReady, latestArtifacts } from "../model/selectors";
import { send, getToken } from "../net/ws";
import { clearCredentials } from "../net/credentials";
import type { Profile } from "../model/types";
import { Timeline } from "../ui/Timeline";
import { Composer } from "../ui/Composer";
import { ScreenMini } from "../ui/ScreenMini";
import { ArtifactsSheet, ArtifactRepoSheet, DeviceSheet, MenuSheet, ProfileSheet, RulesSheet, SessionsSheet, type SessionRow } from "../ui/Sheets";
import { ArtifactPreview } from "../ui/ArtifactPreview";
import { PairScreen } from "./PairScreen";

export function App() {
  const s = useVance();
  const [now, setNow] = useState(() => Date.now());
  const [sheet, setSheet] = useState<null | "artifacts" | "menu" | "sessions" | "rules" | "profile" | "repo">(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [artifactPath, setArtifactPath] = useState<string | null>(null);
  const [artifactSession, setArtifactSession] = useState<string | undefined>(undefined);
  const [rules, setRules] = useState<string[]>([]);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);

  // 倒计时每秒走一次；只用来刷新审批卡上的秒数
  useEffect(() => {
    const t = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      store.dispatch({ type: "tick", now: at });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // 贴底时自动跟随；用户手动上翻后不抢。
  // 只在时间线内容变化时跟随——不要把每秒的倒计时也当成"该滚了"。
  // "自己刚发的消息"必须可见：键盘弹出会把贴底开关冲掉，所以 user 无条件到底。
  const lastItem = s.timeline[s.timeline.length - 1];
  const streamLen = lastItem?.kind === "agent" ? lastItem.text.length : 0;

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (!stick.current && lastItem?.kind !== "user") return;
    el.scrollTop = el.scrollHeight;
  }, [s.timeline.length, s.approvals, lastItem?.id, streamLen, lastItem?.kind, s.exec.phase, s.pendingUser]);

  const pending = pendingCount(s);
  const artifacts = latestArtifacts(s);
  const result = artifacts ? artifacts.data : null;

  const openSessions = async () => {
    try {
      const res = await fetch("/sessions");
      const data = (await res.json()) as { sessions?: SessionRow[] };
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    }
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
      /* 网络失败保持原样，下次再点 */
    }
  };

  const pickSession = (id: string) => {
    send({ type: "session/attach", sessionId: id });
    setSheet(null);
  };

  const newTask = () => {
    send({ type: "session/new" });
    setSheet(null);
  };

  const switchTask = (id: string) => {
    send({ type: "session/switch", sessionId: id });
    setSheet(null);
  };

  const pickProfile = async (profile: Profile) => {
    try {
      const res = await fetch("/profile", {
        method: "POST",
        headers: { "content-type": "application/json", "x-vance-token": getToken() },
        body: JSON.stringify({ profile }),
      });
      if (res.ok) setSheet(null);
    } catch {
      /* 网络失败就留在面板里，重试 */
    }
  };

  const PROFILE_TEXT: Record<Profile, string> = { "read-only": "只读", workspace: "工作区", full: "完全" };

  const forget = () => {
    if (!window.confirm("清掉这台手机的配对信息？下次要重新扫码。")) return;
    clearCredentials(localStorage);
    location.replace(location.pathname);
  };

  // 口令错 / 设备被拒：不再显示一个连不上的会话壳，直接回配对页
  if (s.link.phase === "rejected" || s.link.phase === "denied") {
    return (
      <PairScreen
        error={s.link.phase === "rejected" ? "口令无效，请重新配对。" : "这台设备被拒绝接入，请重新配对。"}
      />
    );
  }

  return (
    <div className="app">
      <header className={`hdr link-${s.link.phase}`}>
        <div className="hdr-row">
          <div className="proj">
            <span className="proj-name">{s.project || "会话"}</span>
            <span className="proj-sub">手机 · 控制端</span>
          </div>
          <div className="conn">
            <span className="dot" />
            <span className="conn-text">{linkText(s)}</span>
          </div>
          <button className="hdr-menu" type="button" aria-label="更多" onClick={() => setSheet("menu")}>
            ⋯
          </button>
        </div>
        <div className="rail">
          <span className={`chip exec-${s.exec.phase}`}>{execText(s)}</span>
          <span className={`chip appr-${pending > 0 ? "on" : "off"}`}>{pending > 0 ? `待批 ${pending}` : "无待批"}</span>
          <span className={`chip dev-${s.device.phase}`}>{deviceText(s)}</span>
          <span className={`chip prof-${s.profile}`}>权限：{PROFILE_TEXT[s.profile]}</span>
        </div>
      </header>

      <main
        className="feed"
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          // 只认"真的在底部"：24px 内。否则轻微上滑会被当成贴底又拽回去。
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        <Timeline state={s} now={now} />
      </main>

      <button className="dock" type="button" onClick={() => result && setSheet("artifacts")} disabled={!result}>
        <span className="dock-label">本轮产出</span>
        {result ? (
          <span className="dock-value">
            新增 {result.added.length} · 改动 {result.changed.length} · 删除 {result.removed.length}
            {result.warnings.length > 0 && <span className="dock-warn"> · {result.warnings.length} 条提醒</span>}
          </span>
        ) : (
          <span className="dock-empty">还没有产出</span>
        )}
        <span className="dock-arrow">›</span>
      </button>

      <Composer
        canSend={canSend(s)}
        canStop={canStop(s)}
        hint={hintText(s, now)}
        onSend={(text) => {
          const ok = send({ type: "prompt", text });
          if (ok) {
            // 先本地画出来，别等服务端回显；回显只做确认
            store.dispatch({ type: "localUser", text, at: Date.now() });
            stick.current = true;
          }
          return ok;
        }}
        onStop={() => send({ type: "stop" })}
      />

      <ScreenMini ready={linkReady(s)} />

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
      {sheet === "menu" && (
        <MenuSheet
          onRepo={() => setSheet("repo")}
          onSessions={openSessions}
          onRules={openRules}
          onProfile={() => setSheet("profile")}
          onForget={forget}
          onClose={() => setSheet(null)}
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
      {sheet === "profile" && (
        <ProfileSheet profile={s.profile} onPick={pickProfile} onClose={() => setSheet(null)} />
      )}
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
          request={s.device.incoming[0]}
          onDecide={(allow) => {
            const req = s.device.incoming[0];
            const sent = send({ type: "device_decision", deviceId: req.deviceId, allow });
            if (sent) store.dispatch({ type: "device-decided", deviceId: req.deviceId });
          }}
        />
      )}
    </div>
  );
}
