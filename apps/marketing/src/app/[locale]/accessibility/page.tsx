import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, localePath } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { Heading, Text, Breadcrumbs } from '@nestself/ui';
import { localizedMetadata } from '@/i18n/metadata';
import { ProseLayout } from '@/components/sections';
import { CONTACT_EMAIL } from '@/lib/contact';
import { ReadingColumn } from '@/components/reading/ReadingColumn';
import { loadContent } from './content';

interface Params {
  locale: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const { data } = await loadContent(locale as Locale);
  return localizedMetadata({
    locale: locale as Locale,
    title: data.meta.title,
    description: data.meta.description,
    pathname: '/accessibility',
  });
}

export default async function AccessibilityPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { data } = await loadContent(locale as Locale);

  const contactHintParts = data.contactHint.split('{email}');

  return (
    <main id="main" tabIndex={-1} className="@container">
      <div className="pt-8 pb-4">
        <Breadcrumbs
          label={data.breadcrumb.label}
          items={[{ label: data.breadcrumb.home, href: localePath(locale) }, { label: data.meta.title }]}
        />
      </div>

      <ReadingColumn className="py-8">
        <Heading level={1} typeRole="editorial" className="mb-6">
          {data.hero.title}
        </Heading>
        <Text typeRole="bodyLarge" tone="secondary" className="mb-8">
          {data.hero.lead}
        </Text>
      </ReadingColumn>

      <ReadingColumn>
        <ProseLayout className="py-0 [&_[data-prose]]:max-w-none">
          <div className="space-y-10">
            {data.sections.map((section, i) => (
              <section key={i} className="space-y-4">
                <Heading level={2} typeRole="sectionTitle">
                  {section.heading}
                </Heading>
                {section.paragraphs.map((p, j) => (
                  <Text key={j}>{p}</Text>
                ))}
                {section.bullets && section.bullets.length > 0 && (
                  <ul className="list-disc pl-6 space-y-2">
                    {section.bullets.map((b, k) => (
                      <li key={k}>
                        <Text as="span">{b}</Text>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            <section className="space-y-4">
              <Text>
                {contactHintParts[0]}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-primary underline underline-offset-[0.2em]"
                >
                  {CONTACT_EMAIL}
                </a>
                {contactHintParts[1]}
              </Text>
            </section>
          </div>
        </ProseLayout>
      </ReadingColumn>
    </main>
  );
}
