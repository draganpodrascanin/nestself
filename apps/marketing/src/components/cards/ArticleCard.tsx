import { Card, Heading, Text, TextLink, PhotoFigure } from '@nestself/ui';
import { cn } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';

export interface ArticleCardProps {
  href: string;
  title: string;
  description: string;
  topicLabel: string;
  readingLabel: string;
  cover: { key: PhotoKey; alt: string };
  dateLabel: string;
  className?: string;
}

export function ArticleCard({
  href,
  title,
  description,
  topicLabel,
  readingLabel,
  cover,
  dateLabel,
  className,
}: ArticleCardProps) {
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
        <div className="flex items-center gap-2">
          <Text as="span" typeRole="metadata" tone="secondary">
            {topicLabel}
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            &middot;
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            {readingLabel}
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
