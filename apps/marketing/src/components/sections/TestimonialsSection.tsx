import { Heading, Text, Avatar } from '@nestself/ui';
import { cn } from '@nestself/ui';

/** Testimonial shape matching SampleTestimonial from @nestself/sample-data. */
export interface Testimonial {
  id: string;
  placeholder: true;
  name: string;
  role: string;
  company: string;
  country: string;
  quote: Record<string, string>;
}

export interface TestimonialsSectionProps {
  id?: string;
  title: string;
  lead?: string;
  items: Testimonial[];
  /** The locale key to pick from each testimonial's quote record. */
  locale: string;
  className?: string;
}

export function TestimonialsSection({
  id,
  title,
  lead,
  items,
  locale,
  className,
}: TestimonialsSectionProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-placeholder="true"
      className={cn('py-16', className)}
    >
      <Heading level={2} id={headingId} className="mb-3">
        {title}
      </Heading>
      {lead && (
        <Text typeRole="bodyLarge" tone="secondary" className="mb-10">
          {lead}
        </Text>
      )}
      <ul
        role="list"
        className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1"
      >
        {items.map((item) => {
          const initials = item.name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .toUpperCase();

          return (
            <li key={item.id} className="flex flex-col gap-4">
              <blockquote className="type-body text-text-secondary">
                &ldquo;{item.quote[locale as keyof typeof item.quote]}&rdquo;
              </blockquote>
              <div className="flex items-center gap-3">
                <Avatar initials={initials} name={item.name} size="sm" />
                <div>
                  <Text as="span" typeRole="label">
                    {item.name}
                  </Text>
                  <Text as="span" typeRole="metadata" tone="secondary" className="block">
                    {item.role}, {item.company}
                  </Text>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
