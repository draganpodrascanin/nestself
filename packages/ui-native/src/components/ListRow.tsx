import { View, Pressable } from 'react-native';
import type { PressableProps, ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme';

export interface ListRowProps extends Omit<PressableProps, 'children'> {
  /** Content of the list row. */
  children: React.ReactNode;
  /** Whether the row is pressable. Defaults to true if onPress is provided. */
  pressable?: boolean;
}

/**
 * A list row with minHeight 64, paddingHorizontal 16.
 * Renders as a Pressable when onPress is provided, otherwise a View.
 */
export function ListRow({
  children,
  onPress,
  pressable,
  style,
  ...rest
}: ListRowProps) {
  const { colors } = useTheme();
  const isPressable = pressable ?? !!onPress;

  const baseStyle = {
    minHeight: 64,
    paddingHorizontal: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: colors.surface,
  };

  if (isPressable) {
    return (
      <Pressable
        onPress={onPress}
        style={(state) => [
          baseStyle,
          state.pressed && { backgroundColor: colors.tint },
          typeof style === 'function' ? style(state) : style,
        ]}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[baseStyle, style as ViewProps['style']]} {...(rest as ViewProps)}>
      {children}
    </View>
  );
}
