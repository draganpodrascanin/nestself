import type { AriaAttributes, ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardTone = 'surface' | 'subtle' | 'brand';

export interface CardProps extends AriaAttributes {
  /** The HTML element to render. */
  as?: 'div' | 'article' | 'section' | 'li';
  /** Inner padding. */
  padding?: CardPadding;
  /** Background tone. */
  tone?: CardTone;
  /** Adds hover border/shadow and focus-within ring for clickable cards. */
  interactive?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  /** A landmark or live-region role; the ARIA attributes name and describe the card. */
  role?: string;
}

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const toneClasses: Record<CardTone, string> = {
  surface: 'bg-surface',
  subtle: 'bg-canvas',
  brand: 'bg-accent-soft',
};

export function Card({
  as: Tag = 'div',
  padding = 'md',
  tone = 'surface',
  interactive,
  children,
  className,
  id,
  role,
  ...aria
}: CardProps) {
  return (
    <Tag
      id={id}
      role={role}
      {...aria}
      className={cn(
        'rounded-card border border-border-subtle',
        toneClasses[tone],
        paddingClasses[padding],
        interactive && [
          'transition-[border-color,box-shadow] duration-[var(--motion-fast)] ease-standard',
          'motion-reduce:transition-none',
          'hover:border-primary hover:shadow-low',
          'focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus',
        ],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
