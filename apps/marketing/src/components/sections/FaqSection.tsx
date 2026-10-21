import { Heading, Accordion, AccordionItem } from '@nestself/ui';
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
  items: FaqItem[];
  className?: string;
}

export function FaqSection({ id, title, items, className }: FaqSectionProps) {
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
      <Heading level={2} id={headingId} className="mb-8">
        {title}
      </Heading>
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
      <JsonLd data={faqJsonLd} />
    </section>
  );
}
