import { View, TextInput } from 'react-native';
import type { TextInputProps, ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

export interface FieldProps extends ViewProps {
  /** The field label. */
  label: string;
  /** Optional helper text shown below the input. */
  helper?: string;
  /** Error message. When present, the input shows an error state. */
  error?: string;
  /** The input or other control element. */
  children: React.ReactNode;
}

/**
 * Form field wrapper that provides label, helper text, and error styling.
 * Helper and error are announced via accessibilityHint on the child input.
 */
export function Field({
  label,
  helper,
  error,
  children,
  style,
  ...rest
}: FieldProps) {
  const { space } = useTheme();

  return (
    <View style={[{ gap: space[8] }, style]} {...rest}>
      <Text role="label" tone="default">
        {label}
      </Text>
      {children}
      {error ? (
        <Text role="metadata" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helper ? (
        <Text role="metadata" tone="secondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

export interface InputProps extends TextInputProps {
  /** Whether the field is in an error state. */
  hasError?: boolean;
  /** Accessible label from the parent Field. */
  label?: string;
  /** Helper or error text for accessibilityHint. */
  hint?: string;
}

/**
 * Themed text input with min-height 48, horizontal padding 12, and border styling.
 * Shows a 2px danger border when hasError is true.
 */
export function Input({
  hasError = false,
  label,
  hint,
  style,
  ...rest
}: InputProps) {
  const { colors, radius, type } = useTheme();
  const bodySpec = type.body;

  return (
    <TextInput
      accessibilityLabel={label}
      accessibilityHint={hint}
      placeholderTextColor={colors.textSecondary}
      style={[
        {
          minHeight: 48,
          paddingHorizontal: 12,
          borderRadius: radius.control,
          borderWidth: hasError ? 2 : 1,
          borderColor: hasError ? colors.danger : colors.borderControl,
          backgroundColor: colors.surface,
          color: colors.text,
          fontSize: bodySpec.fontSize,
          lineHeight: bodySpec.lineHeight,
          fontFamily: bodySpec.fontFamily,
        },
        style,
      ]}
      {...rest}
    />
  );
}
