import type { ComponentType } from 'react';
import type { IconProps as PhosphorIconProps } from 'phosphor-react-native';
import { useTheme } from '../theme/useTheme.js';

export type CategoryKey =
  | 'mentalSupport'
  | 'legal'
  | 'financial'
  | 'teamEvents'
  | 'conversation'
  | 'appointment'
  | 'privacy'
  | 'content';

export interface CategoryIconProps {
  /** The category key from the icon mapping. */
  category: CategoryKey;
  /** Map of category keys to their Phosphor icon components. Must be provided by the consumer. */
  iconMap: Record<CategoryKey, ComponentType<PhosphorIconProps>>;
  /** Icon size in points. Defaults to 32. */
  size?: number;
}

/**
 * Renders a category-specific Phosphor icon in duotone weight using the primary colour.
 * The consumer must pass the iconMap since this package does not import all Phosphor icons at once.
 */
export function CategoryIcon({
  category,
  iconMap,
  size = 32,
}: CategoryIconProps) {
  const { colors } = useTheme();
  const IconComponent = iconMap[category];

  return (
    <IconComponent size={size} weight="duotone" color={colors.primary} />
  );
}
