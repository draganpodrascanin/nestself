/**
 * CMS resource detail route (WRK-R-30, T-C1.12).
 *
 * Shows resource metadata, locale variants with revision states,
 * publications, and actions (add variant, publish).
 */
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  can,
  AUTHORED_LOCALES,
} from '@nestself/contracts';
import type { AuthoredLocale } from '@nestself/contracts';
import {
  Heading,
  Badge,
  Button,
  Table,
  Th,
  Td,
  StatusBlock,
  Alert,
  useToast,
} from '@nestself/ui';
import {
  SAMPLE_CONTENT_RESOURCES,
  SAMPLE_CATEGORY_LABELS,
} from '@nestself/sample-data';
import type { SampleContentResource, SampleContentVariant } from '@nestself/sample-data';
import { isSampleDataMode } from '../../../../../data-source';
import { useAuth } from '../../../../../auth';

type RevisionState = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'superseded';

const STATE_BADGE_TONE: Record<RevisionState, 'neutral' | 'info' | 'warning' | 'success'> = {
  draft: 'neutral',
  in_review: 'info',
  changes_requested: 'warning',
  approved: 'success',
  superseded: 'neutral',
};

function ResourceDetailPage() {
  const { t, i18n } = useTranslation(['cms', 'common']);
  const { resourceId } = Route.useParams();
  const { principal, effectiveActions } = useAuth();
  const toast = useToast();
  const locale = i18n.language;
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = principal ? can(principal, 'content.write', undefined, effectiveActions) : false;
  const canPublish = principal ? can(principal, 'content.publish', undefined, effectiveActions) : false;

  // In sample mode, look up the resource from fixtures
  const resource: SampleContentResource | undefined = isSampleDataMode
    ? SAMPLE_CONTENT_RESOURCES.find((r) => r.id === resourceId)
    : undefined;

  if (!resource && isSampleDataMode) {
    return (
      <StatusBlock
        state="empty"
        title={t('cms:error.not_found')}
        body=""
      />
    );
  }

  // Category name
  const categoryName = resource
    ? SAMPLE_CATEGORY_LABELS.find(
        (cl) => cl.categoryId === resource.primaryCategoryId && cl.locale === (locale === 'sr-Cyrl' ? 'sr-Latn' : locale),
      )?.name ?? resource.primaryCategoryId
    : '';

  // Which authored locales have variants
  const existingLocales = new Set(resource?.variants.map((v) => v.locale) ?? []);
  const missingLocales = AUTHORED_LOCALES.filter((l) => !existingLocales.has(l));

  // Sample mode: all variants are in draft state
  const variantState = (_variant: SampleContentVariant): RevisionState => 'draft';

  // Check if all authored locales are approved (for publish)
  const allApproved = false; // In sample mode, they're always draft

  const handlePublish = async () => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.publishNotice'), tone: 'info' });
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      // API mode would call withStepUp(stepUp, () => cmsApi.publishNow(...))
      toast.add({ title: t('cms:detail.publishSuccess'), tone: 'success' });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      setError(t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') }));
    } finally {
      setPublishing(false);
    }
  };

  const handleAddVariant = (_variantLocale: AuthoredLocale) => {
    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.saveNotice'), tone: 'info' });
    }
  };

  return (
    <div>
      <Heading level={1}>{t('cms:detail.title')}</Heading>

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      {/* Metadata */}
      <section className="mt-6">
        <Heading level={2}>{t('cms:detail.metadata')}</Heading>
        {resource ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="type-metadata text-text-secondary">{t('cms:resources.columns.type')}</dt>
              <dd className="mt-0.5">{t(`cms:resources.type.${resource.type}`)}</dd>
            </div>
            <div>
              <dt className="type-metadata text-text-secondary">{t('cms:resources.columns.category')}</dt>
              <dd className="mt-0.5">{categoryName}</dd>
            </div>
            <div>
              <dt className="type-metadata text-text-secondary">{t('cms:newResource.reviewPolicy')}</dt>
              <dd className="mt-0.5">{t(`cms:newResource.reviewPolicy${resource.reviewPolicy === 'professional' ? 'Professional' : 'Editorial'}`)}</dd>
            </div>
            <div>
              <dt className="type-metadata text-text-secondary">{t('cms:newResource.reviewDiscipline')}</dt>
              <dd className="mt-0.5">{t(`cms:newResource.disciplines.${resource.reviewDiscipline}`)}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {/* Variants */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <Heading level={2}>{t('cms:detail.variants')}</Heading>
          {canWrite && missingLocales.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleAddVariant(missingLocales[0]!)}
            >
              {t('cms:detail.addVariant')}
            </Button>
          ) : null}
        </div>

        <Table caption={t('cms:detail.variants')} className="mt-3">
          <thead>
            <tr>
              <Th>{t('cms:resources.columns.locale')}</Th>
              <Th>{t('cms:resources.columns.title')}</Th>
              <Th>{t('cms:resources.columns.state')}</Th>
            </tr>
          </thead>
          <tbody>
            {resource?.variants.map((variant) => {
              const state = variantState(variant);
              return (
                <tr key={variant.id}>
                  <Td>
                    <Link
                      to="/cms/resources/$resourceId/variants/$locale"
                      params={{ resourceId, locale: variant.locale }}
                      className="no-underline text-primary"
                    >
                      {t(`cms:detail.locale.${variant.locale}`)}
                    </Link>
                  </Td>
                  <Td>{variant.title}</Td>
                  <Td>
                    <Badge tone={STATE_BADGE_TONE[state]}>
                      {t(`cms:detail.revisionState.${state}`)}
                    </Badge>
                  </Td>
                </tr>
              );
            })}
            {/* Show sr-Cyrl as derived (read-only) */}
            <tr>
              <Td>
                <Link
                  to="/cms/resources/$resourceId/variants/$locale"
                  params={{ resourceId, locale: 'sr-Cyrl' }}
                  className="no-underline text-text-secondary"
                >
                  {t('cms:detail.locale.sr-Cyrl')}
                </Link>
              </Td>
              <Td className="text-text-secondary">
                {t('cms:editor.derivedLocaleNotice')}
              </Td>
              <Td>
                <Badge tone="neutral">{t('cms:detail.revisionState.draft')}</Badge>
              </Td>
            </tr>
          </tbody>
        </Table>
      </section>

      {/* Publications */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <Heading level={2}>{t('cms:detail.publications')}</Heading>
          {canPublish ? (
            <Button
              variant="primary"
              size="sm"
              disabled={!allApproved}
              loading={publishing}
              loadingLabel={t('common:loading')}
              onClick={handlePublish}
            >
              {t('cms:detail.publishNow')}
            </Button>
          ) : null}
        </div>

        {!allApproved && canPublish ? (
          <Alert tone="info" className="mt-3">
            {t('cms:detail.publishRequiresApproval')}
          </Alert>
        ) : null}

        <div className="mt-3">
          <StatusBlock
            state="empty"
            title={t('cms:detail.noPublications')}
            body=""
          />
        </div>
      </section>
    </div>
  );
}

export const Route = createFileRoute(
  '/_authenticated/cms/resources/$resourceId/',
)({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (!principal || !can(principal, 'content.preview', undefined, effectiveActions)) {
      throw redirect({ to: '/cms/resources' });
    }
  },
  component: ResourceDetailPage,
});
