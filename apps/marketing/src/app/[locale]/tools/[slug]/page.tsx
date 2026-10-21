import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, locales } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { localizedMetadata } from '@/i18n/metadata';
import {
  getAssessment,
  getEntry,
  listAssessmentSlugs,
  listSlugs,
} from '@/content/loaders';
import { renderMdx } from '@/content/mdx';
import { Breadcrumbs, Card, PhotoFigure } from '@nestself/ui';
import { Heading, Text, LinkButton } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';
import { ProseLayout } from '@/components/sections/ProseLayout';
import { AssessmentRunner } from '@/components/assessment/AssessmentRunner';
import { ReadingColumn } from '@/components/reading/ReadingColumn';
import { loadContent } from '../content';

const ASSESSMENT_PHOTO: Record<string, PhotoKey> = {
  psychological: 'assessment-sofa',
  work: 'article-end-of-day',
  financial: 'financial-planning',
};

interface Params {
  locale: string;
  slug: string;
}

export async function generateStaticParams() {
  const [assessmentSlugs, toolSlugs] = await Promise.all([
    listAssessmentSlugs(),
    listSlugs('tools'),
  ]);
  const allSlugs = [...new Set([...assessmentSlugs, ...toolSlugs])];
  return locales.flatMap((locale) =>
    allSlugs.map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const loc = locale as Locale;

  const assessment = await getAssessment(slug, loc);
  if (assessment) {
    return localizedMetadata({
      locale: loc,
      title: assessment.data.title,
      description: assessment.data.intro,
      pathname: `/tools/${slug}`,
    });
  }

  const tool = await getEntry('tools', slug, loc);
  if (tool) {
    return localizedMetadata({
      locale: loc,
      title: tool.frontmatter.title,
      description: tool.frontmatter.description,
      pathname: `/tools/${slug}`,
    });
  }

  return {};
}

export default async function ToolSlugPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const loc = locale as Locale;

  const [{ data: content }, assessment] = await Promise.all([
    loadContent(loc),
    getAssessment(slug, loc),
  ]);

  // ----- Assessment page -----
  if (assessment) {
    const { data } = assessment;
    const introPhotoKey = ASSESSMENT_PHOTO[data.topic] ?? ('assessment-sofa' as PhotoKey);
    const introPhotoAlt =
      content.introPhotoAlt[data.topic] ?? content.introPhotoAlt['default'] ?? '';
    return (
      <main id="main" tabIndex={-1} className="@container">
        <div className="py-8">
          <Breadcrumbs
            label="Breadcrumb"
            items={[
              { label: content.breadcrumbs.home, href: `/${locale}` },
              { label: content.breadcrumbs.tools, href: `/${locale}/tools` },
              { label: data.title },
            ]}
          />
        </div>

        <section className="grid gap-3 @min-[1024px]:gap-12 grid-cols-1 @min-[1024px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center py-8">
          <div className="max-w-[720px] @max-[1024px]:order-last">
            <Heading level={1} typeRole="screenTitle" className="mb-4">
              {data.title}
            </Heading>
            <Text tone="secondary" className="mb-4">
              {data.intro}
            </Text>
            <div className="flex flex-wrap gap-4 mb-4">
              <Text as="span" typeRole="metadata" tone="secondary">
                {content.assessments.durationLabel.replace(
                  '{minutes}',
                  String(data.durationMinutes),
                )}
              </Text>
              <Text as="span" typeRole="metadata" tone="secondary">
                &middot;
              </Text>
              <Text as="span" typeRole="metadata" tone="secondary">
                {content.assessments.questionsLabel.replace(
                  '{count}',
                  String(data.questions.length),
                )}
              </Text>
            </div>
            <Text tone="secondary" typeRole="metadata" className="mb-8">
              {content.runner.nothingStored}
            </Text>
          </div>
          <PhotoFigure
            photo={introPhotoKey}
            alt={introPhotoAlt}
            imageRole="card"
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="overflow-hidden rounded-card @max-[1024px]:order-first"
          />
        </section>

        <AssessmentRunner
          assessment={data}
          labels={content.runner}
          links={{
            talk: `/${locale}/services/therapy`,
            related: `/${locale}/resources`,
          }}
        />
      </main>
    );
  }

  // ----- Guide page -----
  const tool = await getEntry('tools', slug, loc);
  if (!tool) notFound();

  // Strip leading h1 from MDX body since we render the title from frontmatter.
  const bodyWithoutH1 = tool.body.replace(/^#\s+.+\n+/, '');
  const mdxContent = await renderMdx(bodyWithoutH1);
  const topic = tool.frontmatter.topic;
  const cta = content.guideCta[topic] ?? content.guideCta['psychological'];

  const isStepped = tool.frontmatter.stepped === true;

  return (
    <main id="main" tabIndex={-1} className="@container">
      <div className="py-8">
        <Breadcrumbs
          label="Breadcrumb"
          items={[
            { label: content.breadcrumbs.home, href: `/${locale}` },
            { label: content.breadcrumbs.tools, href: `/${locale}/tools` },
            { label: tool.frontmatter.title },
          ]}
        />
      </div>

      <ReadingColumn>
        <Heading level={1} typeRole="editorial" className="mb-6">
          {tool.frontmatter.title}
        </Heading>

        {/* A24: Summary card for guides */}
        <Card tone="subtle" padding="lg" className="mb-8">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Text as="span" typeRole="metadata" tone="secondary">
              {content.kindLabels[tool.frontmatter.kind]}
            </Text>
            {tool.frontmatter.readingMinutes && (
              <>
                <Text as="span" typeRole="metadata" tone="secondary">
                  &middot;
                </Text>
                <Text as="span" typeRole="metadata" tone="secondary">
                  {tool.frontmatter.readingMinutes} min
                </Text>
              </>
            )}
          </div>
          <Text tone="secondary" className="mt-2">
            {tool.frontmatter.description}
          </Text>
        </Card>

        <ProseLayout className={`py-0 [&_[data-prose]]:max-w-none ${isStepped ? '[&_[data-prose]_h2]:border-t [&_[data-prose]_h2]:border-border-subtle [&_[data-prose]_h2]:pt-8 [&_[data-prose]_h2]:mt-8' : ''}`}>
          {mdxContent}
        </ProseLayout>

        {cta && (
          <div className="mt-12 mb-8">
            <LinkButton href={`/${locale}${cta.href}`}>
              {cta.label}
            </LinkButton>
          </div>
        )}
      </ReadingColumn>
    </main>
  );
}
