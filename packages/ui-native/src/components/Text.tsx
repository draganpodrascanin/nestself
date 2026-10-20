import { Text as RNText } from 'react-native';
import type { TextProps as RNTextProps } from 'react-native';
import { useTheme } from '../theme/useTheme.js';
import { fontFamilyForWeight, resolveTone } from '../lib/typography.js';
import type { TypeRole, Tone } from '../lib/typography.js';

export interface TextProps extends Omit<RNTextProps, 'role'> {
  /** Typography role from the type scale. Defaults to 'body'. */
  role?: TypeRole;
  /** Semantic colour tone. Defaults to 'default'. */
  tone?: Tone;
}

/**
 * Themed text component that applies the type scale and semantic colour tokens.
 * Uses Onest font family mapped by weight. Never sets fontStyle italic.
 * Allows font scaling by default with maxFontSizeMultiplier of 2.
 */
export function Text({
  role = 'body',
  tone = 'default',
  style,
  allowFontScaling = true,
  maxFontSizeMultiplier = 2,
  ...rest
}: TextProps) {
  const { colors, type } = useTheme();
  const spec = type[role];
  const color = resolveTone(colors, tone);

  return (
    <RNText
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        {
          fontSize: spec.fontSize,
          lineHeight: spec.lineHeight,
          fontWeight: spec.fontWeight,
          fontFamily: fontFamilyForWeight(spec.fontWeight),
          letterSpacing: spec.letterSpacing,
          color,
        },
        style,
      ]}
      {...rest}
    />
  );
}
