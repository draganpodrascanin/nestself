import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, formatLanguages } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { formatWebinarDateTime } from '@/lib/dates';
import type { PhotoKey } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { listEntries } from '@/content/loaders';
import { PageHero } from '@/components/sections/PageHero';
import { SECTION_PADDING } from '@/components/sections/section';
import { Heading, Text } from '@nestself/ui';
import { WebinarCard } from '@/components/cards/WebinarCard';
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
    pathname: '/webinars',
  });
}

export default async function WebinarsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale as Locale;

  const { data } = await loadContent(locale);
  const allWebinars = await listEntries('webinars', locale);

  const now = new Date();
  const upcoming = allWebinars
    .filter((w) => w.frontmatter.format === 'live' && new Date(w.frontmatter.startsAt) > now)
    .sort((a, b) => a.frontmatter.startsAt.localeCompare(b.frontmatter.startsAt));

  const onDemand = allWebinars.filter(
    (w) => w.frontmatter.format === 'on-demand' || (w.frontmatter.format === 'live' && new Date(w.frontmatter.startsAt) <= now),
  );

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        variant="quiet"
      />

      {/* Upcoming webinars */}
      <section aria-labelledby="upcoming-title" className={SECTION_PADDING}>
        <Heading level={2} id="upcoming-title" className="mb-8">
          {data.upcoming.title}
        </Heading>
        {upcoming.length > 0 ? (
          <div className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1">
            {upcoming.map((w) => (
              <WebinarCard
                key={w.slug}
                href={`/${locale}/webinars/${w.slug}`}
                title={w.frontmatter.title}
                description={w.frontmatter.description}
                dateLabel={formatWebinarDateTime(w.frontmatter.startsAt, locale)}
                durationLabel={data.cardLabels.minutes.replace('{n}', String(w.frontmatter.durationMinutes))}
                formatLabel={data.cardLabels.live}
                languagesLabel={formatLanguages(w.frontmatter.languages, locale)}
                cover={{ key: w.frontmatter.cover as PhotoKey, alt: w.frontmatter.coverAlt ?? '' }}
              />
            ))}
          </div>
        ) : (
          <Text tone="secondary">{data.cardLabels.noUpcoming}</Text>
        )}
      </section>

      {/* On demand */}
      {onDemand.length > 0 && (
        <section aria-labelledby="on-demand-title" className={`${SECTION_PADDING} border-t border-border-subtle`}>
          <Heading level={2} id="on-demand-title" className="mb-8">
            {data.onDemand.title}
          </Heading>
          <div className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1">
            {onDemand.map((w) => (
              <WebinarCard
                key={w.slug}
                href={`/${locale}/webinars/${w.slug}`}
                title={w.frontmatter.title}
                description={w.frontmatter.description}
                dateLabel={formatWebinarDateTime(w.frontmatter.startsAt, locale)}
                durationLabel={data.cardLabels.minutes.replace('{n}', String(w.frontmatter.durationMinutes))}
                formatLabel={data.cardLabels.onDemand}
                languagesLabel={formatLanguages(w.frontmatter.languages, locale)}
                cover={{ key: w.frontmatter.cover as PhotoKey, alt: w.frontmatter.coverAlt ?? '' }}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
