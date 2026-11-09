import { useEffect, useState } from "react";
import type { ArtifactsPayload, DeviceRequest, Profile } from "../model/types";
import { getToken } from "../net/ws";

function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <span>{title}</span>
          <button type="button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("\\");
}

export function ArtifactsSheet({
  data,
  onOpen,
  onClose,
}: {
  data: ArtifactsPayload;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const groups: Array<[string, string[]]> = [
    ["新增", data.added],
    ["改动", data.changed],
    ["删除", data.removed],
  ];
  return (
    <Sheet title="本轮产出" onClose={onClose}>
      {data.warnings.length > 0 && (
        <div className="warnings">
          {data.warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}
      {data.added.length + data.changed.length + data.removed.length === 0 && <div className="sheet-empty">这一轮没有动文件</div>}
      {groups.map(([label, list]) =>
        list.length === 0 ? null : (
          <div className="group" key={label}>
            <div className="group-title">
              {label} {list.length}
            </div>
            {list.map((p) => (
              <button className="file" key={p} type="button" title={p} onClick={() => onOpen(p)}>
                {shortPath(p)}
              </button>
            ))}
          </div>
        ),
      )}
      <div className="sheet-note">点文件看原件；看完确认交付，或打回重做。</div>
    </Sheet>
  );
}

interface RepoArtifact {
  id: string;
  path: string;
  session_id: string;
  turn_id: string;
  sha256: string;
  size: number;
  content_type: string;
  at: number;
  status: "pending" | "accepted" | "rejected";
  note?: string;
  exists: boolean;
  changed: boolean;
}

const REPO_FILTERS: Array<["all" | "pending" | "accepted" | "rejected", string]> = [
  ["all", "全部"],
  ["pending", "待验收"],
  ["accepted", "已收"],
  ["rejected", "已打回"],
];

const REPO_STATUS: Record<RepoArtifact["status"], string> = {
  pending: "待验收",
  accepted: "已收",
  rejected: "已打回",
};

function repoTime(at: number): string {
  try {
    return new Date(at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ArtifactRepoSheet({
  onOpen,
  onClose,
}: {
  onOpen: (path: string, sessionId: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "rejected">("all");
  const [items, setItems] = useState<RepoArtifact[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`/artifacts?status=${filter}&limit=100`, {
      headers: { "x-vance-token": getToken() },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { artifacts?: RepoArtifact[] };
      })
      .then((data) => {
        if (alive) setItems(data.artifacts ?? []);
      })
      .catch(() => {
        if (alive) {
          setItems([]);
          setError("取不到交付物仓库，请重试");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filter]);

  return (
    <Sheet title="交付物仓库" onClose={onClose}>
      <div className="repo-filters">
        {REPO_FILTERS.map(([value, label]) => (
          <button
            key={value}
            className={`repo-filter${filter === value ? " on" : ""}`}
            type="button"
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <div className="preview-error">{error}</div>}
      {loading && <div className="sheet-empty">取仓库中…</div>}
      {!loading && !error && items.length === 0 && (
        <div className="sheet-empty">还没有交付物。等 Agent 产出后，这里会留下记录。</div>
      )}
      {!loading &&
        items.map((a) => (
          <button
            key={a.id}
            className="repo-row"
            type="button"
            disabled={!a.exists}
            title={a.path}
            onClick={() => a.exists && onOpen(a.path, a.session_id)}
          >
            <span className="repo-main">
              <span className="repo-name">{shortPath(a.path)}</span>
              <span className="repo-meta">
                {a.session_id} · {repoTime(a.at)} · {Math.max(1, Math.round(a.size / 1024))} KB
                {!a.exists && " · 文件已不在"}
                {a.exists && a.changed && " · 文件已变化"}
              </span>
            </span>
            <span className={`repo-status ${a.status}`}>{REPO_STATUS[a.status]}</span>
          </button>
        ))}
      <div className="sheet-note">
        验收状态跟原件的 sha256 绑定；文件被删/改会标出来。点一条看原件，确认或打回。
      </div>
    </Sheet>
  );
}

export function DeviceSheet({ request, onDecide }: { request: DeviceRequest; onDecide: (allow: boolean) => void }) {
  return (
    <Sheet title="有新设备请求接入" onClose={() => onDecide(false)}>
      <div className="device-name">{request.name}</div>
      <div className="device-ip">{request.ip}</div>
      <div className="device-actions">
        <button className="btn deny" type="button" onClick={() => onDecide(false)}>
          拒绝
        </button>
        <button className="btn allow" type="button" onClick={() => onDecide(true)}>
          允许
        </button>
      </div>
    </Sheet>
  );
}

export interface SessionRow {
  id: string;
  title: string;
  active: boolean;
}

export function MenuSheet({
  onRepo,
  onSessions,
  onRules,
  onProfile,
  onForget,
  onClose,
}: {
  onRepo: () => void;
  onSessions: () => void;
  onRules: () => void;
  onProfile: () => void;
  onForget: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="更多" onClose={onClose}>
      <button className="menu-row" type="button" onClick={onRepo}>
        <span>交付物仓库</span>
        <span className="menu-arrow">›</span>
      </button>
      <button className="menu-row" type="button" onClick={onSessions}>
        <span>任务列表</span>
        <span className="menu-arrow">›</span>
      </button>
      <button className="menu-row" type="button" onClick={onRules}>
        <span>记住的规则</span>
        <span className="menu-arrow">›</span>
      </button>
      <button className="menu-row" type="button" onClick={onProfile}>
        <span>权限档位</span>
        <span className="menu-arrow">›</span>
      </button>
      <button className="menu-row danger" type="button" onClick={onForget}>
        <span>忘记这台设备</span>
        <span className="menu-arrow">›</span>
      </button>
      <div className="sheet-note">
        切任务只改"看哪条"，不会停掉正在跑的那条。
        <br />
        “忘记这台设备”只清这台手机的本地配对信息，电脑上的记录不会删。
      </div>
    </Sheet>
  );
}

const PROFILE_ROWS: Array<[Profile, string, string]> = [
  ["read-only", "只读", "只看不写：任何改动都要问"],
  ["workspace", "工作区（默认）", "桌面、sandbox 内的写和脚本直接放行"],
  ["full", "完全权限", "当前任务内除硬禁止外全部放行"],
];

export function ProfileSheet({
  profile,
  onPick,
  onClose,
}: {
  profile: Profile;
  onPick: (profile: Profile) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="权限档位" onClose={onClose}>
      {PROFILE_ROWS.map(([value, name, desc]) => (
        <button
          key={value}
          className={`profile-row${value === profile ? " current" : ""}`}
          type="button"
          onClick={() => onPick(value)}
        >
          <span className="profile-name">{name}</span>
          <span className="profile-desc">{desc}</span>
        </button>
      ))}
      <div className="sheet-note">
        硬禁止（系统目录、凭据、磁盘级操作）任何档位都不放；完全权限只对当前任务有效。
      </div>
    </Sheet>
  );
}

export function SessionsSheet({
  sessions,
  currentId,
  onPick,
  onClose,
}: {
  sessions: SessionRow[];
  currentId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="任务" onClose={onClose}>
      {sessions.length === 0 && <div className="sheet-empty">还没有任务</div>}
      {sessions.map((s) => (
        <button
          key={s.id}
          className={`session-row${s.id === currentId ? " current" : ""}`}
          type="button"
          onClick={() => onPick(s.id)}
        >
          <span className="session-title">{s.title || s.id}</span>
          <span className="session-meta">
            {s.active ? "当前会话" : "历史"}
            {s.id === currentId ? " · 正在看" : ""}
          </span>
        </button>
      ))}
      <div className="sheet-note">旧账（legacy）是加 session_id 之前的记录，只读。</div>
    </Sheet>
  );
}

const RULE_KIND: Record<string, string> = {
  execute: "运行命令",
  edit: "改文件",
  read: "读取",
  fetch: "联网",
  unknown: "操作",
};

/** 规则 key 是 `kind:动作`；给手机看时换成"运行命令：…"，太长的截断 */
function prettyRule(key: string): string {
  const i = key.indexOf(":");
  if (i <= 0) return key.length > 60 ? `${key.slice(0, 60)}…` : key;
  const kind = key.slice(0, i);
  const rest = key.slice(i + 1).trim().replace(/\s+/g, " ");
  const short = rest.length > 46 ? `${rest.slice(0, 46)}…` : rest;
  return `${RULE_KIND[kind] ?? kind}：${short}`;
}

export function RulesSheet({
  rules,
  onRevoke,
  onClose,
}: {
  rules: string[];
  onRevoke: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="记住的规则" onClose={onClose}>
      {rules.length === 0 && <div className="sheet-empty">还没有记住的规则</div>}
      {rules.map((key) => (
        <div className="rule-row" key={key}>
          <span className="rule-text" title={key}>
            {prettyRule(key)}
          </span>
          <button className="btn deny" type="button" onClick={() => onRevoke(key)}>
            撤销
          </button>
        </div>
      ))}
      <div className="sheet-note">撤销后，同类操作下次会重新问你。</div>
    </Sheet>
  );
}
