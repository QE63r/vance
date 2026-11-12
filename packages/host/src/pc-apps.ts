import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

interface AppDef {
  id: string;
  name: string;
  initial: string;
  tone: PcAppInfo["tone"];
  processes: string[];
  paths: string[];
}

function envPath(name: string): string {
  return process.env[name] ?? "";
}

function pathsFor(def: AppDef): string[] {
  const local = envPath("LOCALAPPDATA");
  const pf = envPath("ProgramFiles");
  const pf86 = envPath("ProgramFiles(x86)");
  const roots = [local, pf, pf86].filter(Boolean);
  return def.paths.flatMap((p) => {
    if (p.startsWith("%LOCALAPPDATA%")) return local ? [join(local, p.slice("%LOCALAPPDATA%".length + 1))] : [];
    if (p.startsWith("%PROGRAMFILES(X86)%")) return pf86 ? [join(pf86, p.slice("%PROGRAMFILES(X86)%".length + 1))] : [];
    if (p.startsWith("%PROGRAMFILES%")) return pf ? [join(pf, p.slice("%PROGRAMFILES%".length + 1))] : [];
    return roots.map((root) => join(root, p));
  });
}

const DEFS: AppDef[] = [
  {
    id: "doubao",
    name: "豆包",
    initial: "豆",
    tone: "blue",
    processes: ["doubao"],
    paths: ["Doubao", "Programs/Doubao"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    initial: "D",
    tone: "green",
    processes: ["deepseek"],
    paths: ["DeepSeek", "Programs/DeepSeek"],
  },
  {
    id: "cursor",
    name: "Cursor",
    initial: "C",
    tone: "violet",
    processes: ["cursor"],
    paths: ["Programs/cursor", "Programs/Cursor", "Cursor"],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    initial: "E",
    tone: "cyan",
    processes: ["msedge"],
    paths: ["Microsoft/Edge/Application/msedge.exe"],
  },
];

async function runningProcesses(): Promise<Set<string> | null> {
  if (process.platform !== "win32") return null;
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const tasklist = join(systemRoot, "System32", "tasklist.exe");
  const exe = existsSync(tasklist) ? tasklist : "tasklist";
  try {
    const { stdout } = await execFileAsync(exe, ["/FO", "CSV", "/NH"], {
      timeout: 3000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    const names = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^"([^"]+)"/.exec(line);
      if (m?.[1]) names.add(m[1].replace(/\.exe$/i, "").toLowerCase());
    }
    return names;
  } catch {
    return null;
  }
}

function installed(def: AppDef): boolean {
  return pathsFor(def).some((path) => existsSync(path));
}

/** 只读进程/安装路径，不启动、不读窗口内容、不做 UI 自动化。 */
export async function detectPcApps(): Promise<PcAppInfo[]> {
  const running = await runningProcesses();
  return DEFS.map((def) => {
    const isRunning = Boolean(running && def.processes.some((p) => running.has(p)));
    const isInstalled = installed(def);
    let status: PcAppStatus;
    let note: string;
    if (isRunning) {
      status = "running";
      note = def.id === "edge" ? "浏览器 · 网页版 AI" : "桌面版 · 运行中";
    } else if (isInstalled) {
      status = "installed";
      note = def.id === "edge" ? "浏览器 · 已安装" : "桌面版 · 已安装";
    } else if (running === null) {
      status = "unknown";
      note = "待检测 · 接入后显示窗口";
    } else {
      status = "missing";
      note = def.id === "deepseek" ? "未安装 · 可用网页版" : "未安装";
    }
    return {
      id: def.id,
      name: def.name,
      initial: def.initial,
      tone: def.tone,
      status,
      note,
      action: status === "running" || status === "installed" ? "attach" : status === "missing" ? "install" : "detect",
    };
  });
}
