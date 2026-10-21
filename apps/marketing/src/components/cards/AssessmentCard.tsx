import { Card, Heading, Text, TextLink } from '@nestself/ui';
import { cn } from '@nestself/ui';

export interface AssessmentCardProps {
  href: string;
  title: string;
  intro: string;
  durationLabel: string;
  questionsLabel: string;
  className?: string;
}

export function AssessmentCard({
  href,
  title,
  intro,
  durationLabel,
  questionsLabel,
  className,
}: AssessmentCardProps) {
  return (
    <Card as="article" interactive padding="lg" className={cn('flex flex-col', className)}>
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
    </Card>
  );
}
