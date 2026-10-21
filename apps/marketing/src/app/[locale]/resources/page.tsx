import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, formatLanguages } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { formatArticleDate, formatWebinarDateTime } from '@/lib/dates';
import type { PhotoKey } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { listEntries, listAssessments } from '@/content/loaders';
import { PageHero } from '@/components/sections/PageHero';
import { SECTION_PADDING } from '@/components/sections/section';
import { Card, Heading, Text, TextLink, PhotoFigure } from '@nestself/ui';
import { ArticleCard } from '@/components/cards/ArticleCard';
import { WebinarCard } from '@/components/cards/WebinarCard';
import { ToolCard } from '@/components/cards/ToolCard';
import { AssessmentCard } from '@/components/cards/AssessmentCard';
import { loadContent } from './content';

interface Params {
  locale: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const { data } = await loadContent(locale as Locale);
  return localizedMetadata({
    locale: locale as Locale,
    title: data.meta.title,
    description: data.meta.description,
    pathname: '/resources',
  });
}

function webinarFormatLabel(
  format: 'live' | 'on-demand',
  labels: { live: string; onDemand: string },
): string {
  return format === 'live' ? labels.live : labels.onDemand;
}

function durationLabel(minutes: number, template: string): string {
  return template.replace('{n}', String(minutes));
}

function readingTimeLabel(minutes: number, template: string): string {
  return template.replace('{minutes}', String(minutes));
}

export default async function ResourcesPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale as Locale;

  const { data } = await loadContent(locale);

  const [articles, webinars, tools, assessments] = await Promise.all([
    listEntries('articles', locale),
    listEntries('webinars', locale),
    listEntries('tools', locale),
    listAssessments(locale),
  ]);

  const topArticles = articles.slice(0, 3);
  const topTools = tools.slice(0, 3);
  const topAssessments = assessments.slice(0, 3);

  // Featured upcoming webinar: live format, starts in the future, earliest first
  const now = new Date();
  const featuredWebinar = webinars.find(
    (w) => w.frontmatter.format === 'live' && new Date(w.frontmatter.startsAt) > now,
  );
  // Grid shows up to 3 webinars, excluding the featured one to avoid duplication
  const gridWebinars = webinars
    .filter((w) => !featuredWebinar || w.slug !== featuredWebinar.slug)
    .slice(0, 3);

  const hasTools = topTools.length > 0 || topAssessments.length > 0;

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        variant="quiet"
      />

      {/* Webinars section */}
      {webinars.length > 0 && (
        <section aria-labelledby="resources-webinars-title" className={SECTION_PADDING}>
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <Heading level={2} id="resources-webinars-title">
              {data.sections.webinars.title}
            </Heading>
            <TextLink href={`/${locale}${data.sections.webinars.seeAllHref}`} trailingArrow>
              {data.sections.webinars.seeAllLabel}
            </TextLink>
          </div>

          {/* Featured upcoming webinar wide card */}
          {featuredWebinar && (
            <Card
              as="article"
              interactive
              padding="none"
              className="mb-6 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @max-[760px]:grid-cols-1 overflow-hidden"
            >
              <PhotoFigure
                photo={featuredWebinar.frontmatter.cover as PhotoKey}
                alt={featuredWebinar.frontmatter.coverAlt ?? ''}
                imageRole="card"
                sizes="(max-width: 760px) 100vw, 66vw"
                className="h-full [&_img]:h-full [&_img]:object-cover"
              />
              <div className="flex flex-col justify-center gap-3 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Text as="span" typeRole="metadata" tone="secondary">
                    {webinarFormatLabel(featuredWebinar.frontmatter.format, data.cardLabels)}
                  </Text>
                  <Text as="span" typeRole="metadata" tone="secondary">
                    &middot;
                  </Text>
                  <Text as="span" typeRole="metadata" tone="secondary">
                    {durationLabel(featuredWebinar.frontmatter.durationMinutes, data.cardLabels.minutes)}
                  </Text>
                  <Text as="span" typeRole="metadata" tone="secondary">
                    &middot;
                  </Text>
                  <Text as="span" typeRole="metadata" tone="secondary">
                    {formatLanguages(featuredWebinar.frontmatter.languages, locale)}
                  </Text>
                </div>
                <Heading level={3} typeRole="sectionTitle">
                  <TextLink href={`/${locale}/webinars/${featuredWebinar.slug}`}>
                    {featuredWebinar.frontmatter.title}
                  </TextLink>
                </Heading>
                <Text tone="secondary">{featuredWebinar.frontmatter.description}</Text>
                <Text as="span" typeRole="metadata" tone="secondary">
                  {formatWebinarDateTime(featuredWebinar.frontmatter.startsAt, locale)}
                </Text>
              </div>
            </Card>
          )}

          {gridWebinars.length > 0 && (
            <div className="gap-8 grid grid-cols-3 @max-[760px]:grid-cols-1">
              {gridWebinars.map((w) => (
                <WebinarCard
                  key={w.slug}
                  href={`/${locale}/webinars/${w.slug}`}
                  title={w.frontmatter.title}
                  description={w.frontmatter.description}
                  dateLabel={formatWebinarDateTime(w.frontmatter.startsAt, locale)}
                  durationLabel={durationLabel(
                    w.frontmatter.durationMinutes,
                    data.cardLabels.minutes,
                  )}
                  formatLabel={webinarFormatLabel(w.frontmatter.format, data.cardLabels)}
                  languagesLabel={formatLanguages(w.frontmatter.languages, locale)}
                  cover={{ key: w.frontmatter.cover as PhotoKey, alt: w.frontmatter.coverAlt ?? '' }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Articles section */}
      {topArticles.length > 0 && (
        <section aria-labelledby="resources-articles-title" className={SECTION_PADDING}>
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <Heading level={2} id="resources-articles-title">
              {data.sections.articles.title}
            </Heading>
            <TextLink href={`/${locale}${data.sections.articles.seeAllHref}`} trailingArrow>
              {data.sections.articles.seeAllLabel}
            </TextLink>
          </div>
          <div className="gap-8 grid grid-cols-3 @max-[760px]:grid-cols-1">
            {topArticles.map((a) => (
              <ArticleCard
                key={a.slug}
                href={`/${locale}/articles/${a.slug}`}
                title={a.frontmatter.title}
                description={a.frontmatter.description}
                topicLabel={
                  data.topics[a.frontmatter.topic as keyof typeof data.topics] ??
                  a.frontmatter.topic
                }
                readingLabel={readingTimeLabel(a.readingMinutes, data.cardLabels.readingTime)}
                cover={{ key: a.frontmatter.cover as PhotoKey, alt: a.frontmatter.coverAlt ?? '' }}
                dateLabel={formatArticleDate(a.frontmatter.publishedAt, locale)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Tools section - only when non-empty */}
      {hasTools && (
        <section aria-labelledby="resources-tools-title" className={SECTION_PADDING}>
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <Heading level={2} id="resources-tools-title">
              {data.sections.tools.title}
            </Heading>
            <TextLink href={`/${locale}${data.sections.tools.seeAllHref}`} trailingArrow>
              {data.sections.tools.seeAllLabel}
            </TextLink>
          </div>
          <div className="gap-8 grid grid-cols-3 @max-[760px]:grid-cols-1">
            {topTools.map((t) => (
              <ToolCard
                key={t.slug}
                href={`/${locale}/tools/${t.slug}`}
                title={t.frontmatter.title}
                description={t.frontmatter.description}
                kindLabel={data.kindLabels[t.frontmatter.kind]}
                cover={{ key: t.frontmatter.cover as PhotoKey, alt: t.frontmatter.coverAlt ?? '' }}
              />
            ))}
            {topAssessments.map((a) => (
              <AssessmentCard
                key={a.slug}
                href={`/${locale}/tools/${a.slug}`}
                title={a.data.title}
                intro={a.data.intro}
                slug={a.slug}
                durationLabel={durationLabel(a.data.durationMinutes, data.cardLabels.minutes)}
                questionsLabel={data.cardLabels.questionsLabel.replace(
                  '{n}',
                  String(a.data.questions.length),
                )}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
