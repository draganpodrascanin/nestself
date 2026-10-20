import type { Palette, Mode } from '@nestself/tokens';
import type { NativeColors, TypeRole } from '@nestself/tokens/native';
import type { nativeSpace, nativeRadius } from '@nestself/tokens/native';
import type { TypeStyleResult } from '../lib/typography.js';

/** Native theme selection (no font choice -- always Onest on native). */
export interface NativeThemeSelection {
  palette: Palette;
  mode: Mode;
}

export interface ThemeState {
  colors: NativeColors;
  mode: Mode;
  palette: Palette;
  setMode: (mode: Mode) => void;
  setPalette: (palette: Palette) => void;
  space: typeof nativeSpace;
  radius: typeof nativeRadius;
  type: Record<TypeRole, TypeStyleResult>;
}
