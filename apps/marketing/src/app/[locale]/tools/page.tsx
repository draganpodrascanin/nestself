import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, localePath } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { localizedMetadata } from '@/i18n/metadata';
import { listAssessments, listEntries } from '@/content/loaders';
import { PageHero } from '@/components/sections/PageHero';
import { AssessmentCard } from '@/components/cards/AssessmentCard';
import { ToolCard } from '@/components/cards/ToolCard';
import { Heading, Text, Eyebrow } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';
import { loadContent } from './content';
import { SECTION_PADDING } from '@/components/sections/section';

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
    pathname: '/tools',
  });
}

export default async function ToolsPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const loc = locale as Locale;
  const [{ data }, assessments, tools] = await Promise.all([
    loadContent(loc),
    listAssessments(loc),
    listEntries('tools', loc),
  ]);

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={data.hero.primaryCta}
        secondaryCta={data.hero.secondaryCta}
        photo={{ key: 'tools-notebook' as PhotoKey, alt: 'A notebook and pen on a desk' }}
        variant="split"
      />

      {/* Self-assessments section */}
      <section id="assessments" aria-labelledby="assessments-title" className={SECTION_PADDING}>
        <Eyebrow>{data.assessments.eyebrow}</Eyebrow>
        <Heading level={2} id="assessments-title" typeRole="sectionTitle" className="mt-2 mb-4">
          {data.assessments.title}
        </Heading>
        <Text tone="secondary" className="mb-8 max-w-[640px]">
          {data.assessments.intro}
        </Text>
        <div className="gap-6 grid grid-cols-1 @min-[760px]:grid-cols-2 @min-[1024px]:grid-cols-3">
          {assessments.map((a) => (
            <AssessmentCard
              key={a.slug}
              slug={a.slug}
              href={localePath(locale, `/tools/${a.slug}`)}
              title={a.data.title}
              intro={a.data.intro}
              durationLabel={data.assessments.durationLabel.replace(
                '{minutes}',
                String(a.data.durationMinutes),
              )}
              questionsLabel={data.assessments.questionsLabel.replace(
                '{count}',
                String(a.data.questions.length),
              )}
            />
          ))}
        </div>
      </section>

      {/* Guides and planners section */}
      <section id="guides" aria-labelledby="guides-title" className={SECTION_PADDING}>
        <Eyebrow>{data.guides.eyebrow}</Eyebrow>
        <Heading level={2} id="guides-title" typeRole="sectionTitle" className="mt-2 mb-4">
          {data.guides.title}
        </Heading>
        <Text tone="secondary" className="mb-8 max-w-[640px]">
          {data.guides.intro}
        </Text>
        <div className="gap-6 grid grid-cols-1 @min-[760px]:grid-cols-2 @min-[1024px]:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard
              key={tool.slug}
              href={localePath(locale, `/tools/${tool.slug}`)}
              title={tool.frontmatter.title}
              description={tool.frontmatter.description}
              kindLabel={data.kindLabels[tool.frontmatter.kind]}
              cover={{
                key: tool.frontmatter.cover as PhotoKey,
                alt: tool.frontmatter.coverAlt,
              }}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
