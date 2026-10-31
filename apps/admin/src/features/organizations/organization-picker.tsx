import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Field, Input, Select } from '@nestself/ui';
import type { OrganizationResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '../../use-debounced';
import { organizationErrorKey } from './organization-errors';
import { useOrganizationPages } from './use-organizations';

export interface OrganizationPickerProps {
  opsApi: OpsAdminApi;
  /** The API may be called: the operations context is ready, and it is not sample mode. */
  enabled: boolean;
  /** The id of the chosen organization, or an empty string before a choice. */
  value: string;
  onValueChange: (orgId: string) => void;
  /** The id the form's error summary links to. */
  id: string;
  label: string;
  placeholder: string;
  /** The form's message for this choice, if it has one. */
  error?: string | undefined;
}

/**
 * Chooses one of the employer clients without loading them all: a search
 * field narrows the list on the server (`GET /ops/organizations?search=`, a
 * prefix match on name or slug, debounced), the `Select` shows the loaded
 * names, and "Load more" appends the next page of the current search.
 *
 * The chosen organization stays in the list when a later search no longer
 * returns it, so the field never falls back to showing a raw id.
 */
export function OrganizationPicker({ opsApi, enabled, value, onValueChange, id, label, placeholder, error }: OrganizationPickerProps) {
  const { t } = useTranslation(['admin']);
  const [draft, setDraft] = useState('');
  const search = useDebounced(draft.trim(), SEARCH_DEBOUNCE_MS);
  const pages = useOrganizationPages(opsApi, enabled, search);
  const [chosen, setChosen] = useState<OrganizationResponse | null>(null);

  const loaded = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const kept = chosen !== null && chosen.id === value && !loaded.some((o) => o.id === value) ? [chosen] : [];
  const options = [...kept, ...loaded].map((o) => ({ value: o.id, label: o.name }));

  const loadError = pages.isError && !pages.isFetchNextPageError ? organizationErrorKey(pages.error) : null;
  const nextPageError = pages.isFetchNextPageError ? organizationErrorKey(pages.error) : null;
  const note = pages.isLoading
    ? t('admin:organizations.loading')
    : loadError === null && pages.data && loaded.length === 0
      ? t(search ? 'admin:organizations.noMatch' : 'admin:organizations.empty')
      : '';

  const choose = (orgId: string | null) => {
    setChosen(loaded.find((o) => o.id === orgId) ?? (chosen?.id === orgId ? chosen : null));
    onValueChange(orgId ?? '');
  };

  /** Enter in the search field must not submit the form around the picker: the list already follows the typing. */
  const keepFormUnsubmitted = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  };

  return (
    <div className="space-y-3">
      <div role="presentation" onKeyDown={keepFormUnsubmitted}>
        <Field id={`${id}-search`} label={t('admin:sso.create.organizationSearch')} description={t('admin:organizations.searchHint')}>
          <Input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
        </Field>
      </div>

      <Field id={id} label={label} error={error} required>
        <Select placeholder={placeholder} options={options} value={value || undefined} onValueChange={choose} />
      </Field>

      <p role="status" className="type-metadata text-text-secondary">
        {note}
      </p>

      {loadError === 'forbidden' ? (
        <Alert tone="info">{t('admin:organizations.limited')}</Alert>
      ) : loadError ? (
        <Alert tone="danger" title={t('admin:organizations.errors.loadTitle')}>
          {t(`admin:organizations.errors.${loadError}`)}
        </Alert>
      ) : null}

      {nextPageError ? (
        <Alert tone="danger" title={t('admin:paging.loadMoreFailed')}>
          {t(`admin:organizations.errors.${nextPageError}`)}
        </Alert>
      ) : null}

      {pages.hasNextPage ? (
        <div>
          <Button type="button" variant="secondary" size="sm" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {t('admin:sso.create.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
