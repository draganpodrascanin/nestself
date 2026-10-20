import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ThemeProvider as NativeThemeProvider } from '@nestself/ui-native';
import type { NativeThemeSelection } from '@nestself/ui-native';
import { DEFAULT_THEME } from '@nestself/tokens';
import type { Palette, Mode } from '@nestself/tokens';
import { getItem, setItem } from '@/lib/storage';

const THEME_STORAGE_KEY = 'nestself-theme';

interface PersistedTheme {
  palette: Palette;
  mode: Mode;
}

function parseStored(raw: string | null): NativeThemeSelection | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.palette !== 'string' || typeof obj.mode !== 'string') return undefined;
    return { palette: obj.palette as Palette, mode: obj.mode as Mode };
  } catch {
    return undefined;
  }
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [initial, setInitial] = useState<NativeThemeSelection | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getItem(THEME_STORAGE_KEY).then((raw) => {
      const parsed = parseStored(raw);
      if (parsed) {
        setInitial(parsed);
      }
      setLoaded(true);
    });
  }, []);

  const handleChange = useCallback((selection: NativeThemeSelection) => {
    const stored: PersistedTheme = {
      palette: selection.palette,
      mode: selection.mode,
    };
    void setItem(THEME_STORAGE_KEY, JSON.stringify(stored));
  }, []);

  if (!loaded) return null;

  return (
    <NativeThemeProvider
      initial={initial ?? { palette: DEFAULT_THEME.palette, mode: DEFAULT_THEME.mode }}
      onChange={handleChange}
    >
      {children}
    </NativeThemeProvider>
  );
}
