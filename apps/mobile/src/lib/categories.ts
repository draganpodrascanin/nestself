import { Books, CalendarCheck, ChatCircleText, Heart, LockKey, Scales, UsersThree, Wallet } from 'phosphor-react-native';
import type { ComponentType } from 'react';
import type { IconProps as PhosphorIconProps } from 'phosphor-react-native';
import type { CategoryKey } from '@nestself/ui-native';
import type { SupportArea } from '@nestself/contracts';

export const categoryIconMap: Record<CategoryKey, ComponentType<PhosphorIconProps>> = {
  mentalSupport: Heart,
  legal: Scales,
  financial: Wallet,
  teamEvents: UsersThree,
  conversation: ChatCircleText,
  appointment: CalendarCheck,
  privacy: LockKey,
  content: Books,
};

export const areaToCategory: Record<SupportArea, CategoryKey> = {
  psychological: 'mentalSupport',
  legal: 'legal',
  financial: 'financial',
};
