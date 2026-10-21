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
import { SECTION_PADDING } from '@/components/sections/section';
import { Card, Heading, Text, TextLink, PhotoFigure } from '@nestself/ui';
import { iconMap, type IconName } from '@/components/sections/icons';
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

  const [featured, ...secondary] = data.pillars;

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={data.hero.primaryCta}
        secondaryCta={data.hero.secondaryCta}
        photo={{ key: 'home-hero-office' as PhotoKey, alt: 'A modern, bright office space' }}
        variant="split"
      />

      {/* Featured pillar (therapy) as a SplitSection */}
      {featured && (
        <SplitSection
          id={featured.id}
          title={featured.title}
          paragraphs={featured.paragraphs}
          photo={{
            key: featured.photo.key as PhotoKey,
            alt: featured.photo.alt,
          }}
          cta={featured.cta}
        />
      )}

      {/* Secondary pillars as side-by-side Cards */}
      {secondary.length > 0 && (
        <div className={`grid grid-cols-2 gap-6 @max-[760px]:grid-cols-1 ${SECTION_PADDING}`}>
          {secondary.map((pillar) => {
            const Icon = pillar.icon ? iconMap[pillar.icon as IconName] : undefined;
            return (
              <Card key={pillar.id} as="article" padding="none" className="flex flex-col overflow-hidden">
                <PhotoFigure
                  photo={pillar.photo.key as PhotoKey}
                  alt={pillar.photo.alt}
                  imageRole="card"
                  sizes="(max-width: 760px) 100vw, 50vw"
                  className="overflow-hidden rounded-t-card"
                />
                <div className="flex flex-1 flex-col gap-3 p-5">
                  {Icon && (
                    <div className="w-11 h-11 rounded-control bg-accent-soft text-primary grid place-items-center">
                      <Icon size={24} aria-hidden />
                    </div>
                  )}
                  <Heading level={3} typeRole="sectionTitle">
                    {pillar.title}
                  </Heading>
                  <Text tone="secondary">{pillar.paragraphs[0]}</Text>
                  {pillar.cta && (
                    <TextLink href={pillar.cta.href} trailingArrow className="mt-auto">
                      {pillar.cta.label}
                    </TextLink>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

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
