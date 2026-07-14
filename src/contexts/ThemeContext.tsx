'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getStoredTheme, saveStoredTheme, type ThemeChoice } from '@/shared/lib/localStorage';

type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  /** The user's choice: 'light' | 'dark' | 'system'. */
  theme: ThemeChoice;
  /** The concrete theme currently applied ('system' resolved via the OS). */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The OS preference right now. Safe to call on the server (returns 'light'). */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** Stamp (or remove) the `.dark` class on <html> so the CSS tokens switch. */
function applyResolvedTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to 'system' for SSR / first paint. The anti-FOUC script in layout.tsx
  // has already applied the correct class before React hydrates, so there is no flash.
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Read the stored choice once on mount (localStorage is client-only).
  useEffect(() => {
    setThemeState(getStoredTheme());
  }, []);

  // Resolve the choice to a concrete theme and apply it whenever the choice
  // changes, and keep 'system' live by listening to the OS preference.
  useEffect(() => {
    const resolve = () => {
      const resolved: ResolvedTheme = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
      setResolvedTheme(resolved);
      applyResolvedTheme(resolved);
    };

    resolve();

    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener('change', resolve);
    return () => media.removeEventListener('change', resolve);
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    saveStoredTheme(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
