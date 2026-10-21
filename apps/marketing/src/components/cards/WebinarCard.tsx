import { Card, Heading, Text, TextLink, PhotoFigure } from '@nestself/ui';
import { cn } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';

export interface WebinarCardProps {
  href: string;
  title: string;
  description: string;
  dateLabel: string;
  durationLabel: string;
  formatLabel: string;
  languagesLabel: string;
  cover: { key: PhotoKey; alt: string };
  className?: string;
}

export function WebinarCard({
  href,
  title,
  description,
  dateLabel,
  durationLabel,
  formatLabel,
  languagesLabel,
  cover,
  className,
}: WebinarCardProps) {
  return (
    <Card as="article" interactive padding="none" className={cn('flex flex-col', className)}>
      <PhotoFigure
        photo={cover.key}
        alt={cover.alt}
        imageRole="card"
        sizes="(max-width: 760px) 100vw, 33vw"
        className="overflow-hidden rounded-t-card"
      />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Text as="span" typeRole="metadata" tone="secondary">
            {formatLabel}
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            &middot;
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            {durationLabel}
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            &middot;
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            {languagesLabel}
          </Text>
        </div>
        <Heading level={3} typeRole="sectionTitle">
          <TextLink href={href}>{title}</TextLink>
        </Heading>
        <Text tone="secondary">{description}</Text>
        <Text as="span" typeRole="metadata" tone="secondary" className="mt-auto pt-2">
          {dateLabel}
        </Text>
      </div>
    </Card>
  );
}
