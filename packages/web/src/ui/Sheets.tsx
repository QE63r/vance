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
