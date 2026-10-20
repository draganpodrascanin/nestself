import type { Palette, Mode } from './index';
import tokensJson from '../tokens.json';

// ---------- Colors ----------

export type NativeColors = {
  canvas: string;
  surface: string;
  raised: string;
  tint: string;
  text: string;
  textSecondary: string;
  borderSubtle: string;
  borderControl: string;
  primary: string;
  primaryHover: string;
  primaryPressed: string;
  onPrimary: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  focus: string;
  disabledSurface: string;
  disabledText: string;
  scrim: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;
  info: string;
  infoSurface: string;
};

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function buildNativeColors(palette: string, mode: string): NativeColors {
  const themes = tokensJson.themes as unknown as Record<string, Record<string, Record<string, string>>>;
  const src = themes[palette]![mode]!;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(src)) {
    result[kebabToCamel(key)] = value;
  }
  return result as unknown as NativeColors;
}

const paletteKeys: readonly Palette[] = ['forest', 'ink', 'plum', 'azure'];
const modeKeys: readonly Mode[] = ['light', 'dark'];

export const nativeThemes: Record<Palette, Record<Mode, NativeColors>> = Object.fromEntries(
  paletteKeys.map((p) => [
    p,
    Object.fromEntries(modeKeys.map((m) => [m, buildNativeColors(p, m)])),
  ]),
) as Record<Palette, Record<Mode, NativeColors>>;

// ---------- Space ----------

export const nativeSpace = {
  0: 0,
  2: 2,
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  20: 20,
  24: 24,
  32: 32,
  40: 40,
  48: 48,
  64: 64,
  80: 80,
  96: 96,
} as const;

// ---------- Radius ----------

export const nativeRadius = {
  small: tokensJson.primitive.radius.small,
  control: tokensJson.primitive.radius.control,
  card: tokensJson.primitive.radius.card,
  modal: tokensJson.primitive.radius.modal,
  sheet: tokensJson.primitive.radius.sheet,
  pill: tokensJson.primitive.radius.pill,
} as const;

// ---------- Border width ----------

export const nativeBorderWidth = {
  default: tokensJson.primitive.borderWidth.default,
  selected: tokensJson.primitive.borderWidth.selected,
  focus: tokensJson.primitive.borderWidth.focus,
} as const;

// ---------- Motion ----------

export const nativeMotion = {
  fastMs: tokensJson.primitive.motion.fastMs,
  standardMs: tokensJson.primitive.motion.standardMs,
  slowMs: tokensJson.primitive.motion.slowMs,
  reducedMs: tokensJson.primitive.motion.reducedMs,
  reducedFadeMaxMs: tokensJson.primitive.motion.reducedFadeMaxMs,
  easing: tokensJson.primitive.motion.easing as unknown as readonly [number, number, number, number],
} as const;

// ---------- Touch targets ----------

export const nativeTarget = { ios: 48, android: 48 } as const;

// ---------- Typography ----------

export type TypeRole = 'display' | 'editorialHeading' | 'screenTitle' | 'sectionTitle' | 'bodyLarge' | 'body' | 'label' | 'metadata' | 'table';

type TypeSpec = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '600' | '700';
  letterSpacing: number;
};

const typeRoles: TypeRole[] = ['display', 'editorialHeading', 'screenTitle', 'sectionTitle', 'bodyLarge', 'body', 'label', 'metadata', 'table'];

function buildTypeScale(platform: 'ios' | 'android'): Record<TypeRole, TypeSpec> {
  const styles = tokensJson.typography.styles as unknown as Record<string, {
    weight: number;
    ios: [number, number];
    android: [number, number];
    trackingEm: number | { web: number; mobileWeb: number; ios: number; android: number };
  }>;

  return Object.fromEntries(
    typeRoles.map((role) => {
      const s = styles[role]!;
      const [fontSize, lineHeight] = s[platform];
      const trackingEm = typeof s.trackingEm === 'object' ? s.trackingEm[platform] : s.trackingEm;
      const letterSpacing = trackingEm * fontSize;
      return [role, {
        fontSize,
        lineHeight,
        fontWeight: String(s.weight) as '400' | '600' | '700',
        letterSpacing,
      }];
    }),
  ) as Record<TypeRole, TypeSpec>;
}

export const nativeType: Record<'ios' | 'android', Record<TypeRole, TypeSpec>> = {
  ios: buildTypeScale('ios'),
  android: buildTypeScale('android'),
};

// ---------- Font files ----------

export const nativeFontFiles = {
  regular: 'Onest-Regular',
  semibold: 'Onest-SemiBold',
  bold: 'Onest-Bold',
} as const;
