import { Heading, Accordion, AccordionItem, Text, TextLink } from '@nestself/ui';
import { cn } from '@nestself/ui';
import { JsonLd } from '../seo/JsonLd';
import { SECTION_PADDING } from './section';

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqSectionProps {
  id?: string;
  title: string;
  lead?: string;
  /** Link to the full FAQ page, shown under the heading. */
  more?: { href: string; label: string };
  items: FaqItem[];
  className?: string;
}

export function FaqSection({ id, title, lead, more, items, className }: FaqSectionProps) {
  const headingId = id ? `${id}-title` : undefined;

  const faqJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return (
    <section id={id} aria-labelledby={headingId} className={cn(SECTION_PADDING, className)}>
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-16 gap-y-6 items-start @max-[760px]:grid-cols-1">
        <div className="@min-[760px]:sticky @min-[760px]:top-24 flex flex-col gap-3">
          <Heading level={2} id={headingId} className="text-balance">
            {title}
          </Heading>
          {lead && (
            <Text typeRole="bodyLarge" tone="secondary">
              {lead}
            </Text>
          )}
          {more && (
            <TextLink href={more.href} className="type-label">
              {more.label} &rarr;
            </TextLink>
          )}
        </div>
        <Accordion>
          {items.map((item, i) => (
            <AccordionItem
              key={i}
              value={`faq-${i}`}
              title={item.question}
              headingLevel={3}
            >
              {item.answer}
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      <JsonLd data={faqJsonLd} />
    </section>
  );
}
