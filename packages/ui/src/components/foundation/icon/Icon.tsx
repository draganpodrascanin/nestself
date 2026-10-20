import type { ComponentType } from 'react';
import type { IconProps as PhosphorIconProps } from '@phosphor-icons/react';
import {
  Heart,
  Scales,
  Wallet,
  UsersThree,
  ChatCircleText,
  CalendarCheck,
  LockKey,
  Books,
} from '@phosphor-icons/react';
import type { IconCategory } from '@nestself/tokens';

export interface IconProps {
  icon: ComponentType<PhosphorIconProps>;
  weight?: 'regular' | 'fill' | 'duotone' | 'bold';
  size?: 16 | 20 | 24 | 32 | 48;
  label?: string;
  className?: string;
}

export function Icon({
  icon: IconComponent,
  weight = 'regular',
  size = 24,
  label,
  className,
}: IconProps) {
  if (label) {
    return (
      <IconComponent
        weight={weight}
        size={size}
        role="img"
        aria-label={label}
        className={className}
      />
    );
  }
  return (
    <IconComponent
      weight={weight}
      size={size}
      aria-hidden
      className={className}
    />
  );
}

const categoryIconMap: Record<IconCategory, ComponentType<PhosphorIconProps>> = {
  mentalSupport: Heart,
  legal: Scales,
  financial: Wallet,
  teamEvents: UsersThree,
  conversation: ChatCircleText,
  appointment: CalendarCheck,
  privacy: LockKey,
  content: Books,
};

export interface CategoryIconProps {
  category: IconCategory;
  size?: 32 | 48;
  label?: string;
  className?: string;
}

export function CategoryIcon({
  category,
  size = 32,
  label,
  className,
}: CategoryIconProps) {
  const IconComponent = categoryIconMap[category];
  return (
    <Icon
      icon={IconComponent}
      weight="duotone"
      size={size}
      label={label}
      className={className}
    />
  );
}

export interface NavIconProps {
  icon: ComponentType<PhosphorIconProps>;
  active?: boolean;
  size?: 16 | 20 | 24 | 32 | 48;
  label?: string;
  className?: string;
}

export function NavIcon({
  icon,
  active = false,
  size = 24,
  label,
  className,
}: NavIconProps) {
  return (
    <Icon
      icon={icon}
      weight={active ? 'fill' : 'regular'}
      size={size}
      label={label}
      className={className}
    />
  );
}
