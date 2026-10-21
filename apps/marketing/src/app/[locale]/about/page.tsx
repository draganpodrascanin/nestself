import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections/PageHero';
import { SplitSection } from '@/components/sections/SplitSection';
import { StepsSection } from '@/components/sections/StepsSection';
import { CtaBand } from '@/components/sections/CtaBand';
import { SECTION_PADDING } from '@/components/sections/section';
import type { PhotoKey } from '@nestself/assets';
import { Eyebrow, Heading, Text, Avatar, Card, PhotoFigure } from '@nestself/ui';
import { MapPin } from '@phosphor-icons/react/dist/ssr';
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

  const featuredMembers = data.team.members.filter((m) => m.featured);
  const leadMembers = data.team.members.filter((m) => !m.featured);
  const teamPhoto = data.team.photo ?? data.whereWeAre.photo;
  const locationText = data.team.location ?? data.whereWeAre.paragraphs[0];

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

      {/* Team section with featured co-founders and compact lead cards */}
      <section id="team" aria-labelledby="team-title" className={SECTION_PADDING}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-12 items-start @max-[760px]:grid-cols-1 @max-[760px]:gap-6">
          <div>
            {data.team.eyebrow && (
              <Eyebrow className="mb-3">{data.team.eyebrow}</Eyebrow>
            )}
            <Heading level={2} id="team-title">
              {data.team.title}
            </Heading>
            {data.team.lead && (
              <Text typeRole="bodyLarge" tone="secondary" className="mt-3">
                {data.team.lead}
              </Text>
            )}
            {locationText && (
              <div className="mt-3 flex items-center gap-2 text-text-secondary">
                <MapPin size={18} weight="duotone" aria-hidden className="text-primary shrink-0" />
                <Text as="span" typeRole="metadata" tone="secondary">
                  {locationText}
                </Text>
              </div>
            )}
          </div>
          <PhotoFigure
            photo={teamPhoto.key as PhotoKey}
            alt={teamPhoto.alt}
            imageRole="hero-3x2"
            sizes="(max-width: 760px) 100vw, 50vw"
            className="overflow-hidden rounded-card @max-[760px]:order-first"
          />
        </div>

        {/* Featured members (co-founders) */}
        {featuredMembers.length > 0 && (
          <div className="mt-10 grid grid-cols-2 gap-6 @max-[760px]:grid-cols-1">
            {featuredMembers.map((member) => (
              <Card key={member.role} tone="brand" padding="lg" className="col-span-2 @max-[760px]:col-span-1">
                <div className="flex items-center gap-4">
                  <Avatar initials={member.initials} name={member.role} size="lg" />
                  <div>
                    <Heading level={3} typeRole="sectionTitle">
                      {member.role}
                    </Heading>
                    <Text tone="secondary" className="mt-1">{member.body}</Text>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Lead members in compact cards */}
        {leadMembers.length > 0 && (
          <ul
            role="list"
            className="mt-6 grid gap-4 grid-cols-2 @max-[760px]:grid-cols-1"
          >
            {leadMembers.map((member) => (
              <Card key={member.role} as="li" padding="md" className="flex items-start gap-3">
                <Avatar initials={member.initials} name={member.role} size="sm" className="shrink-0" />
                <div>
                  <Heading level={3} typeRole="sectionTitle">
                    {member.role}
                  </Heading>
                  <Text typeRole="metadata" tone="secondary" className="mt-1">{member.body}</Text>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <CtaBand
        title={data.cta.title}
        body={data.cta.body}
        primary={data.cta.primary}
        secondary={data.cta.secondary}
      />
    </main>
  );
}
