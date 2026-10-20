import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme.js';

export interface ScreenProps extends ViewProps {
  children: React.ReactNode;
}

/**
 * Full-screen container with safe-area padding and canvas background.
 * Wraps content in a flex-1 View using the theme canvas colour.
 */
export function Screen({ style, children, ...rest }: ScreenProps) {
  const { colors, space } = useTheme();

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: colors.canvas,
          paddingTop: space[48],
          paddingBottom: space[32],
          paddingHorizontal: space[16],
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
