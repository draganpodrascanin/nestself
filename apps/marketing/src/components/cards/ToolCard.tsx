import { Card, Heading, Text, TextLink, PhotoFigure } from '@nestself/ui';
import { cn } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';

export interface ToolCardProps {
  href: string;
  title: string;
  description: string;
  kindLabel: string;
  cover: { key: PhotoKey; alt: string };
  className?: string;
}

export function ToolCard({
  href,
  title,
  description,
  kindLabel,
  cover,
  className,
}: ToolCardProps) {
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
        <Text as="span" typeRole="metadata" tone="secondary">
          {kindLabel}
        </Text>
        <Heading level={3} typeRole="sectionTitle">
          <TextLink href={href}>{title}</TextLink>
        </Heading>
        <Text tone="secondary">{description}</Text>
      </div>
    </Card>
  );
}
