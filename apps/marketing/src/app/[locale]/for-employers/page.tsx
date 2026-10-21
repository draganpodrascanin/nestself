import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections/PageHero';
import { FeatureGrid } from '@/components/sections/FeatureGrid';
import { SplitSection } from '@/components/sections/SplitSection';
import { StepsSection } from '@/components/sections/StepsSection';
import { FaqSection } from '@/components/sections/FaqSection';
import { CtaBand } from '@/components/sections/CtaBand';
import type { IconName } from '@/components/sections/icons';
import type { PhotoKey } from '@nestself/assets';
import { Text } from '@nestself/ui';
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
    pathname: '/for-employers',
  });
}

export default async function ForEmployersPage({
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
        primaryCta={data.hero.primaryCta}
        secondaryCta={data.hero.secondaryCta}
        photo={{
          key: data.hero.photo.key as PhotoKey,
          alt: data.hero.photo.alt,
        }}
        variant="split"
      />

      {data.whoBenchmark && (
        <aside className="rounded-card border border-border-subtle bg-surface-secondary px-6 py-4 mb-8">
          <Text tone="secondary">
            &ldquo;{data.whoBenchmark.quote}&rdquo;
            {' — '}
            <a
              href={data.whoBenchmark.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {data.whoBenchmark.source}
            </a>
          </Text>
        </aside>
      )}

      <FeatureGrid
        id="what-your-people-get"
        eyebrow={data.whatYourPeopleGet.eyebrow}
        title={data.whatYourPeopleGet.title}
        columns={data.whatYourPeopleGet.columns as 2 | 3}
        items={data.whatYourPeopleGet.items.map((item) => ({
          icon: item.icon as IconName,
          title: item.title,
          body: item.body,
          href: item.href,
        }))}
      />

      <SplitSection
        id="what-hr-gets"
        eyebrow={data.whatHrGets.eyebrow}
        title={data.whatHrGets.title}
        paragraphs={data.whatHrGets.paragraphs}
        bullets={data.whatHrGets.bullets}
        photo={{
          key: data.whatHrGets.photo.key as PhotoKey,
          alt: data.whatHrGets.photo.alt,
        }}
        reverse
      />

      <StepsSection
        id="how-a-launch-works"
        eyebrow={data.howALaunchWorks.eyebrow}
        title={data.howALaunchWorks.title}
        steps={data.howALaunchWorks.steps}
      />

      <SplitSection
        id="confidentiality"
        title={data.confidentiality.title}
        paragraphs={data.confidentiality.paragraphs}
        bullets={data.confidentiality.bullets}
        photo={{
          key: data.confidentiality.photo.key as PhotoKey,
          alt: data.confidentiality.photo.alt,
        }}
      />

      <FaqSection
        id="employer-faq"
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
