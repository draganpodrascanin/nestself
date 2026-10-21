import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, locales, formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { PhotoKey } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { getEntry, listSlugs, listEntries } from '@/content/loaders';
import { renderMdx } from '@/content/mdx';
import { Breadcrumbs, Heading, Text, TextLink, PhotoFigure } from '@nestself/ui';
import { ProseLayout } from '@/components/sections/ProseLayout';
import { CtaBand } from '@/components/sections/CtaBand';
import { JsonLd } from '@/components/seo/JsonLd';
import { ArticleCard } from '@/components/cards/ArticleCard';
import { loadContent } from '../content';

interface Params {
  locale: string;
  slug: string;
}

export async function generateStaticParams() {
  const slugs = await listSlugs('articles');
  return slugs.flatMap((slug) => locales.map((locale) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const entry = await getEntry('articles', slug, locale as Locale);
  if (!entry) return {};
  return localizedMetadata({
    locale: locale as Locale,
    title: `${entry.frontmatter.title} — NestSelf`,
    description: entry.frontmatter.description,
    pathname: `/articles/${slug}`,
  });
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale: rawLocale, slug } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale as Locale;

  const entry = await getEntry('articles', slug, locale);
  if (!entry) notFound();

  const { data } = await loadContent(locale);
  const { frontmatter, body, readingMinutes } = entry;
  const mdxContent = await renderMdx(body);

  const topicLabel = data.topics[frontmatter.topic as keyof typeof data.topics] ?? frontmatter.topic;
  const serviceLink = data.serviceLinks[frontmatter.topic] ?? '/services/therapy';

  // Related articles
  const allArticles = await listEntries('articles', locale);
  const related = frontmatter.related.length > 0
    ? allArticles.filter((a) => frontmatter.related.includes(a.slug))
    : allArticles.filter((a) => a.frontmatter.topic === frontmatter.topic && a.slug !== slug).slice(0, 3);

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: frontmatter.title,
    description: frontmatter.description,
    datePublished: frontmatter.publishedAt,
    ...(frontmatter.updatedAt ? { dateModified: frontmatter.updatedAt } : {}),
    author: {
      '@type': 'Organization',
      name: frontmatter.author,
    },
    publisher: {
      '@type': 'Organization',
      name: 'NestSelf',
    },
    inLanguage: locale === 'sr-Latn' || locale === 'sr-Cyrl' ? 'sr' : locale,
  };

  return (
    <main id="main" tabIndex={-1} className="@container">
      <JsonLd data={articleJsonLd} />

      <Breadcrumbs
        label={data.detail.breadcrumbLabel}
        items={[
          { label: data.detail.breadcrumbArticles, href: `/${locale}/articles` },
          { label: frontmatter.title },
        ]}
        className="pt-8"
      />

      <article className="py-8">
        {/* Meta line */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Text as="span" typeRole="metadata" tone="secondary">
            {topicLabel}
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            &middot;
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            {formatDate(frontmatter.publishedAt, locale)}
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            &middot;
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            {data.detail.readingTime.replace('{minutes}', String(readingMinutes))}
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            &middot;
          </Text>
          <Text as="span" typeRole="metadata" tone="secondary">
            {frontmatter.author}
          </Text>
        </div>

        <Heading level={1} typeRole="marketingHero" className="mb-6">
          {frontmatter.title}
        </Heading>

        <PhotoFigure
          photo={frontmatter.cover as PhotoKey}
          alt={frontmatter.coverAlt ?? ''}
          imageRole="hero-3x2"
          sizes="(max-width: 760px) 100vw, 720px"
          priority
          className="overflow-hidden rounded-card mb-8"
        />

        <ProseLayout>{mdxContent}</ProseLayout>

        {/* Disclaimer */}
        <div className="mt-12 rounded-card border border-border-subtle p-6">
          <Text tone="secondary">
            {data.detail.disclaimerText}{' '}
            <TextLink href={`/${locale}${serviceLink}`}>
              {data.detail.disclaimerLinkText}
            </TextLink>
          </Text>
        </div>
      </article>

      {/* Related articles */}
      {related.length > 0 && (
        <section aria-labelledby="related-articles-title" className="py-16">
          <Heading level={2} id="related-articles-title" className="mb-8">
            {data.detail.relatedTitle}
          </Heading>
          <div className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1">
            {related.map((a) => (
              <ArticleCard
                key={a.slug}
                href={`/${locale}/articles/${a.slug}`}
                title={a.frontmatter.title}
                description={a.frontmatter.description}
                topicLabel={data.topics[a.frontmatter.topic as keyof typeof data.topics] ?? a.frontmatter.topic}
                readingLabel={data.detail.readingTime.replace('{minutes}', String(a.readingMinutes))}
                cover={{ key: a.frontmatter.cover as PhotoKey, alt: a.frontmatter.coverAlt ?? '' }}
                dateLabel={formatDate(a.frontmatter.publishedAt, locale)}
              />
            ))}
          </div>
        </section>
      )}

      <CtaBand
        title={data.detail.ctaBand.title}
        body={data.detail.ctaBand.body}
        primary={{
          label: data.detail.ctaBand.primaryLabel,
          href: data.detail.ctaBand.primaryHref,
        }}
        className="mb-16"
      />
    </main>
  );
}
