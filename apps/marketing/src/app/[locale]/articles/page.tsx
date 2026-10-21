import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { PhotoKey } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { listEntries } from '@/content/loaders';
import { PageHero } from '@/components/sections/PageHero';
import { ArticleCard } from '@/components/cards/ArticleCard';
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
    pathname: '/articles',
  });
}

const VALID_TOPICS = ['psychological', 'legal', 'financial', 'work', 'family', 'managers'] as const;
type Topic = (typeof VALID_TOPICS)[number];

function isValidTopic(value: unknown): value is Topic {
  return typeof value === 'string' && VALID_TOPICS.includes(value as Topic);
}

export default async function ArticlesPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale as Locale;

  const { data } = await loadContent(locale);
  const resolvedSearch = await searchParams;
  const rawTopic = resolvedSearch.topic;
  const topicFilter = isValidTopic(rawTopic) ? rawTopic : null;

  const allArticles = await listEntries('articles', locale);
  const filtered = topicFilter
    ? allArticles.filter((a) => a.frontmatter.topic === topicFilter)
    : allArticles;

  const chipBase =
    'inline-flex items-center gap-1.5 min-h-11 rounded-control border border-border-control bg-surface text-text px-3 py-1.5 type-body transition-colors no-underline hover:border-primary hover:text-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:min-h-12';

  const activeClasses = 'border-primary bg-primary text-on-primary';

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={data.hero.primaryCta}
        variant="quiet"
      />

      <section className="py-16">
        <nav aria-label={data.filterLabel}>
          <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
            <li>
              <a
                href={`/${locale}/articles`}
                aria-current={topicFilter === null ? 'page' : undefined}
                className={`${chipBase} ${topicFilter === null ? activeClasses : ''}`}
              >
                {data.allTopicsLabel}
              </a>
            </li>
            {Object.entries(data.topics).map(([key, label]) => (
              <li key={key}>
                <a
                  href={`/${locale}/articles?topic=${key}`}
                  aria-current={topicFilter === key ? 'page' : undefined}
                  className={`${chipBase} ${topicFilter === key ? activeClasses : ''}`}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1">
          {filtered.map((a) => (
            <ArticleCard
              key={a.slug}
              href={`/${locale}/articles/${a.slug}`}
              title={a.frontmatter.title}
              description={a.frontmatter.description}
              topicLabel={data.topics[a.frontmatter.topic as keyof typeof data.topics] ?? a.frontmatter.topic}
              readingLabel={data.cardLabels.readingTime.replace('{minutes}', String(a.readingMinutes))}
              cover={{ key: a.frontmatter.cover as PhotoKey, alt: a.frontmatter.coverAlt }}
              dateLabel={formatDate(a.frontmatter.publishedAt, locale)}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
