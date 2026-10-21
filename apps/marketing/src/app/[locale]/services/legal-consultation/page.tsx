import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { PhotoKey } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections/PageHero';
import { FeatureGrid } from '@/components/sections/FeatureGrid';
import { StepsSection } from '@/components/sections/StepsSection';
import { SplitSection } from '@/components/sections/SplitSection';
import { FaqSection } from '@/components/sections/FaqSection';
import { CtaBand } from '@/components/sections/CtaBand';
import type { IconName } from '@/components/sections/icons';
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
  const { data } = await loadContent(locale);
  return localizedMetadata({
    locale,
    title: data.meta.title,
    description: data.meta.description,
    pathname: '/services/legal-consultation',
  });
}

export default async function LegalConsultationPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { data } = await loadContent(locale as Locale);

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={data.hero.primaryCta}
        secondaryCta={data.hero.secondaryCta}
        photo={{ key: 'legal-consultation' as PhotoKey, alt: 'A legal consultation session at a desk' }}
        variant="split"
      />

      <FeatureGrid
        id="covers"
        eyebrow={data.covers.eyebrow}
        title={data.covers.title}
        columns={data.covers.columns}
        items={data.covers.items.map((item) => ({
          ...item,
          icon: item.icon as IconName,
        }))}
      />

      <StepsSection
        id="how-it-works"
        title={data.howItWorks.title}
        steps={data.howItWorks.steps}
      />

      <SplitSection
        id={data.whatItIsNot.id}
        title={data.whatItIsNot.title}
        paragraphs={data.whatItIsNot.paragraphs}
        bullets={data.whatItIsNot.bullets}
        photo={{
          key: data.whatItIsNot.photo.key as PhotoKey,
          alt: data.whatItIsNot.photo.alt,
        }}
      />

      <FaqSection
        id="faq"
        title={data.faq.title}
        items={data.faq.items}
      />

      <CtaBand
        title={data.cta.title}
        body={data.cta.body}
        primary={data.cta.primary}
        secondary={data.cta.secondary}
      />
    </main>
  );
}
