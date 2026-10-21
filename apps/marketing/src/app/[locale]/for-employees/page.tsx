import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections/PageHero';
import { FeatureGrid } from '@/components/sections/FeatureGrid';
import { StepsSection } from '@/components/sections/StepsSection';
import { SplitSection } from '@/components/sections/SplitSection';
import { FaqSection } from '@/components/sections/FaqSection';
import { CtaBand } from '@/components/sections/CtaBand';
import type { IconName } from '@/components/sections/icons';
import type { PhotoKey } from '@nestself/assets';
import { WORKSPACE_URL } from '@/lib/site';
import { loadContent } from './content';

interface Params {
  locale: string;
}

function resolveHref(href: string): string {
  return href === '__WORKSPACE_URL__' ? WORKSPACE_URL : href;
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
    pathname: '/for-employees',
  });
}

export default async function ForEmployeesPage({
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
        eyebrow={data.hero.eyebrow}
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={{
          label: data.hero.primaryCta.label,
          href: resolveHref(data.hero.primaryCta.href),
        }}
        secondaryCta={
          data.hero.secondaryCta
            ? {
                label: data.hero.secondaryCta.label,
                href: resolveHref(data.hero.secondaryCta.href),
              }
            : undefined
        }
        photo={{
          key: data.hero.photo.key as PhotoKey,
          alt: data.hero.photo.alt,
        }}
        variant="split"
      />

      <FeatureGrid
        id="what-you-can-use"
        eyebrow={data.whatYouCanUse.eyebrow}
        title={data.whatYouCanUse.title}
        columns={data.whatYouCanUse.columns as 2 | 3}
        items={data.whatYouCanUse.items.map((item) => ({
          icon: item.icon as IconName,
          title: item.title,
          body: item.body,
          href: item.href,
        }))}
      />

      <StepsSection
        id="how-to-start"
        eyebrow={data.howToStart.eyebrow}
        title={data.howToStart.title}
        steps={data.howToStart.steps}
      />

      <SplitSection
        id="who-sees-what"
        title={data.whoSeesWhat.title}
        paragraphs={data.whoSeesWhat.paragraphs}
        bullets={data.whoSeesWhat.bullets}
        cta={data.whoSeesWhat.cta}
        photo={{
          key: data.whoSeesWhat.photo.key as PhotoKey,
          alt: data.whoSeesWhat.photo.alt,
        }}
      />

      <SplitSection
        id="for-your-family"
        title={data.forYourFamily.title}
        paragraphs={data.forYourFamily.paragraphs}
        photo={{
          key: data.forYourFamily.photo.key as PhotoKey,
          alt: data.forYourFamily.photo.alt,
        }}
        reverse
      />

      <FaqSection
        id="employee-faq"
        title={data.faq.title}
        items={data.faq.items}
      />

      <CtaBand
        title={data.cta.title}
        body={data.cta.body}
        primary={{
          label: data.cta.primary.label,
          href: resolveHref(data.cta.primary.href),
        }}
        secondary={
          data.cta.secondary
            ? {
                label: data.cta.secondary.label,
                href: resolveHref(data.cta.secondary.href),
              }
            : undefined
        }
      />
    </main>
  );
}
