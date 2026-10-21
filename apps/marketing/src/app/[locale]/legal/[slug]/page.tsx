import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { Heading, Text, Breadcrumbs } from '@nestself/ui';
import { localizedMetadata } from '@/i18n/metadata';
import { ProseLayout } from '@/components/sections';
import { isLegalPageSlug, loadLegalContent, type LegalPageSlug } from '../content';

interface Params { locale: string; slug: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !isLegalPageSlug(slug)) return {};
  const { data } = await loadLegalContent(slug as LegalPageSlug, locale as Locale);
  return localizedMetadata({
    locale: locale as Locale,
    title: data.meta.title,
    description: data.meta.description,
    pathname: `/legal/${slug}`,
  });
}

export default async function LegalPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !isLegalPageSlug(slug)) notFound();

  const typedLocale = locale as Locale;
  const { data } = await loadLegalContent(slug as LegalPageSlug, typedLocale);

  return (
    <main id="main" tabIndex={-1} className="@container">
      <div className="pt-8 pb-4">
        <Breadcrumbs label={data.breadcrumb.label} items={[
          { label: data.breadcrumb.home, href: `/${locale}` },
          { label: data.meta.title },
        ]} />
      </div>

      <div className="py-8">
        <Heading level={1} typeRole="editorial">
          {data.title}
        </Heading>
        <Text typeRole="metadata" tone="secondary" className="mt-2">
          {data.updatedAtLabel} {formatDate(data.updatedAt, typedLocale)}
        </Text>
      </div>

      <ProseLayout>
        <Text typeRole="bodyLarge" tone="secondary">{data.intro}</Text>

        <div className="space-y-10 mt-10">
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
        </div>
      </ProseLayout>
    </main>
  );
}
