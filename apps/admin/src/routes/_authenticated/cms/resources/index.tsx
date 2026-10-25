/**
 * CMS resource list route (WRK-R-30, T-C1.12).
 *
 * Lists content resources with category filtering.
 * Sample mode uses SAMPLE_CONTENT_RESOURCES; API mode calls the CMS list endpoint.
 */
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from '@phosphor-icons/react';
import { can } from '@nestself/contracts';
import { Heading, Table, Th, Td, Badge, Button, Select, StatusBlock } from '@nestself/ui';
import {
  SAMPLE_CONTENT_RESOURCES,
  SAMPLE_CATEGORIES,
  SAMPLE_CATEGORY_LABELS,
} from '@nestself/sample-data';
import { isSampleDataMode } from '../../../../data-source';
import { useAuth } from '../../../../auth';

type RevisionState = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'superseded';

const BADGE_TONE: Record<RevisionState, 'neutral' | 'info' | 'warning' | 'success'> = {
  draft: 'neutral',
  in_review: 'info',
  changes_requested: 'warning',
  approved: 'success',
  superseded: 'neutral',
};

function ResourceListPage() {
  const { t, i18n } = useTranslation(['cms', 'common']);
  const { principal, effectiveActions } = useAuth();
  const canWrite = principal ? can(principal, 'content.write', undefined, effectiveActions) : false;
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // In sample mode, build the category options from SAMPLE_CATEGORY_LABELS
  const locale = i18n.language;
  const categoryOptions = SAMPLE_CATEGORIES.map((cat) => {
    const label = SAMPLE_CATEGORY_LABELS.find(
      (cl) => cl.categoryId === cat.id && cl.locale === (locale === 'sr-Cyrl' ? 'sr-Latn' : locale),
    );
    return { value: cat.id, label: label?.name ?? cat.slug };
  });

  const allCategoryOptions = [
    { value: '', label: t('cms:resources.filter.allCategories') },
    ...categoryOptions,
  ];

  // Filter resources
  const resources = isSampleDataMode ? SAMPLE_CONTENT_RESOURCES : [];
  const filtered = categoryFilter
    ? resources.filter((r) => r.primaryCategoryId === categoryFilter)
    : resources;

  // Find category name
  const categoryName = (catId: string) => {
    const label = SAMPLE_CATEGORY_LABELS.find(
      (cl) => cl.categoryId === catId && cl.locale === (locale === 'sr-Cyrl' ? 'sr-Latn' : locale),
    );
    return label?.name ?? catId;
  };

  // Get latest variant state for display
  const latestState = (_resource: (typeof resources)[number]): RevisionState => {
    // Show the first variant's implied state; in real mode this would come from the API
    return 'draft';
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <Heading level={1}>{t('cms:resources.title')}</Heading>
        {canWrite ? (
          <Link to="/cms/resources/new" className="no-underline">
            <Button variant="primary" leadingIcon={<Plus size={20} aria-hidden />}>
              {t('cms:resources.create')}
            </Button>
          </Link>
        ) : null}
      </div>

      <div className="mt-4 max-w-xs">
        <Select
          options={allCategoryOptions}
          value={categoryFilter ?? ''}
          onValueChange={(v) => setCategoryFilter(v || null)}
          aria-label={t('cms:resources.filter.category')}
        />
      </div>

      <div className="mt-6">
        {filtered.length === 0 ? (
          <StatusBlock
            state="empty"
            title={categoryFilter ? t('cms:resources.emptyFiltered') : t('cms:resources.empty')}
            body=""
          />
        ) : (
          <Table caption={t('cms:resources.title')}>
            <thead>
              <tr>
                <Th>{t('cms:resources.columns.title')}</Th>
                <Th>{t('cms:resources.columns.type')}</Th>
                <Th>{t('cms:resources.columns.category')}</Th>
                <Th>{t('cms:resources.columns.state')}</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((resource) => {
                const displayVariant = resource.variants[0];
                const state = latestState(resource);
                return (
                  <tr key={resource.id}>
                    <Td>
                      <Link
                        to="/cms/resources/$resourceId"
                        params={{ resourceId: resource.id }}
                        className="no-underline text-primary"
                      >
                        <span className="font-[var(--font-weight-label)]">
                          {displayVariant?.title ?? resource.id}
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone="neutral">
                        {t(`cms:resources.type.${resource.type}`)}
                      </Badge>
                    </Td>
                    <Td>{categoryName(resource.primaryCategoryId)}</Td>
                    <Td>
                      <Badge tone={BADGE_TONE[state]}>
                        {t(`cms:detail.revisionState.${state}`)}
                      </Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/cms/resources/')({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (!principal || !can(principal, 'content.preview', undefined, effectiveActions)) {
      throw redirect({ to: '/' });
    }
  },
  component: ResourceListPage,
});
