import type { ComponentType } from 'react';
import type { IconProps as PhosphorIconProps, IconWeight } from 'phosphor-react-native';
import { useTheme } from '../theme/useTheme';

export interface IconProps {
  /** The Phosphor icon component to render. */
  icon: ComponentType<PhosphorIconProps>;
  /** Phosphor icon weight. Defaults to 'regular'. */
  weight?: IconWeight;
  /** Icon size in points. Defaults to 24. */
  size?: number;
  /** Override colour. Uses theme text colour by default. */
  color?: string;
}

/**
 * Themed icon wrapper around phosphor-react-native icon components.
 */
export function Icon({
  icon: IconComponent,
  weight = 'regular',
  size = 24,
  color,
}: IconProps) {
  const { colors } = useTheme();

  return (
    <IconComponent
      size={size}
      weight={weight}
      color={color ?? colors.text}
    />
  );
}
