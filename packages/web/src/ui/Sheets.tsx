import type { ArtifactsPayload, DeviceRequest } from "../model/types";

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

export function ArtifactsSheet({ data, onClose }: { data: ArtifactsPayload; onClose: () => void }) {
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
              <div className="file" key={p} title={p}>
                {shortPath(p)}
              </div>
            ))}
          </div>
        ),
      )}
      <div className="sheet-note">手机上打不开这些文件；要看得去电脑上。</div>
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
  onSessions,
  onRules,
  onClose,
}: {
  onSessions: () => void;
  onRules: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="更多" onClose={onClose}>
      <button className="menu-row" type="button" onClick={onSessions}>
        <span>任务列表</span>
        <span className="menu-arrow">›</span>
      </button>
      <button className="menu-row" type="button" onClick={onRules}>
        <span>记住的规则</span>
        <span className="menu-arrow">›</span>
      </button>
      <div className="sheet-note">切任务只改"看哪条"，不会停掉正在跑的那条。</div>
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
