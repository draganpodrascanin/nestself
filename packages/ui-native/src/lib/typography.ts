import { nativeType, nativeFontFiles } from '@nestself/tokens/native';
import type { TypeRole, NativeColors } from '@nestself/tokens/native';

export type { TypeRole } from '@nestself/tokens/native';

export type Tone = 'default' | 'secondary' | 'danger' | 'onPrimary';

export interface TypeStyleResult {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '600' | '700';
  fontFamily: string;
  letterSpacing: number;
}

/**
 * Maps a font weight to the correct Onest font family name.
 */
export function fontFamilyForWeight(weight: '400' | '600' | '700'): string {
  switch (weight) {
    case '400':
      return nativeFontFiles.regular;
    case '600':
      return nativeFontFiles.semibold;
    case '700':
      return nativeFontFiles.bold;
  }
}

/**
 * Returns the text style for a given type role and platform.
 */
export function typeStyle(role: TypeRole, platform: 'ios' | 'android'): TypeStyleResult {
  const spec = nativeType[platform][role];
  return {
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
    fontWeight: spec.fontWeight,
    fontFamily: fontFamilyForWeight(spec.fontWeight),
    letterSpacing: spec.letterSpacing,
  };
}

/**
 * Resolves a tone name to the corresponding color from the theme.
 */
export function resolveTone(colors: NativeColors, tone: Tone): string {
  switch (tone) {
    case 'default':
      return colors.text;
    case 'secondary':
      return colors.textSecondary;
    case 'danger':
      return colors.danger;
    case 'onPrimary':
      return colors.onPrimary;
  }
}
