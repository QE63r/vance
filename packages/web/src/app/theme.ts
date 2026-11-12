/** 白天/夜晚主题：默认跟随系统，手动选择记在这台手机。 */
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "vance_theme";

export function loadTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* 隐私模式读不到就用默认 */
  }
  return "system";
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* 存不住不影响本次 */
  }
}

export function prefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  } catch {
    return true;
  }
}

export function resolveTheme(choice: ThemeChoice, dark: boolean): Theme {
  if (choice === "system") return dark ? "dark" : "light";
  return choice;
}

/** 写到 html[data-theme]，CSS 只认这一个开关；同时更新浏览器状态栏颜色 */
export function applyTheme(choice: ThemeChoice): Theme {
  const theme = resolveTheme(choice, prefersDark());
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0f1217" : "#fbfdfb");
  return theme;
}

export function useTheme(): {
  choice: ThemeChoice;
  theme: Theme;
  setChoice: (choice: ThemeChoice) => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => loadTheme());
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(loadTheme(), prefersDark()));

  useEffect(() => {
    const sync = () => setTheme(applyTheme(choice));
    sync();
    if (choice !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq?.addEventListener) return;
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [choice]);

  const setChoice = (next: ThemeChoice) => {
    saveTheme(next);
    setChoiceState(next);
  };

  return { choice, theme, setChoice };
}
