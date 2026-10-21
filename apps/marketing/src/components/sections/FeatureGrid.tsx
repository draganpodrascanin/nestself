import { Eyebrow, Heading, Text, TextLink } from '@nestself/ui';
import { cn } from '@nestself/ui';
import { iconMap, type IconName } from './icons';

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
  className?: string;
}

export function FeatureGrid({
  id,
  eyebrow,
  title,
  lead,
  columns,
  items,
  className,
}: FeatureGridProps) {
  const headingId = id ? `${id}-title` : undefined;

  return (
    <section id={id} aria-labelledby={headingId} className={cn('py-16', className)}>
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
          'grid gap-8',
          columns === 2 && 'grid-cols-2 @max-[760px]:grid-cols-1',
          columns === 3 && 'grid-cols-3 @max-[760px]:grid-cols-1',
        )}
      >
        {items.map((item) => {
          const Icon = iconMap[item.icon];
          return (
            <li key={item.title} className="flex flex-col gap-3">
              <Icon size={28} aria-hidden className="text-primary" />
              <Heading level={3} typeRole="sectionTitle">
                {item.href ? (
                  <TextLink href={item.href}>{item.title}</TextLink>
                ) : (
                  item.title
                )}
              </Heading>
              <Text tone="secondary">{item.body}</Text>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
