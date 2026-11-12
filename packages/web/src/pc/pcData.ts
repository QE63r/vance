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
  kind: "PNG" | "TXT" | "DOC";
  at: string;
}

export interface PcSnapshot {
  demo: boolean;
  hostOnline: boolean;
  hostLabel: string;
  port: string;
  devicesOnline: number;
  phone: { name: string; connected: boolean; lastSeen: string } | null;
  apps: PcAppInfo[];
  recent: PcRecent[];
  pending: number | null;
  version: string;
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

export function usePcSnapshot(): { snapshot: PcSnapshot; refresh: () => void } {
  const demo = useMemo(() => isPcDemo(window.location, import.meta.env.DEV), []);
  const [hostOnline, setHostOnline] = useState(demo);
  const [devices, setDevices] = useState(demo ? 1 : 0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (demo) {
      setHostOnline(true);
      setDevices(1);
      return;
    }
    let cancelled = false;
    fetch("/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { ok?: boolean; devices?: number }) => {
        if (cancelled) return;
        setHostOnline(Boolean(data.ok));
        setDevices(Number(data.devices ?? 0));
      })
      .catch(() => {
        if (!cancelled) {
          setHostOnline(false);
          setDevices(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [demo, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  return {
    snapshot: {
      demo,
      hostOnline,
      hostLabel: demo ? "DESKTOP-8F2A" : window.location.hostname || "本机",
      port: demo ? "8787" : window.location.port || "8787",
      devicesOnline: devices,
      phone:
        devices > 0
          ? { name: demo ? "Pixel 8" : "已配对手机", connected: true, lastSeen: demo ? "2 分钟前活跃" : "在线" }
          : null,
      apps: demo ? DEMO_APPS : BASE_APPS,
      recent: demo ? DEMO_RECENT : [],
      pending: demo ? 0 : null,
      version: "0.1.0",
    },
    refresh,
  };
}
