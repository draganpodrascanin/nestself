import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, localePath } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { Breadcrumbs } from '@nestself/ui';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero, StepsSection } from '@/components/sections';
import { PrivacyModelContent } from './privacy-model-content';
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
    pathname: '/privacy-model',
  });
}

export default async function PrivacyModelPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { data } = await loadContent(locale as Locale);

  return (
    <main id="main" tabIndex={-1} className="@container">
      <div className="pt-8 pb-4">
        <Breadcrumbs label={data.breadcrumb.label} items={[
          { label: data.breadcrumb.home, href: localePath(locale) },
          { label: data.meta.title },
        ]} />
      </div>

      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        variant="quiet"
      />

      <PrivacyModelContent />

      <StepsSection
        id="in-practice"
        eyebrow={data.inPractice.eyebrow}
        title={data.inPractice.title}
        steps={data.inPractice.steps}
      />
    </main>
  );
}
