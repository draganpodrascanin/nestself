import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

export type AlertTone = 'success' | 'warning' | 'danger' | 'info';

export interface AlertProps extends ViewProps {
  /** Alert tone determines background and text colour. */
  tone: AlertTone;
  /** The alert message. */
  message: string;
  /** Optional title. */
  title?: string;
}

/**
 * Themed alert banner with semantic background and text colours.
 */
export function Alert({
  tone,
  message,
  title,
  style,
  ...rest
}: AlertProps) {
  const { colors, radius, space } = useTheme();

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
    }
  })();

  return (
    <View
      accessibilityRole="alert"
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.control,
          padding: space[16],
          gap: space[4],
        },
        style,
      ]}
      {...rest}
    >
      {title ? (
        <Text role="label" style={{ color: fg }}>
          {title}
        </Text>
      ) : null}
      <Text role="body" style={{ color: fg }}>
        {message}
      </Text>
    </View>
  );
}
