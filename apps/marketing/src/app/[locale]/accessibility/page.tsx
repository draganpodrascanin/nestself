import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { Breadcrumbs } from '@nestself/ui';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero, ProseLayout } from '@/components/sections';
import { CONTACT_EMAIL } from '@/lib/contact';
import { loadContent } from './content';

interface Params { locale: string }

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
        <Breadcrumbs label={data.breadcrumb.label} items={[
          { label: data.breadcrumb.home, href: `/${locale}` },
          { label: data.meta.title },
        ]} />
      </div>

      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={{ label: '', href: '' }}
        variant="quiet"
        className="[&_[class*=flex-wrap]]:hidden"
      />

      <ProseLayout>
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

        <section>
          <p>
            {contactHintParts[0]}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            {contactHintParts[1]}
          </p>
        </section>
      </ProseLayout>
    </main>
  );
}
