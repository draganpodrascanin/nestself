import { Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import type { PressableProps } from 'react-native';
import type { ComponentType } from 'react';
import type { IconProps as PhosphorIconProps } from 'phosphor-react-native';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  /** Visual variant of the button. */
  variant?: ButtonVariant;
  /** Button size (currently only md). */
  size?: 'md';
  /** Show a loading spinner and prevent duplicate actions. */
  loading?: boolean;
  /** Whether the button is disabled. */
  disabled?: boolean;
  /** Button label text. */
  label: string;
  /** Called when the button is pressed. */
  onPress?: PressableProps['onPress'];
  /** Optional leading Phosphor icon component. */
  icon?: ComponentType<PhosphorIconProps>;
}

/**
 * Themed pressable button with variant styles, loading state, and accessibility.
 * minHeight 48, paddingHorizontal 20, border-radius from control token.
 */
export function Button({
  variant = 'primary',
  size: _size = 'md',
  loading = false,
  disabled = false,
  label,
  onPress,
  icon: IconComponent,
  style,
  ...rest
}: ButtonProps) {
  const { colors, radius } = useTheme();
  const isDisabled = disabled || loading;

  const bg = (() => {
    if (isDisabled) return colors.disabledSurface;
    switch (variant) {
      case 'primary':
        return colors.primary;
      case 'secondary':
        return colors.surface;
      case 'ghost':
        return 'transparent';
      case 'danger':
        return colors.danger;
    }
  })();

  const pressedBg = (() => {
    switch (variant) {
      case 'primary':
        return colors.primaryPressed;
      case 'secondary':
        return colors.tint;
      case 'ghost':
        return colors.tint;
      case 'danger':
        return colors.dangerSurface;
    }
  })();

  const fg = (() => {
    if (isDisabled) return colors.disabledText;
    switch (variant) {
      case 'primary':
        return colors.onPrimary;
      case 'secondary':
        return colors.text;
      case 'ghost':
        return colors.text;
      case 'danger':
        return colors.onPrimary;
    }
  })();

  const borderColor = variant === 'secondary' ? colors.borderControl : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      disabled={isDisabled}
      onPress={onPress}
      style={(state) => [
        {
          minHeight: 48,
          paddingHorizontal: 20,
          borderRadius: radius.control,
          backgroundColor: state.pressed ? pressedBg : bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: isDisabled ? 1 : undefined,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : IconComponent ? (
        <IconComponent size={20} weight="regular" color={fg} />
      ) : null}
      <Text
        role="label"
        style={[styles.label, { color: fg }]}
        allowFontScaling
        maxFontSizeMultiplier={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    textAlign: 'center',
  },
});
