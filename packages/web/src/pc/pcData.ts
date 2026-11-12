import { useCallback, useEffect, useMemo, useState } from "react";
import { isPcDemo } from "./pcMode";

export type PcView = "setup" | "home" | "software" | "devices" | "settings";
export type PcMode = "remote" | "agent";
export type PcAppStatus = "running" | "installed" | "missing" | "unknown";
export type PcAppAction = "attach" | "install" | "open" | "detect";

export interface PcAppInfo {
  id: string;
  name: string;
  initial: string;
  tone: "blue" | "green" | "violet" | "cyan";
  status: PcAppStatus;
  note: string;
  action: PcAppAction;
}

export interface PcRecent {
  id: string;
  title: string;
  note: string;
  kind: string;
  at: string;
}

export interface PcPair {
  url: string;
  qr: string;
  mode: "lan" | "localhost" | string;
  expires_at: number | null;
}

export interface PcStatus {
  host: { name: string; project: string; port: number; version: string };
  devices: number;
  trusted: number;
  pending: { approvals: number; plans: number; artifacts: number };
  artifacts: Array<{ id: string; path: string; status: string; at: number }>;
  session: { id: string; title: string; status: string } | null;
  profile: string;
}

export interface PcSnapshot {
  demo: boolean;
  hostOnline: boolean;
  hostLabel: string;
  port: string;
  devicesOnline: number;
  trusted: number;
  phone: { name: string; connected: boolean; lastSeen: string } | null;
  apps: PcAppInfo[];
  recent: PcRecent[];
  pending: number | null;
  version: string;
  pair: PcPair | null;
  status: PcStatus | null;
  error: string | null;
  localOnly: boolean;
}

const DEMO_APPS: PcAppInfo[] = [
  { id: "doubao", name: "豆包", initial: "豆", tone: "blue", status: "running", note: "桌面版 · 主对话", action: "attach" },
  { id: "deepseek", name: "DeepSeek", initial: "D", tone: "green", status: "missing", note: "未安装 · 可用网页版", action: "install" },
  { id: "cursor", name: "Cursor", initial: "C", tone: "violet", status: "installed", note: "桌面版 · 已安装", action: "attach" },
  { id: "edge", name: "Microsoft Edge", initial: "E", tone: "cyan", status: "running", note: "浏览器 · 网页版 AI", action: "open" },
];

const BASE_APPS: PcAppInfo[] = DEMO_APPS.map((app) => ({
  ...app,
  status: "unknown",
  note: "待检测 · 接入后显示窗口",
  action: "detect",
}));

const DEMO_RECENT: PcRecent[] = [
  { id: "r1", title: "豆包回答 · 截图", note: "远程留存 · 豆包", kind: "PNG", at: "2 分钟前" },
  { id: "r2", title: "plan-e2e.txt", note: "本轮 · 已验收", kind: "TXT", at: "12 分钟前" },
];

function ago(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function recentFrom(status: PcStatus | null): PcRecent[] {
  if (!status) return [];
  return status.artifacts.map((r) => {
    const name = r.path.split(/[\\/]/).pop() ?? r.path;
    const parent = r.path.replace(/[\\/][^\\/]+$/, "").split(/[\\/]/).pop() ?? "本机";
    const ext = name.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE";
    return {
      id: r.id,
      title: name,
      note: `${r.status === "pending" ? "待验收" : "已收"} · ${parent || "本机"}`,
      kind: ext,
      at: ago(r.at),
    };
  });
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export function usePcSnapshot(): { snapshot: PcSnapshot; refresh: () => void } {
  const demo = useMemo(() => isPcDemo(window.location, import.meta.env.DEV), []);
  const [hostOnline, setHostOnline] = useState(demo);
  const [devices, setDevices] = useState(demo ? 1 : 0);
  const [apps, setApps] = useState<PcAppInfo[] | null>(null);
  const [status, setStatus] = useState<PcStatus | null>(null);
  const [pair, setPair] = useState<PcPair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (demo) {
      setHostOnline(true);
      setDevices(1);
      setApps(DEMO_APPS);
      setStatus(null);
      setPair(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const [h, s, a] = await Promise.allSettled([
        getJson<{ ok?: boolean; devices?: number }>("/health"),
        getJson<PcStatus>("/pc/status"),
        getJson<{ apps: PcAppInfo[] }>("/pc/apps"),
      ]);
      if (cancelled) return;
      if (h.status === "fulfilled") {
        setHostOnline(Boolean(h.value.ok));
        setDevices(Number(h.value.devices ?? 0));
      } else {
        setHostOnline(false);
      }
      if (s.status === "fulfilled") {
        setStatus(s.value);
        if (h.status !== "fulfilled") setDevices(Number(s.value.devices ?? 0));
      }
      if (a.status === "fulfilled") setApps(a.value.apps);
      const denied = [s, a].some(
        (r) => r.status === "rejected" && r.reason instanceof Error && r.reason.message === "403",
      );
      setError(denied ? "PC 页面需要在本机打开" : null);
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [demo, reload]);

  useEffect(() => {
    if (demo) {
      setPair(null);
      return;
    }
    let cancelled = false;
    getJson<PcPair>("/pc/pair")
      .then((data) => {
        if (!cancelled) {
          setPair(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === "403") setError("PC 页面需要在本机打开");
      });
    return () => {
      cancelled = true;
    };
  }, [demo, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const pending = status
    ? status.pending.approvals + status.pending.plans + status.pending.artifacts
    : demo
      ? 0
      : null;

  return {
    snapshot: {
      demo,
      hostOnline,
      hostLabel: demo ? "DESKTOP-8F2A" : status?.host.name || window.location.hostname || "本机",
      port: demo ? "8787" : String(status?.host.port ?? window.location.port ?? "8787"),
      devicesOnline: devices,
      trusted: demo ? 1 : status?.trusted ?? 0,
      phone:
        devices > 0
          ? {
              name: demo ? "Pixel 8" : "已配对手机",
              connected: true,
              lastSeen: demo ? "2 分钟前活跃" : "在线",
            }
          : null,
      apps: apps ?? (demo ? DEMO_APPS : BASE_APPS),
      recent: demo ? DEMO_RECENT : recentFrom(status),
      pending,
      version: status?.host.version ?? "0.1.0",
      pair,
      status,
      error,
      localOnly: error === null,
    },
    refresh,
  };
}
