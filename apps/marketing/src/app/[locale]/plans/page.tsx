import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections/PageHero';
import { PlansSection } from '@/components/sections/PlansSection';
import { FeatureGrid } from '@/components/sections/FeatureGrid';
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
  const { data } = await loadContent(locale as Locale);
  return localizedMetadata({
    locale: locale as Locale,
    title: data.meta.title,
    description: data.meta.description,
    pathname: '/plans',
  });
}

export default async function PlansPage({
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
        variant="quiet"
      />

      <PlansSection
        id="plans"
        tiers={data.tiers}
        note={data.note}
      />

      <FeatureGrid
        id="in-every-plan"
        eyebrow={data.inEveryPlan.eyebrow}
        title={data.inEveryPlan.title}
        columns={data.inEveryPlan.columns as 2 | 3}
        items={data.inEveryPlan.items.map((item) => ({
          icon: item.icon as IconName,
          title: item.title,
          body: item.body,
        }))}
      />

      <FaqSection
        id="pricing-faq"
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
