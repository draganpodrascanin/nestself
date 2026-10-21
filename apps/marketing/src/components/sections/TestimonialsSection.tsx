import { Heading, Text, Avatar, Card, Badge } from '@nestself/ui';
import { cn } from '@nestself/ui';
import { Quotes } from '@phosphor-icons/react/dist/ssr';
import type { SampleTestimonial } from '@nestself/sample-data';
import { SECTION_PADDING } from './section';

export interface TestimonialsSectionProps {
  id?: string;
  title: string;
  lead?: string;
  badge?: string;
  items: SampleTestimonial[];
  /** The locale key to pick from each testimonial's quote/role/company record. */
  locale: string;
  className?: string;
}

export function TestimonialsSection({
  id,
  title,
  lead,
  badge,
  items,
  locale,
  className,
}: TestimonialsSectionProps) {
  const headingId = id ? `${id}-title` : undefined;
  const loc = locale as keyof SampleTestimonial['quote'];

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-placeholder="true"
      className={cn(SECTION_PADDING, className)}
    >
      <Heading level={2} id={headingId} typeRole="editorial">
        {title}
      </Heading>
      {(badge || lead) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {badge && <Badge tone="info">{badge}</Badge>}
          {lead && (
            <Text as="span" tone="secondary">
              {lead}
            </Text>
          )}
        </div>
      )}

      <ul
        role="list"
        className="mt-10 grid grid-cols-3 grid-flow-dense gap-6 @max-[760px]:grid-cols-1 @max-[760px]:gap-4"
      >
        {items.map((item, i) => {
          const featured = i === 0;
          const initials = item.name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .toUpperCase();

          const roleText = typeof item.role === 'string' ? item.role : item.role[loc];
          const companyText = typeof item.company === 'string' ? item.company : item.company[loc];

          return (
            <li
              key={item.id}
              data-featured={featured ? 'true' : undefined}
              className={cn(
                featured &&
                  'col-span-2 row-span-2 @max-[760px]:col-span-1 @max-[760px]:row-span-1',
              )}
            >
            <Card
              padding="lg"
              tone={featured ? 'brand' : 'surface'}
              className={cn(
                'flex flex-col gap-6 h-full',
                featured && 'justify-between',
              )}
            >
              <div className="flex flex-col gap-4">
                <Quotes
                  weight="fill"
                  size={28}
                  aria-hidden
                  className="text-primary"
                />
                <blockquote
                  className={cn(
                    'type-body-large text-text',
                    featured &&
                      'type-editorial font-[var(--font-weight-body)] @max-[760px]:type-section-title @max-[760px]:font-[var(--font-weight-body)]',
                  )}
                >
                  {item.quote[loc]}
                </blockquote>
              </div>
              <div className="flex items-center gap-3 mt-auto">
                <Avatar initials={initials} name={item.name} size="sm" />
                <div>
                  <Text as="span" typeRole="label">
                    {item.name}
                  </Text>
                  <Text
                    as="span"
                    typeRole="metadata"
                    tone="secondary"
                    className="block"
                  >
                    {roleText}, {companyText}
                  </Text>
                </div>
              </div>
            </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
