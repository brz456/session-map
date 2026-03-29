// src/renderer/styles/useTheme.tsx
// Theme context and hook for SessionMap

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';

export type Theme = 'broadcast' | 'synthwave';

export const THEMES: Theme[] = ['broadcast', 'synthwave'];

export const THEME_LABELS: Record<Theme, string> = {
  broadcast: 'Broadcast',
  synthwave: 'Synthwave',
};

const STORAGE_KEY = 'sessionmap-theme';
const DEFAULT_THEME: Theme = 'broadcast';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && THEMES.includes(stored as Theme)) {
    return stored as Theme;
  }
  return DEFAULT_THEME;
}

function storeTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredTheme();
    // Apply immediately to prevent flash
    applyTheme(stored);
    return stored;
  });

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    storeTheme(newTheme);
    applyTheme(newTheme);
  }, []);

  const value: ThemeContextValue = {
    theme,
    setTheme,
    themes: THEMES,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Standalone component for theme switching
export function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className={`theme-switcher ${open ? 'theme-switcher--open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="theme-switcher__trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change theme"
      >
        <span className="theme-switcher__label">Theme</span>
        <span className="theme-switcher__value">{THEME_LABELS[theme]}</span>
        <span className="theme-switcher__caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="theme-switcher__menu" role="menu" aria-label="Theme options">
          {themes.map((t) => (
            <button
              type="button"
              key={t}
              role="menuitemradio"
              aria-checked={theme === t}
              className={`theme-switcher__option ${theme === t ? 'theme-switcher__option--active' : ''}`}
              onClick={() => {
                setTheme(t);
                setOpen(false);
              }}
              title={THEME_LABELS[t]}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
