import { View, StyleSheet } from 'react-native';
import type { ViewProps } from 'react-native';
import type { ComponentType } from 'react';
import type { IconProps as PhosphorIconProps } from 'phosphor-react-native';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';
import { Button } from './Button';
import type { ButtonProps } from './Button';

/**
 * StatusBlock pattern states from the design handoff.
 * These map to the patterns array in tokens.json.
 */
export type StatusBlockState =
  | 'Booking'
  | 'Coverage'
  | 'PrivateChat'
  | 'ProtectedReport'
  | 'EventRequest'
  | 'EmptyState'
  | 'Offline'
  | 'Stale'
  | 'PermissionDenied';

export interface StatusBlockProps extends ViewProps {
  /** The pattern state this block represents. */
  state: StatusBlockState;
  /** Icon component displayed above the heading. */
  icon?: ComponentType<PhosphorIconProps>;
  /** Heading text. */
  heading: string;
  /** Descriptive body text. */
  body: string;
  /** Optional action button. */
  action?: Pick<ButtonProps, 'label' | 'onPress' | 'variant'>;
}

/**
 * Centred status/empty-state block with icon, heading, body, and optional action.
 * Matches the .status-block pattern from the design handoff:
 * padding 32, text-align center, canvas background, card radius.
 */
export function StatusBlock({
  state: _state,
  icon: IconComponent,
  heading,
  body,
  action,
  style,
  ...rest
}: StatusBlockProps) {
  const { colors, radius, space } = useTheme();

  return (
    <View
      style={[
        {
          padding: space[32],
          backgroundColor: colors.canvas,
          borderRadius: radius.card,
          marginTop: space[20],
          alignItems: 'center',
        },
        style,
      ]}
      {...rest}
    >
      {IconComponent ? (
        <View style={styles.iconWrap}>
          <IconComponent size={32} weight="duotone" color={colors.primary} />
        </View>
      ) : null}
      <Text role="sectionTitle" style={styles.heading}>
        {heading}
      </Text>
      <Text role="body" tone="secondary" style={styles.body}>
        {body}
      </Text>
      {action ? (
        <View style={{ marginTop: space[20] }}>
          <Button
            variant={action.variant ?? 'primary'}
            label={action.label}
            onPress={action.onPress}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    marginBottom: 16,
  },
  heading: {
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    textAlign: 'center',
    maxWidth: 400,
  },
});
