import { useEffect, useState } from "react";
import type { ArtifactsPayload } from "../model/types";
import { getToken } from "../net/ws";
import type { Theme } from "./theme";
import { PageHeader } from "./Chrome";

interface RecentArtifact {
  id: string;
  path: string;
  session_id: string;
  status: "pending" | "accepted" | "rejected";
  at: number;
  size: number;
  exists: boolean;
}

const STATUS_LABEL: Record<RecentArtifact["status"], string> = {
  pending: "待验收",
  accepted: "已收",
  rejected: "已打回",
};

const STATUS_CLASS: Record<RecentArtifact["status"], string> = {
  pending: "warn",
  accepted: "ok",
  rejected: "bad",
};

function shortName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("\\");
}

function ago(at: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

export function ArtifactsPage({
  artifacts,
  theme,
  onToggleTheme,
  onDrawer,
  onOpenRepo,
  onOpen,
}: {
  artifacts: ArtifactsPayload | null;
  theme: Theme;
  onToggleTheme: () => void;
  onDrawer: () => void;
  onOpenRepo: () => void;
  onOpen: (path: string, sessionId?: string) => void;
}) {
  const [recent, setRecent] = useState<RecentArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/artifacts?limit=50", { headers: { "x-vance-token": getToken() } })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { artifacts?: RecentArtifact[] };
      })
      .then((data) => {
        if (alive) setRecent(data.artifacts ?? []);
      })
      .catch(() => {
        if (alive) setError("取不到交付物列表");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const groups: Array<[string, string[]]> = artifacts
    ? [
        ["新增", artifacts.added],
        ["改动", artifacts.changed],
        ["删除", artifacts.removed],
      ]
    : [];
  const total = artifacts ? artifacts.added.length + artifacts.changed.length + artifacts.removed.length : 0;

  return (
    <div className="page">
      <PageHeader eyebrow="ARTIFACTS" title="交付物" theme={theme} onToggleTheme={onToggleTheme} onDrawer={onDrawer} />

      <div className="artifact-summary">
        <span>
          本轮产出 <b>{total}</b> · 最近 {recent.length}
        </span>
        <button className="link-btn" type="button" onClick={onOpenRepo}>
          交付物仓库 ›
        </button>
      </div>

      {error && <div className="preview-error">{error}</div>}

      {loading && <div className="card page-empty">取交付物中…</div>}

      {!loading && recent.length === 0 && (!artifacts || total === 0) && (
        <div className="card page-empty">
          还没有交付物。
          <br />
          等 Agent 写文件、生成文档后，这里会出现原件；点一下就能预览和验收。
        </div>
      )}

      {!loading && recent.length > 0 && (
        <div className="card artifact-groups">
          {recent.map((item) => (
            <button className="file-row" key={item.id} type="button" onClick={() => onOpen(item.path, item.session_id)}>
              <span className="file-icon">{shortName(item.path).split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}</span>
              <span className="file-main">
                <b>{shortName(item.path)}</b>
                <small title={item.path}>
                  {shortPath(item.path)} · {ago(item.at)}
                  {!item.exists ? " · 文件不在了" : ""}
                </small>
              </span>
              <span className={`pill ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span>
            </button>
          ))}
        </div>
      )}

      {!loading && recent.length === 0 && artifacts && total > 0 && (
        <div className="card artifact-groups">
          {artifacts.warnings.map((w) => (
            <div className="artifact-warn" key={w}>
              ⚠ {w}
            </div>
          ))}
          {groups.map(([label, list]) =>
            list.length === 0 ? null : (
              <div className="artifact-group" key={label}>
                <div className="artifact-label">
                  {label} {list.length}
                </div>
                {list.map((path) => (
                  <button className="file-row" key={path} type="button" onClick={() => onOpen(path)}>
                    <span className="file-icon">{shortName(path).split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}</span>
                    <span className="file-main">
                      <b>{shortName(path)}</b>
                      <small title={path}>{shortPath(path)}</small>
                    </span>
                    <span className={`pill ${label === "删除" ? "quiet" : "warn"}`}>{label === "删除" ? "已删" : "本轮"}</span>
                  </button>
                ))}
              </div>
            ),
          )}
        </div>
      )}

      <div className="page-note">
        点文件名直接看原件、确认或打回；验收绑定文件 sha256。
        <br />
        “交付物仓库”看全部记录和筛选。
      </div>
    </div>
  );
}
