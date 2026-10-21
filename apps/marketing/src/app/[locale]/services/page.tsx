import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { PhotoKey } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections/PageHero';
import { SplitSection } from '@/components/sections/SplitSection';
import { StepsSection } from '@/components/sections/StepsSection';
import { FaqSection } from '@/components/sections/FaqSection';
import { CtaBand } from '@/components/sections/CtaBand';
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
    pathname: '/services',
  });
}

export default async function ServicesPage({
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
        photo={{ key: 'home-hero-office' as PhotoKey, alt: 'A modern, bright office space' }}
        variant="quiet"
      />

      {data.pillars.map((pillar, i) => (
        <SplitSection
          key={pillar.id}
          id={pillar.id}
          title={pillar.title}
          paragraphs={pillar.paragraphs}
          photo={{
            key: pillar.photo.key as PhotoKey,
            alt: pillar.photo.alt,
          }}
          reverse={i % 2 === 1}
          cta={pillar.cta}
        />
      ))}

      <StepsSection
        id="how-it-works"
        title={data.steps.title}
        steps={data.steps.items}
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
