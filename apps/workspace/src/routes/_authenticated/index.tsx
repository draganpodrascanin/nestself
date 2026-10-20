import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  Heading,
  Text,
  CategoryIcon,
  Avatar,
  StatusBlock,
  PhotoFigure,
  CoverageNotice,
} from '@nestself/ui';
import { supportAreaIcon } from '@nestself/contracts';
import type { SupportArea } from '@nestself/contracts';
import { SAMPLE_BOOKING, SAMPLE_POSTS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useSession } from '../../session';

const searchSchema = z.object({
  denied: z.string().optional(),
});

export const Route = createFileRoute('/_authenticated/')({
  validateSearch: searchSchema,
  component: HomePage,
});

function HomePage() {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { session } = useSession();
  const { denied } = Route.useSearch();
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  const supportAreas: SupportArea[] = ['psychological', 'legal', 'financial'];

  // Latest two posts
  const latestPosts = SAMPLE_POSTS.slice(0, 2);

  const findPersonName = (authorId: string) => {
    const person = SAMPLE_PEOPLE.find((p) => p.id === authorId);
    return person?.displayName ?? authorId;
  };

  return (
    <div className="space-y-8">
      {denied ? (
        <StatusBlock
          state="permission"
          title={t('common:state.permission.title')}
          body={t('common:state.permission.body')}
        />
      ) : null}

      <Heading level={1} typeRole="screenTitle">
        {t('workspace:home.greeting', { name: session.displayName })}
      </Heading>

      {/* Support area cards */}
      <section>
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('workspace:home.supportAreas')}
        </Heading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {supportAreas.map((area) => (
            <Link
              key={area}
              to="/support/$area"
              params={{ area }}
              className="flex flex-col items-center gap-3 p-6 rounded-card border border-border-subtle bg-surface hover:bg-tint transition-colors no-underline"
            >
              <CategoryIcon category={supportAreaIcon[area]} size={48} />
              <Text className="font-[var(--font-weight-label)] text-center">
                {t(`workspace:categories.${area}`)}
              </Text>
            </Link>
          ))}
        </div>
      </section>

      {/* Next appointment card */}
      <section>
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('workspace:home.upcoming')}
        </Heading>
        <div className="rounded-card border border-border-subtle bg-surface p-6">
          <div className="flex items-center gap-4 mb-4">
            <Avatar initials="MR" name={SAMPLE_BOOKING.advisorName} size="md" />
            <div>
              <Text className="font-[var(--font-weight-label)]">
                {t('workspace:appointment.with', { name: SAMPLE_BOOKING.advisorName })}
              </Text>
              <Text className="type-metadata text-text-secondary">
                {formatDateTime(new Date(SAMPLE_BOOKING.appointmentAt), locale)}
              </Text>
            </div>
          </div>
          <CoverageNotice>
            {t('workspace:appointment.format')}: {t(`workspace:appointment.${SAMPLE_BOOKING.format}`)}
          </CoverageNotice>
        </div>
      </section>

      {/* Channel digest */}
      <section>
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('workspace:home.recentMessages')}
        </Heading>
        <div className="space-y-3">
          {latestPosts.map((post) => (
            <div
              key={post.id}
              className="rounded-card border border-border-subtle bg-surface p-4"
            >
              <Text className="font-[var(--font-weight-label)] mb-1">
                {findPersonName(post.authorId)}
              </Text>
              <Text className="text-text-secondary">{post.content}</Text>
            </div>
          ))}
        </div>
      </section>

      {/* One optional photo */}
      <PhotoFigure
        photo="family-play"
        alt=""
        imageRole="card"
        sizes="(min-width: 768px) 50vw, 100vw"
        decorative
        className="rounded-card overflow-hidden"
      />
    </div>
  );
}
