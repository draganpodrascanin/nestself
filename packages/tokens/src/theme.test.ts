// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { applyTheme, readTheme, persistTheme, loadPersistedTheme, themeBootScript, THEME_STORAGE_KEY, resolveInitialTheme } from './theme';
import { DEFAULT_THEME } from './index';
import type { ThemeSelection } from './index';

beforeEach(() => {
  // Reset attributes
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.removeAttribute('data-mode');
  document.documentElement.removeAttribute('data-font');
  localStorage.clear();
});

describe('applyTheme / readTheme round-trip', () => {
  it('applies and reads back a custom selection', () => {
    const sel: ThemeSelection = { palette: 'plum', mode: 'dark', font: 'fira' };
    applyTheme(sel);
    const result = readTheme();
    expect(result).toEqual(sel);
  });

  it('applies default theme correctly', () => {
    applyTheme(DEFAULT_THEME);
    expect(readTheme()).toEqual(DEFAULT_THEME);
  });
});

describe('readTheme fallback', () => {
  it('falls back to DEFAULT_THEME when no attributes are set', () => {
    expect(readTheme()).toEqual(DEFAULT_THEME);
  });

  it('falls back for invalid palette', () => {
    document.documentElement.setAttribute('data-palette', 'nope');
    document.documentElement.setAttribute('data-mode', 'dark');
    document.documentElement.setAttribute('data-font', 'lato');
    const result = readTheme();
    expect(result.palette).toBe(DEFAULT_THEME.palette);
    expect(result.mode).toBe('dark');
    expect(result.font).toBe('lato');
  });
});

describe('persistTheme / loadPersistedTheme', () => {
  it('round-trips a valid selection', () => {
    const sel: ThemeSelection = { palette: 'azure', mode: 'dark', font: 'commissioner' };
    persistTheme(sel);
    expect(loadPersistedTheme()).toEqual(sel);
  });

  it('returns null for invalid stored JSON', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '{"palette":"invalid"}');
    expect(loadPersistedTheme()).toBeNull();
  });

  it('returns null for garbage string', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'not json');
    expect(loadPersistedTheme()).toBeNull();
  });

  it('returns null when storage is empty', () => {
    expect(loadPersistedTheme()).toBeNull();
  });

  it('handles blocked storage without throwing', () => {
    const blockedStorage = {
      setItem() { throw new DOMException('blocked'); },
      getItem() { throw new DOMException('blocked'); },
    };
    // Should not throw
    persistTheme(DEFAULT_THEME, blockedStorage);
    expect(loadPersistedTheme(blockedStorage)).toBeNull();
  });
});

describe('resolveInitialTheme', () => {
  it('returns persisted theme when one exists', () => {
    const sel: ThemeSelection = { palette: 'ink', mode: 'dark', font: 'nunito' };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(sel));
    expect(resolveInitialTheme({ storage: localStorage, win: { matchMedia: () => ({ matches: false }) } })).toEqual(sel);
  });

  it('returns default when nothing is persisted and followSystem is false', () => {
    expect(resolveInitialTheme({
      storage: localStorage,
      win: { matchMedia: () => ({ matches: true }) },
      followSystem: false,
    })).toEqual(DEFAULT_THEME);
  });

  it('returns dark mode when followSystem is true and system prefers dark', () => {
    const result = resolveInitialTheme({
      storage: localStorage,
      win: { matchMedia: () => ({ matches: true }) },
      followSystem: true,
    });
    expect(result.mode).toBe('dark');
    expect(result.palette).toBe(DEFAULT_THEME.palette);
  });
});

describe('themeBootScript', () => {
  it('sets attributes from a stored value when evaluated', () => {
    const stored: ThemeSelection = { palette: 'ink', mode: 'dark', font: 'lato' };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));
    const script = themeBootScript();
    new Function(script)();
    expect(document.documentElement.getAttribute('data-palette')).toBe('ink');
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(document.documentElement.getAttribute('data-font')).toBe('lato');
  });

  it('ignores an invalid palette in storage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ palette: 'nope', mode: 'dark', font: 'lato' }));
    const script = themeBootScript();
    new Function(script)();
    // Invalid palette should not be set
    expect(document.documentElement.getAttribute('data-palette')).toBeNull();
    // Valid mode and font should still be set
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(document.documentElement.getAttribute('data-font')).toBe('lato');
  });

  it('does nothing when storage is empty', () => {
    const script = themeBootScript();
    new Function(script)();
    expect(document.documentElement.getAttribute('data-palette')).toBeNull();
    expect(document.documentElement.getAttribute('data-mode')).toBeNull();
    expect(document.documentElement.getAttribute('data-font')).toBeNull();
  });
});
