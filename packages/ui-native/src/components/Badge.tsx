import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme.js';
import { Text } from './Text.js';

export type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends ViewProps {
  /** The badge label text. */
  label: string;
  /** Semantic tone of the badge. Defaults to 'default'. */
  tone?: BadgeTone;
}

/**
 * Small pill-shaped badge for status indicators.
 */
export function Badge({
  label,
  tone = 'default',
  style,
  ...rest
}: BadgeProps) {
  const { colors, radius } = useTheme();

  const bg = (() => {
    switch (tone) {
      case 'success':
        return colors.successSurface;
      case 'warning':
        return colors.warningSurface;
      case 'danger':
        return colors.dangerSurface;
      case 'info':
        return colors.infoSurface;
      default:
        return colors.tint;
    }
  })();

  const fg = (() => {
    switch (tone) {
      case 'success':
        return colors.success;
      case 'warning':
        return colors.warning;
      case 'danger':
        return colors.danger;
      case 'info':
        return colors.info;
      default:
        return colors.text;
    }
  })();

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: bg,
          borderRadius: radius.pill,
          paddingHorizontal: 12,
          paddingVertical: 4,
        },
        style,
      ]}
      {...rest}
    >
      <Text role="metadata" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}
