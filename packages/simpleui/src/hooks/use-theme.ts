import { useCallback, useEffect, useState } from 'react';

/**
 * Theme key — kept module-local so callers cannot construct it by hand and
 * accidentally desync from `useTheme`. Mirrors the legacy constant that lived
 * in `app.tsx` before PR-1; any new consumer must use this hook instead.
 */
const THEME_STORAGE_KEY = 'wrongstack.simpleui.theme';

export type Theme = 'dark' | 'light';

/**
 * Resolve the initial theme without throwing in privacy-restricted browsers
 * (Safari private mode throws on `localStorage` access).
 *
 * Precedence (matches pre-PR-1 `app.tsx` semantics exactly):
 *  1. previously saved value in localStorage
 *  2. the OS `prefers-color-scheme: light` media query
 *  3. `'dark'` (the project default)
 */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export interface UseThemeResult {
  theme: Theme;
  /** Replace the current theme. Also persists to localStorage and the DOM. */
  setTheme: (theme: Theme) => void;
  /** Convenience: flip between dark and light. */
  toggleTheme: () => void;
}

/**
 * Owns the dark/light theme lifecycle: initial resolution, DOM side-effects
 * (`data-theme` + `color-scheme`), and persistence to `localStorage`.
 *
 * Behavioural contract (must survive the PR-1 extraction from `app.tsx`):
 *  - Privacy-restricted browsers (localStorage throws) never crash; they fall
 *    back to `'dark'` and skip persistence.
 *  - The DOM attributes are kept in sync on every change, not only on mount.
 *  - Persistence is best-effort: a thrown `setItem` is swallowed so the UI
 *    keeps working even when storage is full or blocked.
 */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is best-effort in privacy-restricted browsers.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggleTheme };
}
