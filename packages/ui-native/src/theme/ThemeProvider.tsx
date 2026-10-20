import {
  createContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import { Platform, AccessibilityInfo } from 'react-native';
import { DEFAULT_THEME } from '@nestself/tokens';
import type { Palette, Mode } from '@nestself/tokens';
import { nativeThemes, nativeSpace, nativeRadius } from '@nestself/tokens/native';
import type { TypeRole } from '@nestself/tokens/native';
import { typeStyle } from '../lib/typography';
import type { TypeStyleResult } from '../lib/typography';
import type { NativeThemeSelection, ThemeState } from './types';

export const ThemeContext = createContext<ThemeState | null>(null);

function buildTypeMap(): Record<TypeRole, TypeStyleResult> {
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const roles: TypeRole[] = [
    'display',
    'editorialHeading',
    'screenTitle',
    'sectionTitle',
    'bodyLarge',
    'body',
    'label',
    'metadata',
    'table',
  ];
  return Object.fromEntries(
    roles.map((role) => [role, typeStyle(role, platform)]),
  ) as Record<TypeRole, TypeStyleResult>;
}

export interface ThemeProviderProps {
  initial?: NativeThemeSelection;
  onChange?: (selection: NativeThemeSelection) => void;
  children: ReactNode;
}

export function ThemeProvider({
  initial,
  onChange,
  children,
}: ThemeProviderProps) {
  const [palette, setPaletteState] = useState<Palette>(
    initial?.palette ?? DEFAULT_THEME.palette,
  );
  const [mode, setModeState] = useState<Mode>(
    initial?.mode ?? DEFAULT_THEME.mode,
  );

  const setPalette = useCallback(
    (p: Palette) => {
      setPaletteState(p);
      onChange?.({ palette: p, mode });
    },
    [mode, onChange],
  );

  const setMode = useCallback(
    (m: Mode) => {
      setModeState(m);
      onChange?.({ palette, mode: m });
    },
    [palette, onChange],
  );

  const typeMap = useMemo(() => buildTypeMap(), []);

  const colors = useMemo(() => nativeThemes[palette][mode], [palette, mode]);

  const value = useMemo<ThemeState>(
    () => ({
      colors,
      mode,
      palette,
      setMode,
      setPalette,
      space: nativeSpace,
      radius: nativeRadius,
      type: typeMap,
    }),
    [colors, mode, palette, setMode, setPalette, typeMap],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/**
 * Hook that tracks the system Reduce Motion setting via AccessibilityInfo.
 * Returns true when the user has enabled Reduce Motion on the device.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduced(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (mounted) setReduced(enabled);
      },
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
