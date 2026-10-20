import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme.js';

export interface CardProps extends ViewProps {
  children: React.ReactNode;
}

/**
 * Themed card container with surface background, card radius, and 20pt padding (touch).
 */
export function Card({ style, children, ...rest }: CardProps) {
  const { colors, radius } = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: 20,
          gap: 12,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
