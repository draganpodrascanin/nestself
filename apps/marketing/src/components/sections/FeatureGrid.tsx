import { Eyebrow, Heading, Text, TextLink, Card } from '@nestself/ui';
import { cn } from '@nestself/ui';
import { iconMap, type IconName } from './icons';
import { SECTION_PADDING } from './section';

export interface FeatureGridItem {
  icon: IconName;
  title: string;
  body: string;
  href?: string;
}

export interface FeatureGridProps {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  columns: 2 | 3;
  items: FeatureGridItem[];
  /** Number of items to show in the primary (large) row; rest go in a compact second row. */
  tiered?: number;
  /** Render every item in a compact icon-left layout. */
  variant?: 'default' | 'compact';
  className?: string;
}

function PrimaryItem({ item }: { item: FeatureGridItem }) {
  const Icon = iconMap[item.icon];
  return (
    <Card
      as="li"
      interactive={!!item.href}
      padding="lg"
      className="flex flex-col gap-4 h-full @max-[760px]:grid @max-[760px]:grid-cols-[auto_1fr] @max-[760px]:gap-x-3 @max-[760px]:!p-4"
    >
      <div className="w-11 h-11 rounded-control bg-accent-soft text-primary grid place-items-center">
        <Icon size={24} aria-hidden />
      </div>
      <div className="flex flex-col gap-2">
        <Heading level={3} typeRole="sectionTitle">
          {item.href ? (
            <TextLink href={item.href}>{item.title}</TextLink>
          ) : (
            item.title
          )}
        </Heading>
        <Text tone="secondary">{item.body}</Text>
      </div>
    </Card>
  );
}

function CompactItem({ item }: { item: FeatureGridItem }) {
  const Icon = iconMap[item.icon];
  return (
    <Card
      as="li"
      interactive={!!item.href}
      padding="md"
      className="grid grid-cols-[auto_1fr] gap-x-3 h-full"
    >
      <div className="w-11 h-11 rounded-control bg-accent-soft text-primary grid place-items-center">
        <Icon size={24} aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <Heading level={3} typeRole="sectionTitle">
          {item.href ? (
            <TextLink href={item.href}>{item.title}</TextLink>
          ) : (
            item.title
          )}
        </Heading>
        <Text typeRole="metadata" tone="secondary">{item.body}</Text>
      </div>
    </Card>
  );
}

export function FeatureGrid({
  id,
  eyebrow,
  title,
  lead,
  columns,
  items,
  tiered,
  variant = 'default',
  className,
}: FeatureGridProps) {
  const headingId = id ? `${id}-title` : undefined;

  if (variant === 'compact') {
    return (
      <section id={id} aria-labelledby={headingId} className={cn(SECTION_PADDING, className)}>
        <div className="mb-10 max-w-[640px]">
          {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
          <Heading level={2} id={headingId}>
            {title}
          </Heading>
          {lead && (
            <Text typeRole="bodyLarge" tone="secondary" className="mt-3">
              {lead}
            </Text>
          )}
        </div>
        <ul
          role="list"
          className="grid gap-3 grid-cols-3 @max-[760px]:grid-cols-2 @max-[420px]:grid-cols-1"
        >
          {items.map((item, i) => (
            <CompactItem key={`${item.icon}-${i}`} item={item} />
          ))}
        </ul>
      </section>
    );
  }

  const primaryItems = tiered ? items.slice(0, tiered) : items;
  const secondaryItems = tiered ? items.slice(tiered) : [];

  return (
    <section id={id} aria-labelledby={headingId} className={cn(SECTION_PADDING, className)}>
      <div className="mb-10 max-w-[640px]">
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <Heading level={2} id={headingId}>
          {title}
        </Heading>
        {lead && (
          <Text typeRole="bodyLarge" tone="secondary" className="mt-3">
            {lead}
          </Text>
        )}
      </div>
      <ul
        role="list"
        className={cn(
          'grid gap-6 @max-[760px]:gap-3',
          columns === 2 && 'grid-cols-2 @max-[760px]:grid-cols-1',
          columns === 3 && 'grid-cols-3 @max-[760px]:grid-cols-1',
        )}
      >
        {primaryItems.map((item, i) => (
          <PrimaryItem key={`${item.icon}-${i}`} item={item} />
        ))}
      </ul>
      {secondaryItems.length > 0 && (
        <ul
          role="list"
          className="mt-6 grid gap-3 grid-cols-4 @max-[760px]:grid-cols-1"
        >
          {secondaryItems.map((item, i) => (
            <CompactItem key={`${item.icon}-secondary-${i}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
