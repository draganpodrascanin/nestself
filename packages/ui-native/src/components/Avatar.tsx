import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

export interface AvatarProps extends ViewProps {
  /** Full name to derive initials from. */
  name: string;
  /** Size of the avatar in points. Defaults to 40. */
  size?: number;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '';
  if (parts.length === 1) return (parts[0]?.[0] ?? '').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/**
 * Circular avatar that displays the user's initials.
 * Uses accent background with onAccent text.
 */
export function Avatar({
  name,
  size = 40,
  style,
  ...rest
}: AvatarProps) {
  const { colors } = useTheme();
  const initials = getInitials(name);

  return (
    <View
      accessibilityLabel={name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      {...rest}
    >
      <Text
        role="label"
        style={{
          color: colors.text,
          fontSize: size * 0.4,
          lineHeight: size * 0.5,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}
