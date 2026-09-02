"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const COOKIE = "keel-theme";
const ONE_YEAR = 31_536_000;

/** Reflect a theme choice into the DOM + cookie. Never touches matchMedia. */
function commitTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") {
    delete root.dataset.theme;
    document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
    return;
  }
  root.dataset.theme = t;
  document.cookie = `${COOKIE}=${t}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start from a server-stable value; reconcile with the cookie after mount so
  // hydration never mismatches. The pre-paint script in layout.tsx is what
  // avoids the visual flash; this keeps React state in sync with it.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const match = document.cookie.match(
      /(?:^|;\s*)keel-theme=(light|dark|system)/,
    );
    const persisted = match?.[1] as Theme | undefined;
    // No cookie: state defaults to "light" but the DOM is left untouched so the
    // `@media (prefers-color-scheme: dark)` rule in tokens.css still decides —
    // matches the prototype, which only sets data-theme for an explicit choice.
    setThemeState(persisted ?? "light");
    if (persisted === "light" || persisted === "dark") {
      document.documentElement.dataset.theme = persisted;
    } else if (persisted === "system") {
      delete document.documentElement.dataset.theme;
    }
  }, []);

  const setTheme = useCallback((t: Theme) => {
    commitTheme(t);
    setThemeState(t);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(NEXT_THEME[theme])}
    >
      Theme: {theme}
    </button>
  );
}
