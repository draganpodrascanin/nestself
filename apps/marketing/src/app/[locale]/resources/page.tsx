import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { formatArticleDate, formatWebinarDateTime } from '@/lib/dates';
import type { PhotoKey } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { listEntries, listAssessments } from '@/content/loaders';
import { PageHero } from '@/components/sections/PageHero';
import { Heading, TextLink } from '@nestself/ui';
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

function languagesLabel(languages: string[], prefix: string): string {
  return `${prefix}: ${languages.join(', ')}`;
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
  const topWebinars = webinars.slice(0, 3);
  const topTools = tools.slice(0, 3);
  const topAssessments = assessments.slice(0, 3);

  const hasTools = topTools.length > 0 || topAssessments.length > 0;

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={data.hero.primaryCta}
        variant="quiet"
      />

      {/* Webinars section */}
      {topWebinars.length > 0 && (
        <section aria-labelledby="resources-webinars-title" className="py-16">
          <div className="mb-8 gap-4 flex items-baseline justify-between">
            <Heading level={2} id="resources-webinars-title">
              {data.sections.webinars.title}
            </Heading>
            <TextLink href={`/${locale}${data.sections.webinars.seeAllHref}`} trailingArrow>
              {data.sections.webinars.seeAllLabel}
            </TextLink>
          </div>
          <div className="gap-8 grid grid-cols-3 @max-[760px]:grid-cols-1">
            {topWebinars.map((w) => (
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
                languagesLabel={languagesLabel(w.frontmatter.languages, data.cardLabels.languages)}
                cover={{ key: w.frontmatter.cover as PhotoKey, alt: w.frontmatter.coverAlt ?? '' }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Articles section */}
      {topArticles.length > 0 && (
        <section aria-labelledby="resources-articles-title" className="py-16">
          <div className="mb-8 gap-4 flex items-baseline justify-between">
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
        <section aria-labelledby="resources-tools-title" className="py-16">
          <div className="mb-8 gap-4 flex items-baseline justify-between">
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
