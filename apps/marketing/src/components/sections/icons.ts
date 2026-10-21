import type { ComponentType } from 'react';
import {
  Heart,
  Scales,
  Wallet,
  UsersThree,
  ChatCircleText,
  CalendarCheck,
  LockKey,
  Books,
  VideoCamera,
  ChartBar,
  ShieldCheck,
  Clock,
  Buildings,
  Sparkle,
  CheckCircle,
  Globe,
  Translate,
  HandHeart,
} from '@phosphor-icons/react';

/** Whitelisted icon names from the plan (B.2). */
export type IconName =
  | 'heart'
  | 'scales'
  | 'wallet'
  | 'users-three'
  | 'chat-circle-text'
  | 'calendar-check'
  | 'lock-key'
  | 'books'
  | 'video-camera'
  | 'chart-bar'
  | 'shield-check'
  | 'clock'
  | 'buildings'
  | 'sparkle'
  | 'check-circle'
  | 'globe'
  | 'translate'
  | 'hand-heart';

export const iconMap: Record<IconName, ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  heart: Heart,
  scales: Scales,
  wallet: Wallet,
  'users-three': UsersThree,
  'chat-circle-text': ChatCircleText,
  'calendar-check': CalendarCheck,
  'lock-key': LockKey,
  books: Books,
  'video-camera': VideoCamera,
  'chart-bar': ChartBar,
  'shield-check': ShieldCheck,
  clock: Clock,
  buildings: Buildings,
  sparkle: Sparkle,
  'check-circle': CheckCircle,
  globe: Globe,
  translate: Translate,
  'hand-heart': HandHeart,
};
