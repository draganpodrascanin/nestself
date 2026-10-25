/**
 * Saved items route — list of bookmarked library resources (T-C1.13, 9.7).
 *
 * States:
 * - loading: skeleton
 * - empty: "No saved items" with guidance
 * - populated: list with available and unavailable placeholders
 * - unavailable items: "This content is no longer available" with remove action
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Heading,
  Text,
  Skeleton,
  StatusBlock,
  Alert,
  Button,
  Card,
  SampleDataBanner,
} from '@nestself/ui';
import type { SavedItem } from '@nestself/contracts';
import { savedKeys } from '@nestself/api-client';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '../../auth';
import { isSampleDataMode } from '../../data-source';
import { api } from '../../api';
import { mapLibraryError } from '../../library/map-library-error';
import { savedItemsListOptions, unsaveItem } from '../../library/use-library';

export const Route = createFileRoute('/_authenticated/saved')({
  component: SavedPage,
});

function SavedPage() {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  if (isSampleDataMode) {
    return <SampleSavedPage locale={locale} />;
  }

  return <ApiSavedPage locale={locale} />;
}

// ---------------------------------------------------------------------------
// Sample mode
// ---------------------------------------------------------------------------

function SampleSavedPage({ locale: _locale }: { locale: string }) {
  const { t } = useTranslation(['library', 'common']);

  return (
    <div className="space-y-6">
      <SampleDataBanner message={t('common:sample.banner')} />
      <Heading level={1} typeRole="screenTitle">
        {t('library:saved.title')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('library:saved.empty.title')}
        body={t('library:saved.empty.body')}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// API mode
// ---------------------------------------------------------------------------

function ApiSavedPage({ locale }: { locale: string }) {
  const { t } = useTranslation(['library', 'common']);
  const { principal } = useAuth();
  const ctx = principal?.context ?? { kind: 'personal' as const };

  const { data, isLoading, isError, error } = useQuery(
    savedItemsListOptions(api, ctx, locale),
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Heading level={1} typeRole="screenTitle">
          {t('library:saved.title')}
        </Heading>
        <Skeleton lines={3} label={t('common:state.loading')} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <Heading level={1} typeRole="screenTitle">
          {t('library:saved.title')}
        </Heading>
        <Alert tone="danger">
          {mapLibraryError(error, t as Parameters<typeof mapLibraryError>[1])}
        </Alert>
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('library:saved.title')}
      </Heading>
      {items.length === 0 ? (
        <StatusBlock
          state="empty"
          title={t('library:saved.empty.title')}
          body={t('library:saved.empty.body')}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <SavedItemRow
              key={item.resourceId}
              item={item}
              ctx={ctx}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SavedItemRow({
  item,
  ctx,
}: {
  item: SavedItem;
  ctx: { kind: string; orgId?: string };
}) {
  const { t } = useTranslation(['library']);
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () => unsaveItem(api, item.resourceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: savedKeys.all(ctx as Parameters<typeof savedKeys.all>[0]),
      });
    },
  });

  if (item.status === 'unavailable') {
    return (
      <Card as="li" padding="md">
        <div className="flex items-center justify-between">
          <Text className="text-text-secondary">{t('library:saved.unavailable')}</Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeMutation.mutate()}
            loading={removeMutation.isPending}
          >
            {t('library:saved.remove')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card as="li" padding="md" interactive>
      <Link
        to="/content/$contentId"
        params={{ contentId: item.resourceId }}
        className="block no-underline"
      >
        <Text className="font-[var(--font-weight-label)]">{item.title}</Text>
        {item.categoryName ? (
          <Text className="type-metadata text-text-secondary">{item.categoryName}</Text>
        ) : null}
      </Link>
    </Card>
  );
}
