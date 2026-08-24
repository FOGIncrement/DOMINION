import { useEffect, useState } from "react";

export const THEME_IDS = ["terminal", "ledger", "console"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_LABELS: Record<ThemeId, string> = {
  terminal: "Ledger Terminal",
  ledger: "Frontier Ledger",
  console: "Modern Console",
};

const STORAGE_KEY = "dominion-theme";
const DEFAULT_THEME: ThemeId = "terminal";

function isThemeId(value: string | null): value is ThemeId {
  return value !== null && (THEME_IDS as readonly string[]).includes(value);
}

export function getStoredTheme(): ThemeId {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  return isThemeId(stored) ? stored : DEFAULT_THEME;
}

// Applied synchronously at module load (see main.tsx) so the correct theme
// is on <html> before first paint — no flash of the default theme for
// players who picked something else.
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function useTheme(): [ThemeId, (theme: ThemeId) => void] {
  const [theme, setThemeState] = useState<ThemeId>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return [theme, setThemeState];
}
