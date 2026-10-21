import type { ComponentType } from 'react';
import { Card, Heading, Text, TextLink } from '@nestself/ui';
import { cn } from '@nestself/ui';
import {
  Heartbeat,
  Brain,
  Fire,
  Briefcase,
  Wallet,
  ClipboardText,
} from '@phosphor-icons/react/dist/ssr';

type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
const slugIconMap: Record<string, ComponentType<{ size?: number; weight?: IconWeight; className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  'wellbeing-check-in': Heartbeat,
  'anxiety-check': Brain,
  'burnout-check': Fire,
  'workplace-stress-check': Briefcase,
  'financial-wellbeing-check': Wallet,
};

export interface AssessmentCardProps {
  href: string;
  title: string;
  intro: string;
  durationLabel: string;
  questionsLabel: string;
  /** Assessment slug used to pick an icon. */
  slug?: string;
  className?: string;
}

export function AssessmentCard({
  href,
  title,
  intro,
  durationLabel,
  questionsLabel,
  slug,
  className,
}: AssessmentCardProps) {
  const Icon = (slug && slugIconMap[slug]) || ClipboardText;

  return (
    <Card as="article" interactive padding="none" className={cn('flex flex-col overflow-hidden', className)}>
      {/* Tinted header band with icon */}
      <div className="bg-accent-soft h-24 rounded-t-card grid place-items-center">
        <Icon size={40} weight="duotone" aria-hidden className="text-primary" />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          <Text as="span" typeRole="metadata" tone="secondary">
            {durationLabel}
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            &middot;
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            {questionsLabel}
          </Text>
        </div>
        <Heading level={3} typeRole="sectionTitle" className="mt-2">
          <TextLink href={href}>{title}</TextLink>
        </Heading>
        <Text tone="secondary" className="mt-2">
          {intro}
        </Text>
      </div>
    </Card>
  );
}
