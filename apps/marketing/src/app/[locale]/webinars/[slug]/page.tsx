import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, locales, formatLanguages } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { formatArticleDate, formatWebinarDateTime } from '@/lib/dates';
import type { PhotoKey } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { getEntry, listSlugs, listEntries } from '@/content/loaders';
import { renderMdx } from '@/content/mdx';
import { Breadcrumbs, Heading, Text, PhotoFigure } from '@nestself/ui';
import { ProseLayout } from '@/components/sections/ProseLayout';
import { JsonLd } from '@/components/seo/JsonLd';
import { ArticleCard } from '@/components/cards/ArticleCard';
import { WebinarRegistrationForm } from '@/components/forms/WebinarRegistrationForm';
import { ReadingColumn } from '@/components/reading/ReadingColumn';
import { loadContent } from '../content';

interface Params {
  locale: string;
  slug: string;
}

export async function generateStaticParams() {
  const slugs = await listSlugs('webinars');
  return slugs.flatMap((slug) => locales.map((locale) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const entry = await getEntry('webinars', slug, locale as Locale);
  if (!entry) return {};
  return localizedMetadata({
    locale: locale as Locale,
    title: `${entry.frontmatter.title} — NestSelf`,
    description: entry.frontmatter.description,
    pathname: `/webinars/${slug}`,
  });
}

export default async function WebinarDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale: rawLocale, slug } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale as Locale;

  const entry = await getEntry('webinars', slug, locale);
  if (!entry) notFound();

  const { data } = await loadContent(locale);
  const { frontmatter, body } = entry;
  const mdxContent = await renderMdx(body);

  const isOnDemand = frontmatter.format === 'on-demand';

  // Related articles by topic
  const allArticles = await listEntries('articles', locale);
  const relatedArticles = allArticles
    .filter((a) => a.frontmatter.topic === frontmatter.topic)
    .slice(0, 3);

  const eventJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: frontmatter.title,
    description: frontmatter.description,
    startDate: frontmatter.startsAt,
    duration: `PT${frontmatter.durationMinutes}M`,
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    organizer: {
      '@type': 'Organization',
      name: 'NestSelf',
    },
    inLanguage: frontmatter.languages,
    image: undefined as string | undefined,
  };

  return (
    <main id="main" tabIndex={-1} className="@container">
      <JsonLd data={eventJsonLd} />

      <Breadcrumbs
        label={data.detail.breadcrumbLabel}
        items={[
          { label: data.detail.breadcrumbWebinars, href: `/${locale}/webinars` },
          { label: frontmatter.title },
        ]}
        className="pt-8"
      />

      <article className="py-8">
        <ReadingColumn>
          <PhotoFigure
            photo={frontmatter.cover as PhotoKey}
            alt={frontmatter.coverAlt ?? ''}
            imageRole="hero-3x2"
            sizes="(max-width: 760px) 100vw, 720px"
            priority
            className="overflow-hidden rounded-card mb-8"
          />

          <Heading level={1} typeRole="editorial" className="mb-6">
            {frontmatter.title}
          </Heading>

          <Text typeRole="bodyLarge" tone="secondary" className="mb-8">
            {frontmatter.description}
          </Text>

          {/* Details block */}
          <dl className="grid gap-x-6 gap-y-3 mb-12 @min-[760px]:grid-cols-[auto_1fr] @max-[760px]:grid-cols-1 @max-[760px]:gap-y-1">
            <dt className="type-metadata text-text-secondary @min-[760px]:type-label">{data.detail.dateLabel}</dt>
            <dd className="type-body @max-[760px]:mb-3">
              {formatWebinarDateTime(frontmatter.startsAt, locale)}
            </dd>

            <dt className="type-metadata text-text-secondary @min-[760px]:type-label">{data.detail.durationLabel}</dt>
            <dd className="type-body @max-[760px]:mb-3">
              {frontmatter.durationMinutes} {data.detail.minutesSuffix}
            </dd>

            <dt className="type-metadata text-text-secondary @min-[760px]:type-label">{data.detail.formatLabel}</dt>
            <dd className="type-body @max-[760px]:mb-3">
              {frontmatter.format === 'live' ? data.cardLabels.live : data.cardLabels.onDemand}
            </dd>

            <dt className="type-metadata text-text-secondary @min-[760px]:type-label">{data.detail.languagesLabel}</dt>
            <dd className="type-body @max-[760px]:mb-3">
              {formatLanguages(frontmatter.languages, locale)}
            </dd>

            <dt className="type-metadata text-text-secondary @min-[760px]:type-label">{data.detail.speakerLabel}</dt>
            <dd className="type-body">
              {frontmatter.speaker.role} ({data.topics[frontmatter.speaker.area as keyof typeof data.topics]})
            </dd>
          </dl>

          <ProseLayout className="py-0 [&_[data-prose]]:max-w-none">
            {mdxContent}
          </ProseLayout>

          {/* Registration form or on-demand note */}
          <div className="mt-12 mb-12">
            {isOnDemand ? (
              <div className="rounded-card border border-border-subtle p-8">
                <Heading level={2} typeRole="sectionTitle" className="mb-3">
                  {data.detail.watchRecordingTitle}
                </Heading>
                <Text tone="secondary">
                  {data.detail.watchRecordingBody}
                </Text>
              </div>
            ) : (
              <div className="rounded-card border border-border-subtle p-8">
                <Heading level={2} typeRole="sectionTitle" className="mb-6">
                  {data.detail.registerTitle}
                </Heading>
                <WebinarRegistrationForm
                  webinarSlug={slug}
                  locale={locale}
                  labels={data.form}
                />
              </div>
            )}
          </div>
        </ReadingColumn>
      </article>

      {/* Related articles */}
      {relatedArticles.length > 0 && (
        <section
          aria-labelledby="related-articles-title"
          className="border-t border-border-subtle pt-12 pb-16"
        >
          <Heading level={2} id="related-articles-title" className="mb-8">
            {data.detail.relatedTitle}
          </Heading>
          <div className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1">
            {relatedArticles.map((a) => (
              <ArticleCard
                key={a.slug}
                href={`/${locale}/articles/${a.slug}`}
                title={a.frontmatter.title}
                description={a.frontmatter.description}
                topicLabel={data.topics[a.frontmatter.topic as keyof typeof data.topics] ?? a.frontmatter.topic}
                readingLabel={data.detail.readingTime.replace('{minutes}', String(a.readingMinutes))}
                cover={{ key: a.frontmatter.cover as PhotoKey, alt: a.frontmatter.coverAlt ?? '' }}
                dateLabel={formatArticleDate(a.frontmatter.publishedAt, locale)}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
