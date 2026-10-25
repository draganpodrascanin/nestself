import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Field, Heading, Input, Table, Td, Text, Th } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { OrganizationResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { useOperationsContext } from '../access/use-ops-admin';
import { LoadMore } from '../people/load-more';
import { ORGANIZATION_STATUS_TONE } from './organization-labels';
import { organizationErrorKey } from './organization-errors';
import { sampleOrganizations } from './sample-organizations';
import { useOrganizationPages } from './use-organizations';

const SEARCH_ID = 'organization-search';

export interface OrganizationsScreenProps {
  opsApi: OpsAdminApi;
  /** Sample mode: the sample organization instead of the API. */
  sampleMode: boolean;
}

/**
 * The employer clients, by name, with a prefix search and "Load more". The
 * list is a platform-level route: staff whose access covers only assigned
 * clients get a 403, shown as a note rather than an error.
 */
export function OrganizationsScreen({ opsApi, sampleMode }: OrganizationsScreenProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const pages = useOrganizationPages(opsApi, ready, search);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(draft.trim());
  };

  const organizations: OrganizationResponse[] | undefined = sampleMode
    ? sampleOrganizations(search)
    : pages.data?.pages.flatMap((p) => p.items);
  const listError = !sampleMode && pages.isError && !pages.isFetchNextPageError ? organizationErrorKey(pages.error) : null;
  const limited = listError === 'forbidden';
  const nextPageError =
    !sampleMode && pages.isFetchNextPageError
      ? t(`admin:organizations.errors.${organizationErrorKey(pages.error)}`)
      : null;

  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle';

  return (
    <div className="space-y-6">
      <Heading level={1}>{t('admin:organizations.title')}</Heading>

      {!sampleMode && switchError ? (
        <Alert tone="danger" title={t('admin:organizations.errors.loadTitle')}>
          {t(`admin:access.errors.${switchError}`)}
        </Alert>
      ) : null}

      <form noValidate onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 max-w-xl">
        <div className="flex-1 min-w-48">
          <Field id={SEARCH_ID} label={t('admin:organizations.search')} description={t('admin:organizations.searchHint')}>
            <Input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={limited || (!sampleMode && !ready)}>
          {t('admin:organizations.searchSubmit')}
        </Button>
      </form>

      {limited ? (
        <Alert tone="info">{t('admin:organizations.limited')}</Alert>
      ) : listError ? (
        <Alert tone="danger" title={t('admin:organizations.errors.loadTitle')}>
          {t(`admin:organizations.errors.${listError}`)}
        </Alert>
      ) : organizations === undefined ? (
        switchError ? null : <Text tone="secondary">{t('admin:organizations.loading')}</Text>
      ) : organizations.length === 0 ? (
        <Text tone="secondary">{search ? t('admin:organizations.noMatch') : t('admin:organizations.empty')}</Text>
      ) : (
        <>
          <Table caption={t('admin:organizations.title')}>
            <thead>
              <tr>
                <Th className={headerClass}>{t('admin:organizations.name')}</Th>
                <Th className={headerClass}>{t('admin:organizations.slug')}</Th>
                <Th className={headerClass}>{t('admin:organizations.status')}</Th>
                <Th className={headerClass}>{t('admin:organizations.created')}</Th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => (
                <tr key={org.id}>
                  <Td className={cellClass}>
                    <Link to="/organizations/$orgId" params={{ orgId: org.id }} className="no-underline text-primary">
                      {org.name}
                    </Link>
                  </Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>{org.slug}</Td>
                  <Td className={cellClass}>
                    <Badge tone={ORGANIZATION_STATUS_TONE[org.status]}>
                      {t(`admin:organizations.statuses.${org.status}`)}
                    </Badge>
                  </Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>{formatDate(org.createdAt, locale)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <LoadMore
            shown={organizations.length}
            hasMore={!sampleMode && pages.hasNextPage}
            loading={pages.isFetchingNextPage}
            errorMessage={nextPageError}
            onLoadMore={() => void pages.fetchNextPage()}
          />
        </>
      )}
    </div>
  );
}
