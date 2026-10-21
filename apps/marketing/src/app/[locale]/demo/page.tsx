import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { Heading, Text } from '@nestself/ui';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections';
import { CONTACT_EMAIL } from '@/lib/contact';
import { DemoRequestForm } from '@/components/forms/DemoRequestForm';
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
    pathname: '/demo',
  });
}

export default async function DemoPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { data } = await loadContent(locale as Locale);

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={{ label: '', href: '' }}
        variant="quiet"
        className="[&_[class*=flex-wrap]]:hidden"
      />

      <div className="grid gap-12 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @max-[760px]:grid-cols-1 pb-16">
        <DemoRequestForm locale={locale as Locale} content={data.form} />

        <aside className="flex flex-col gap-8">
          <div>
            <Heading level={2} typeRole="sectionTitle" className="mb-4">
              {data.aside.title}
            </Heading>
            <ol className="flex flex-col gap-4">
              {data.aside.steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="type-label text-primary shrink-0">{i + 1}.</span>
                  <div>
                    <Text className="font-[var(--font-weight-label)]">{step.title}</Text>
                    <Text tone="secondary">{step.body}</Text>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="border-t border-border-subtle pt-6">
            <Heading level={3} typeRole="sectionTitle" className="mb-2">
              {data.aside.contactTitle}
            </Heading>
            <Text tone="secondary">
              {data.aside.contactBody}{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                {CONTACT_EMAIL}
              </a>
            </Text>
          </div>
        </aside>
      </div>
    </main>
  );
}
