import { Brain, Scales, Coins } from 'phosphor-react-native';
import type { ComponentType } from 'react';
import type { IconProps as PhosphorIconProps } from 'phosphor-react-native';
import type { CategoryKey } from '@nestself/ui-native';
import type { SupportArea } from '@nestself/contracts';

export const categoryIconMap: Record<CategoryKey, ComponentType<PhosphorIconProps>> = {
  mentalSupport: Brain,
  legal: Scales,
  financial: Coins,
  teamEvents: Brain,
  conversation: Brain,
  appointment: Brain,
  privacy: Brain,
  content: Brain,
};

export const areaToCategory: Record<SupportArea, CategoryKey> = {
  psychological: 'mentalSupport',
  legal: 'legal',
  financial: 'financial',
};
