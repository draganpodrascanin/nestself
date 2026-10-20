import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_THEME,
  palettes,
  modes,
  fonts,
} from '@nestself/tokens';
import type { Palette, Mode, FontId, ThemeSelection } from '@nestself/tokens';
import { applyTheme, persistTheme, loadPersistedTheme } from '@nestself/tokens/theme';

interface ThemeContextValue {
  theme: ThemeSelection;
  setPalette: (palette: Palette) => void;
  setMode: (mode: Mode) => void;
  setFont: (font: FontId) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  initial?: Partial<ThemeSelection>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  children: ReactNode;
}

export function ThemeProvider({ initial, storage, children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<ThemeSelection>(() => {
    const persisted = loadPersistedTheme(storage ?? (typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null }));
    return {
      palette: initial?.palette ?? persisted?.palette ?? DEFAULT_THEME.palette,
      mode: initial?.mode ?? persisted?.mode ?? DEFAULT_THEME.mode,
      font: initial?.font ?? persisted?.font ?? DEFAULT_THEME.font,
    };
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (storage) {
      persistTheme(theme, storage);
    } else if (typeof localStorage !== 'undefined') {
      persistTheme(theme);
    }
  }, [theme, storage]);

  const setPalette = useCallback((palette: Palette) => {
    setTheme((prev) => ({ ...prev, palette }));
  }, []);

  const setMode = useCallback((mode: Mode) => {
    setTheme((prev) => ({ ...prev, mode }));
  }, []);

  const setFont = useCallback((font: FontId) => {
    setTheme((prev) => ({ ...prev, font }));
  }, []);

  const toggleMode = useCallback(() => {
    setTheme((prev) => ({
      ...prev,
      mode: prev.mode === 'light' ? 'dark' : 'light',
    }));
  }, []);

  const value = useMemo(
    () => ({ theme, setPalette, setMode, setFont, toggleMode }),
    [theme, setPalette, setMode, setFont, toggleMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export interface ThemeStudioProps {
  enabled: boolean;
  labels?: {
    palette?: string;
    mode?: string;
    font?: string;
    heading?: string;
  };
}

/**
 * Dev-only floating panel for switching palette, mode and font.
 *
 * Renders nothing when:
 * - `enabled` is `false`, or
 * - the page is driven by an automated browser (`navigator.webdriver === true`,
 *   e.g. Playwright), so screenshots and accessibility audits are not polluted
 *   by dev chrome.
 */
export function ThemeStudio({ enabled, labels }: ThemeStudioProps) {
  const { theme, setPalette, setMode, setFont } = useTheme();

  if (!enabled) return null;
  if (typeof navigator !== 'undefined' && navigator.webdriver === true) return null;

  return (
    <details
      className="fixed bottom-4 right-4 z-[var(--z-sticky)] rounded-control bg-surface p-4 shadow-menu border border-border-control"
    >
      <summary className="cursor-pointer type-label">
        Theme Studio
      </summary>
      <h2 className="sr-only">{labels?.heading ?? 'Theme Studio'}</h2>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 type-metadata">
          {labels?.palette ?? 'Palette'}
          <select
            value={theme.palette}
            onChange={(e) => setPalette(e.target.value as Palette)}
            className="rounded-control border border-border-control bg-surface px-2 py-1"
          >
            {palettes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 type-metadata">
          {labels?.mode ?? 'Mode'}
          <select
            value={theme.mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="rounded-control border border-border-control bg-surface px-2 py-1"
          >
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 type-metadata">
          {labels?.font ?? 'Font'}
          <select
            value={theme.font}
            onChange={(e) => setFont(e.target.value as FontId)}
            className="rounded-control border border-border-control bg-surface px-2 py-1"
          >
            {fonts.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}
