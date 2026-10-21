import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { localizedMetadata } from '@/i18n/metadata';
import { HERO_PADDING } from '@/components/sections/section';
import { CtaBand } from '@/components/sections/CtaBand';
import { Heading, Text, TextLink, Accordion, AccordionItem } from '@nestself/ui';
import { JsonLd } from '@/components/seo/JsonLd';
import { loadContent } from './content';

interface Params {
  locale: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const { data } = await loadContent(locale as Locale);
  return localizedMetadata({
    locale: locale as Locale,
    title: data.meta.title,
    description: data.meta.description,
    pathname: '/faq',
  });
}

export default async function FaqPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { data } = await loadContent(locale as Locale);

  const allItems = [...data.employerFaq.items, ...data.employeeFaq.items];
  const faqJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: allItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

  return (
    <main id="main" tabIndex={-1} className="@container">
      <div className={`grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-16 gap-y-8 items-start @max-[760px]:grid-cols-1 ${HERO_PADDING}`}>
        {/* Left column: sticky heading and jump links */}
        <div className="@min-[760px]:sticky @min-[760px]:top-24 flex flex-col gap-4">
          <Heading level={1} typeRole="editorial">
            {data.hero.title}
          </Heading>
          <Text tone="secondary" typeRole="bodyLarge">{data.hero.lead}</Text>
          <nav className="flex gap-3 @max-[760px]:flex-row @min-[760px]:flex-col mt-2" aria-label="FAQ sections">
            <TextLink href="#employer-faq">{data.employerFaq.title}</TextLink>
            <TextLink href="#employee-faq">{data.employeeFaq.title}</TextLink>
          </nav>
        </div>

        {/* Right column: FAQ groups */}
        <div className="flex flex-col gap-12 max-w-[760px]">
          <section id="employer-faq" aria-labelledby="employer-faq-title">
            <Heading level={2} id="employer-faq-title" className="mb-6">
              {data.employerFaq.title}
            </Heading>
            <Accordion>
              {data.employerFaq.items.map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`employer-${i}`}
                  title={item.question}
                  headingLevel={3}
                >
                  {item.answer}
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          <section id="employee-faq" aria-labelledby="employee-faq-title">
            <Heading level={2} id="employee-faq-title" className="mb-6">
              {data.employeeFaq.title}
            </Heading>
            <Accordion>
              {data.employeeFaq.items.map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`employee-${i}`}
                  title={item.question}
                  headingLevel={3}
                >
                  {item.answer}
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        </div>
      </div>

      <CtaBand
        title={data.cta.title}
        body={data.cta.body}
        primary={data.cta.primary}
        secondary={data.cta.secondary}
      />

      <JsonLd data={faqJsonLd} />
    </main>
  );
}
