import { DEFAULT_THEME, isPalette, isMode, isFont } from './index.js';
import type { ThemeSelection } from './index.js';

export const THEME_STORAGE_KEY = 'nestself-theme';

export function applyTheme(selection: ThemeSelection, doc: { documentElement: { setAttribute(name: string, value: string): void } } = document): void {
  doc.documentElement.setAttribute('data-palette', selection.palette);
  doc.documentElement.setAttribute('data-mode', selection.mode);
  doc.documentElement.setAttribute('data-font', selection.font);
}

export function readTheme(doc: { documentElement: { getAttribute(name: string): string | null } } = document): ThemeSelection {
  const palette = doc.documentElement.getAttribute('data-palette');
  const mode = doc.documentElement.getAttribute('data-mode');
  const font = doc.documentElement.getAttribute('data-font');
  return {
    palette: isPalette(palette) ? palette : DEFAULT_THEME.palette,
    mode: isMode(mode) ? mode : DEFAULT_THEME.mode,
    font: isFont(font) ? font : DEFAULT_THEME.font,
  };
}

export function persistTheme(selection: ThemeSelection, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Storage may be blocked or full; silently ignore.
  }
}

export function loadPersistedTheme(storage: Pick<Storage, 'getItem'> = localStorage): ThemeSelection | null {
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (!isPalette(obj.palette) || !isMode(obj.mode) || !isFont(obj.font)) return null;
    return { palette: obj.palette, mode: obj.mode, font: obj.font };
  } catch {
    return null;
  }
}

export function systemPrefersDark(win: { matchMedia(query: string): { matches: boolean } } = window): boolean {
  return win.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveInitialTheme(opts: {
  storage?: Pick<Storage, 'getItem'>;
  win?: { matchMedia(query: string): { matches: boolean } };
  followSystem?: boolean;
} = {}): ThemeSelection {
  const persisted = loadPersistedTheme(opts.storage ?? localStorage);
  if (persisted) return persisted;
  const base = { ...DEFAULT_THEME };
  if (opts.followSystem && systemPrefersDark(opts.win ?? window)) {
    base.mode = 'dark';
  }
  return base;
}

export function themeBootScript(): string {
  // The palettes, modes and fonts lists are inlined so the boot script has no import dependency.
  return `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k);if(!s)return;var t=JSON.parse(s);var p=['forest','ink','plum','azure'];var m=['light','dark'];var f=['onest','commissioner','nunito','fira','lato'];if(p.indexOf(t.palette)>=0)document.documentElement.setAttribute('data-palette',t.palette);if(m.indexOf(t.mode)>=0)document.documentElement.setAttribute('data-mode',t.mode);if(f.indexOf(t.font)>=0)document.documentElement.setAttribute('data-font',t.font);}catch(e){}})();`;
}
