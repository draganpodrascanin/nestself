import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { formatArticleDate, formatWebinarDateTime } from '@/lib/dates';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections/PageHero';
import { FeatureGrid } from '@/components/sections/FeatureGrid';
import { StepsSection } from '@/components/sections/StepsSection';
import { ResourceTeasers } from '@/components/sections/ResourceTeasers';
import { CtaBand } from '@/components/sections/CtaBand';
import type { IconName } from '@/components/sections/icons';
import type { PhotoKey } from '@nestself/assets';
import { listEntries } from '@/content/loaders';
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
    pathname: '/for-managers',
  });
}

export default async function ForManagersPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const loc = locale as Locale;
  const { data } = await loadContent(loc);

  // Fetch manager-topic resources (may be empty)
  const articles = await listEntries('articles', loc);
  const managerArticles = articles
    .filter((a) => a.frontmatter.topic === 'managers')
    .slice(0, 3)
    .map((a) => ({
      href: `/${locale}/articles/${a.slug}`,
      title: a.frontmatter.title,
      description: a.frontmatter.description,
      topicLabel: 'Managers',
      readingLabel: `${a.readingMinutes} min read`,
      cover: { key: a.frontmatter.cover as PhotoKey, alt: a.frontmatter.coverAlt },
      dateLabel: formatArticleDate(a.frontmatter.publishedAt, loc),
    }));

  const webinars = await listEntries('webinars', loc);
  const managerWebinars = webinars
    .filter((w) => w.frontmatter.topic === 'managers')
    .slice(0, 3)
    .map((w) => ({
      href: `/${locale}/webinars/${w.slug}`,
      title: w.frontmatter.title,
      description: w.frontmatter.description,
      dateLabel: formatWebinarDateTime(w.frontmatter.startsAt, loc),
      durationLabel: `${w.frontmatter.durationMinutes} min`,
      formatLabel: w.frontmatter.format,
      languagesLabel: w.frontmatter.languages.join(', '),
      cover: { key: w.frontmatter.cover as PhotoKey, alt: w.frontmatter.coverAlt },
    }));

  const tools = await listEntries('tools', loc);
  const managerTools = tools
    .filter((t) => t.frontmatter.topic === 'managers')
    .slice(0, 3)
    .map((t) => ({
      href: `/${locale}/tools/${t.slug}`,
      title: t.frontmatter.title,
      description: t.frontmatter.description,
      kindLabel: t.frontmatter.kind,
      cover: { key: t.frontmatter.cover as PhotoKey, alt: t.frontmatter.coverAlt },
    }));

  const hasResources =
    managerArticles.length > 0 ||
    managerWebinars.length > 0 ||
    managerTools.length > 0;

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

      <FeatureGrid
        id="manager-features"
        eyebrow={data.features.eyebrow}
        title={data.features.title}
        columns={data.features.columns as 2 | 3}
        items={data.features.items.map((item) => ({
          icon: item.icon as IconName,
          title: item.title,
          body: item.body,
          href: item.href,
        }))}
      />

      <StepsSection
        id="supporting-someone"
        eyebrow={data.steps.eyebrow}
        title={data.steps.title}
        steps={data.steps.steps}
      />

      {hasResources && (
        <ResourceTeasers
          id="manager-resources"
          title={data.resources.title}
          articles={managerArticles}
          webinars={managerWebinars}
          tools={managerTools}
          moreHref={data.resources.moreHref}
          moreLabel={data.resources.moreLabel}
        />
      )}

      <CtaBand
        title={data.cta.title}
        body={data.cta.body}
        primary={data.cta.primary}
        secondary={data.cta.secondary}
      />
    </main>
  );
}
