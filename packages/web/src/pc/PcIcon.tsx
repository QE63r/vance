import type { CSSProperties, ReactNode } from "react";

export type PcIconName =
  | "grid"
  | "app"
  | "device"
  | "settings"
  | "help"
  | "phone"
  | "monitor"
  | "plus"
  | "refresh"
  | "arrow"
  | "lock"
  | "check"
  | "chevron"
  | "close"
  | "sun"
  | "moon"
  | "qr"
  | "play"
  | "spark"
  | "user"
  | "folder"
  | "screen"
  | "keyboard"
  | "clipboard"
  | "minimize"
  | "maximize";

const PATHS: Record<PcIconName, ReactNode> = {
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  app: (
    <>
      <path d="M4 7.5h6l1.6 2H20v9H4z" />
      <path d="M4 7.5V5.8h5l1.5 1.7" />
    </>
  ),
  device: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
      <path d="M11 18.5h2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2-2.5 3.7" />
      <path d="M12 17h.01" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
      <path d="M11 18.5h2" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="1.8" />
      <path d="M8 20h8M12 16.5V20" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8.2 8.2 0 1 0 10.5 10.5z" />,
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 14h3v3h-3zM14 18h2v3h-2zM19 19h2v2h-2z" />
    </>
  ),
  play: <path d="M8 5.5l10 6.5-10 6.5z" />,
  spark: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" opacity=".35" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c.6-3.4 3.1-5 6.5-5s5.9 1.6 6.5 5" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 6.5h6l1.5 2h9.5v10h-17z" />
      <path d="M3.5 6.5V5h5l1.5 1.5" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  minimize: <path d="M2 5h6" />,
  maximize: <rect x="2" y="2" width="6" height="6" rx=".6" />,
};

export function PcIcon({
  name,
  size = 16,
  className,
  style,
}: {
  name: PcIconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
