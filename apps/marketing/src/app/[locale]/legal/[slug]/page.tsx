import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
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

  const { data } = await loadLegalContent(slug as LegalPageSlug, locale as Locale);

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
          {data.updatedAtLabel} {data.updatedAt}
        </Text>
      </div>

      <ProseLayout>
        <p className="type-body-large text-text-secondary">{data.intro}</p>

        {data.sections.map((section, i) => (
          <section key={i}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((p, j) => (
              <p key={j}>{p}</p>
            ))}
            {section.bullets && section.bullets.length > 0 && (
              <ul>
                {section.bullets.map((b, k) => (
                  <li key={k}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </ProseLayout>
    </main>
  );
}
