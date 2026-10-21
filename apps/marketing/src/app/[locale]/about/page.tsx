import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections/PageHero';
import { SplitSection } from '@/components/sections/SplitSection';
import { StepsSection } from '@/components/sections/StepsSection';
import { CtaBand } from '@/components/sections/CtaBand';
import type { PhotoKey } from '@nestself/assets';
import { Eyebrow, Heading, Text, Avatar } from '@nestself/ui';
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
    pathname: '/about',
  });
}

export default async function AboutPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { data } = await loadContent(locale as Locale);

  return (
    <main id="main" tabIndex={-1} className="@container">
      <PageHero
        eyebrow={data.hero.eyebrow}
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={data.hero.primaryCta}
        photo={{
          key: data.hero.photo.key as PhotoKey,
          alt: data.hero.photo.alt,
        }}
        variant="split"
      />

      <SplitSection
        id="mission"
        title={data.mission.title}
        paragraphs={data.mission.paragraphs}
        photo={{
          key: data.mission.photo.key as PhotoKey,
          alt: data.mission.photo.alt,
        }}
        reverse
      />

      <StepsSection
        id="how-we-work"
        eyebrow={data.howWeWorkWithProfessionals.eyebrow}
        title={data.howWeWorkWithProfessionals.title}
        steps={data.howWeWorkWithProfessionals.steps}
      />

      {/* Team section using Avatar initials, no personal names */}
      <section id="team" aria-labelledby="team-title" className="py-16">
        {data.team.eyebrow && (
          <Eyebrow className="mb-3">{data.team.eyebrow}</Eyebrow>
        )}
        <Heading level={2} id="team-title">
          {data.team.title}
        </Heading>
        {data.team.lead && (
          <Text typeRole="bodyLarge" tone="secondary" className="mt-3 mb-10">
            {data.team.lead}
          </Text>
        )}
        <ul
          role="list"
          className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1"
        >
          {data.team.members.map((member) => (
            <li key={member.role} className="flex flex-col items-center gap-3 text-center">
              <Avatar initials={member.initials} name={member.role} size="lg" />
              <Heading level={3} typeRole="sectionTitle">
                {member.role}
              </Heading>
              <Text tone="secondary">{member.body}</Text>
            </li>
          ))}
        </ul>
      </section>

      <SplitSection
        id="where-we-are"
        title={data.whereWeAre.title}
        paragraphs={data.whereWeAre.paragraphs}
        photo={{
          key: data.whereWeAre.photo.key as PhotoKey,
          alt: data.whereWeAre.photo.alt,
        }}
      />

      <CtaBand
        title={data.cta.title}
        body={data.cta.body}
        primary={data.cta.primary}
        secondary={data.cta.secondary}
      />
    </main>
  );
}
