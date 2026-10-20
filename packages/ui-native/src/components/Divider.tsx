import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme';

export interface DividerProps extends ViewProps {
  /** Optional override for the divider colour. Uses borderSubtle by default. */
  color?: string;
}

/**
 * Horizontal divider line using the borderSubtle theme token.
 */
export function Divider({ color, style, ...rest }: DividerProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        {
          height: 1,
          backgroundColor: color ?? colors.borderSubtle,
        },
        style,
      ]}
      {...rest}
    />
  );
}
