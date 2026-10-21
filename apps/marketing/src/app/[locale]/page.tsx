import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { formatArticleDate, formatWebinarDateTime } from '@/lib/dates';
import { getServerT } from '@/i18n/server';
import { localizedMetadata } from '@/i18n/metadata';
import { loadContent } from './content';
import {
  PageHero,
  TrustStrip,
  FeatureGrid,
  StepsSection,
  SplitSection,
  FaqSection,
  CtaBand,
  TestimonialsSection,
  ResourceTeasers,
} from '@/components/sections';
import { PrivacySection } from '@/components/sections/PrivacySection';
import { listEntries, listAssessments } from '@/content/loaders';
import { SAMPLE_TESTIMONIALS } from '@nestself/sample-data';
import { AssessmentCard } from '@/components/cards/AssessmentCard';
import type { AssessmentCardProps } from '@/components/cards/AssessmentCard';
import type { IconName } from '@/components/sections';
import type { ArticleCardProps } from '@/components/cards/ArticleCard';
import type { WebinarCardProps } from '@/components/cards/WebinarCard';
import type { ToolCardProps } from '@/components/cards/ToolCard';
import type { PhotoKey } from '@nestself/assets';
import { Heading } from '@nestself/ui';

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
    pathname: '',
  });
}

export default async function HomePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const typedLocale = locale as Locale;
  const { data } = await loadContent(typedLocale);
  const { t } = await getServerT(typedLocale);

  // Load resources for teasers
  const [articles, webinars, assessments] = await Promise.all([
    listEntries('articles', typedLocale),
    listEntries('webinars', typedLocale),
    listAssessments(typedLocale),
  ]);
  const articleCards: ArticleCardProps[] = articles.slice(0, 3).map((a) => ({
    href: `/${locale}/articles/${a.slug}`,
    title: a.frontmatter.title,
    description: a.frontmatter.description,
    topicLabel: t(`marketing:topics.${a.frontmatter.topic}`),
    readingLabel: t('marketing:labels.readingTime', { minutes: a.readingMinutes }),
    cover: { key: a.frontmatter.cover as PhotoKey, alt: a.frontmatter.coverAlt },
    dateLabel: formatArticleDate(a.frontmatter.publishedAt, typedLocale),
  }));

  const webinarCards: WebinarCardProps[] = webinars.slice(0, 3).map((w) => ({
    href: `/${locale}/webinars/${w.slug}`,
    title: w.frontmatter.title,
    description: w.frontmatter.description,
    dateLabel: formatWebinarDateTime(w.frontmatter.startsAt, typedLocale),
    durationLabel: t('marketing:labels.minutes', {
      count: w.frontmatter.durationMinutes,
    }),
    formatLabel:
      w.frontmatter.format === 'live'
        ? t('marketing:labels.live')
        : t('marketing:labels.onDemand'),
    languagesLabel: w.frontmatter.languages.join(', '),
    cover: { key: w.frontmatter.cover as PhotoKey, alt: w.frontmatter.coverAlt },
  }));

  const toolCards: ToolCardProps[] = [];

  // ResourceTeasers does not accept an assessments prop, so assessment cards
  // are rendered separately below the resource teasers when available.
  const assessmentCards: AssessmentCardProps[] = assessments.slice(0, 3).map((a) => ({
    href: `/${locale}/tools/${a.slug}`,
    title: a.data.title,
    intro: a.data.intro,
    durationLabel: t('marketing:labels.minutes', { count: a.data.durationMinutes }),
    questionsLabel: t('marketing:labels.questions', { count: a.data.questions.length }),
  }));

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        variant="collage"
        eyebrow={data.hero.eyebrow}
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={{
          label: data.hero.primaryCta,
          href: `/${locale}/demo`,
        }}
        secondaryCta={{
          label: data.hero.secondaryCta,
          href: `/${locale}/for-employees`,
        }}
        photos={[
          {
            key: data.hero.photos[0].key as PhotoKey,
            alt: data.hero.photos[0].alt,
          },
          {
            key: data.hero.photos[1].key as PhotoKey,
            alt: data.hero.photos[1].alt,
          },
          {
            key: data.hero.photos[2].key as PhotoKey,
            alt: data.hero.photos[2].alt,
          },
        ]}
      />

      <TrustStrip
        ariaLabel={t('marketing:labels.keyFacts')}
        items={data.trust.map((item) => ({
          icon: item.icon as IconName,
          label: item.label,
        }))}
      />

      <FeatureGrid
        id="services"
        eyebrow={data.services.eyebrow}
        title={data.services.title}
        lead={data.services.lead}
        columns={3}
        items={data.services.items.map((item) => ({
          icon: item.icon as IconName,
          title: item.title,
          body: item.body,
          href: `/${locale}${item.href}`,
        }))}
      />

      <StepsSection
        id="how-it-works"
        eyebrow={data.steps.eyebrow}
        title={data.steps.title}
        steps={data.steps.steps}
      />

      <SplitSection
        id="employers"
        eyebrow={data.employers.eyebrow}
        title={data.employers.title}
        paragraphs={data.employers.paragraphs}
        bullets={data.employers.bullets}
        photo={{
          key: data.employers.photo.key as PhotoKey,
          alt: data.employers.photo.alt,
        }}
        cta={{
          label: data.employers.cta.label,
          href: `/${locale}${data.employers.cta.href}`,
        }}
      />

      <SplitSection
        id="life-beyond-work"
        eyebrow={data.life.eyebrow}
        title={data.life.title}
        paragraphs={data.life.paragraphs}
        photo={{
          key: data.life.photo.key as PhotoKey,
          alt: data.life.photo.alt,
        }}
        reverse
      />

      {(articleCards.length > 0 || webinarCards.length > 0) && (
        <ResourceTeasers
          id="resources"
          title={data.resources.title}
          articles={articleCards}
          webinars={webinarCards}
          tools={toolCards}
          moreHref={`/${locale}/resources`}
          moreLabel={data.resources.moreLabel}
        />
      )}

      {assessmentCards.length > 0 && (
        <section className="py-16" aria-labelledby="assessments-heading">
          <Heading id="assessments-heading" level={2} typeRole="sectionTitle" className="mb-8 text-center">
            {data.assessments?.title ?? t('marketing:actions.startAssessment')}
          </Heading>
          <div className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1">
            {assessmentCards.map((card) => (
              <AssessmentCard key={card.href} {...card} />
            ))}
          </div>
        </section>
      )}

      <TestimonialsSection
        id="testimonials"
        title={data.testimonials.title}
        lead={data.testimonials.lead}
        items={SAMPLE_TESTIMONIALS}
        locale={typedLocale}
      />

      <PrivacySection locale={typedLocale} />

      <FaqSection id="faq" title={data.faq.title} items={data.faq.items} />

      <CtaBand
        id="cta"
        title={data.ctaBand.title}
        body={data.ctaBand.body}
        primary={{
          label: data.ctaBand.primary.label,
          href: `/${locale}${data.ctaBand.primary.href}`,
        }}
        secondary={
          data.ctaBand.secondary
            ? {
                label: data.ctaBand.secondary.label,
                href: `/${locale}${data.ctaBand.secondary.href}`,
              }
            : undefined
        }
      />
    </main>
  );
}
