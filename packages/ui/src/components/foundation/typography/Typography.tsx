import type { ElementType, ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export type HeadingTypeRole =
  | 'display'
  | 'editorial'
  | 'screenTitle'
  | 'sectionTitle'
  | 'marketingHero';

export type TextTypeRole =
  | 'bodyLarge'
  | 'body'
  | 'label'
  | 'metadata'
  | 'table';

export type Tone = 'default' | 'secondary' | 'danger';

const headingRoleMap: Record<HeadingTypeRole, string> = {
  display: 'type-display',
  editorial: 'type-editorial',
  screenTitle: 'type-screen-title',
  sectionTitle: 'type-section-title',
  marketingHero: 'type-marketing-hero',
};

const headingLevelDefaults: Record<1 | 2 | 3 | 4, HeadingTypeRole> = {
  1: 'screenTitle',
  2: 'sectionTitle',
  3: 'sectionTitle',
  4: 'sectionTitle',
};

const textRoleMap: Record<TextTypeRole, string> = {
  bodyLarge: 'type-body-large',
  body: 'type-body',
  label: 'type-label',
  metadata: 'type-metadata',
  table: 'type-table',
};

const toneMap: Record<Tone, string> = {
  default: 'text-text',
  secondary: 'text-text-secondary',
  danger: 'text-danger',
};

export interface HeadingProps {
  level: 1 | 2 | 3 | 4;
  typeRole?: HeadingTypeRole;
  className?: string;
  children: ReactNode;
  id?: string;
}

export function Heading({
  level,
  typeRole,
  className,
  children,
  id,
}: HeadingProps) {
  const Tag = `h${level}` as ElementType;
  const resolvedRole = typeRole ?? headingLevelDefaults[level];
  return (
    <Tag id={id} className={cn(headingRoleMap[resolvedRole], className)}>
      {children}
    </Tag>
  );
}

export interface TextProps {
  as?: ElementType;
  typeRole?: TextTypeRole;
  tone?: Tone;
  className?: string;
  children: ReactNode;
  id?: string;
}

export function Text({
  as: Tag = 'p',
  typeRole = 'body',
  tone = 'default',
  className,
  children,
  id,
}: TextProps) {
  return (
    <Tag id={id} className={cn(textRoleMap[typeRole], toneMap[tone], className)}>
      {children}
    </Tag>
  );
}

export interface EyebrowProps {
  numbered?: boolean;
  className?: string;
  children: ReactNode;
}

export function Eyebrow({ numbered, className, children }: EyebrowProps) {
  return (
    <span
      className={cn(
        'text-primary font-[var(--font-weight-label)] text-[0.875rem]',
        numbered && 'uppercase tracking-wider',
        className,
      )}
    >
      {children}
    </span>
  );
}
