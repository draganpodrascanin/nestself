import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  Heading,
  Text,
  CategoryIcon,
  StatusBlock,
  PhotoFigure,
} from '@nestself/ui';
import { supportAreaIcon } from '@nestself/contracts';
import type { SupportArea } from '@nestself/contracts';
import { SAMPLE_POSTS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import { useAuth } from '../../auth';
import { NextAppointment } from '../../calls/next-appointment';

const searchSchema = z.object({
  denied: z.string().optional(),
});

export const Route = createFileRoute('/_authenticated/')({
  validateSearch: searchSchema,
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation(['workspace', 'common']);
  const { principal } = useAuth();
  const { denied } = Route.useSearch();

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
        {t('workspace:home.greeting', { name: principal?.displayName ?? '' })}
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

      {/* Next appointment (CALL-02): the same list as /appointments, never a fixture in API mode */}
      <section>
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('workspace:home.upcoming')}
        </Heading>
        <NextAppointment />
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
