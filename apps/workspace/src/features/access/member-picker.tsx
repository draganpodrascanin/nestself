import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Field, Input, Select } from '@nestself/ui';
import type { OrgAdminApi } from '@nestself/api-client';
import { accessErrorKey } from './access-errors';
import type { AccessMember } from './access-labels';
import { SEARCH_DEBOUNCE_MS, useDebounced } from './use-debounced';
import { useMembers } from './use-org-admin';

export interface MemberPickerProps {
  adminApi: OrgAdminApi;
  /** The organization to search; `null` when the API may not be called (sample mode). */
  orgId: string | null;
  /** Sample mode (`orgId` is `null`): the members to choose from, searched in the browser. */
  sampleMembers?: readonly AccessMember[];
  /** The id the form's error summary links to. */
  id?: string;
  label: string;
  placeholder: string;
  required?: boolean;
  /** The form's message for this choice, if it has one. */
  error?: string | undefined;
  /** Left out of the choices: nobody delegates to or hands the ownership to themselves. */
  excludeUserId?: string;
  onValueChange: (userId: string | null) => void;
}

/** The members whose name starts with the search text; the API also matches the start of the email. */
function matchingSample(members: readonly AccessMember[], search: string): AccessMember[] {
  const term = search.toLowerCase();
  return members.filter((m) => m.displayName.toLowerCase().startsWith(term));
}

/**
 * Chooses one member of the organization without loading them all: a search
 * field narrows the list on the server (`GET .../members?search=`, a prefix of
 * the name or the email, debounced) and the `Select` shows what came back.
 *
 * The chosen member stays among the choices when a later search no longer
 * returns them, so the field never falls back to showing a raw id. A failure
 * of the plain list is the screen's to report (it reads the same list for the
 * names in its table); a failed search is reported here.
 */
export function MemberPicker({
  adminApi,
  orgId,
  sampleMembers = [],
  id,
  label,
  placeholder,
  required,
  error,
  excludeUserId,
  onValueChange,
}: MemberPickerProps) {
  const { t } = useTranslation(['workspace']);
  const [draft, setDraft] = useState('');
  const search = useDebounced(draft.trim(), SEARCH_DEBOUNCE_MS);
  const query = useMembers(adminApi, orgId, search);
  const [chosen, setChosen] = useState<AccessMember | null>(null);

  const found = orgId === null ? matchingSample(sampleMembers, search) : (query.data ?? []);
  const loaded = found.filter((m) => m.userId !== excludeUserId);
  const kept = chosen !== null && !loaded.some((m) => m.userId === chosen.userId) ? [chosen] : [];
  const options = [...kept, ...loaded].map((m) => ({ value: m.userId, label: m.displayName }));

  const answered = orgId === null || query.isSuccess;
  const note = orgId !== null && query.isLoading
    ? t('workspace:access.memberSearch.loading')
    : answered && loaded.length === 0
      ? t(search ? 'workspace:access.memberSearch.noMatch' : 'workspace:access.memberSearch.empty')
      : '';
  const searchFailure = orgId !== null && search !== '' && query.isError ? (accessErrorKey(query.error) ?? 'unknown') : null;

  const choose = (userId: string | null) => {
    // The `Select` reports `null` by itself when its choices are rebuilt under
    // a selected member (a search replaces the list, and the chosen one moves to
    // another place in it). This picker never clears a choice, so it ignores that.
    if (userId === null) return;
    setChosen(userId === null ? null : (loaded.find((m) => m.userId === userId) ?? (chosen?.userId === userId ? chosen : null)));
    onValueChange(userId);
  };

  /** Enter in the search field must not submit the form around the picker: the list already follows the typing. */
  const keepFormUnsubmitted = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  };

  return (
    <div className="space-y-3">
      <div role="presentation" onKeyDown={keepFormUnsubmitted}>
        <Field
          id={id ? `${id}-search` : undefined}
          label={t('workspace:access.memberSearch.label')}
          description={t('workspace:access.memberSearch.hint')}
        >
          <Input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
        </Field>
      </div>

      <Field id={id} label={label} error={error} required={required}>
        <Select placeholder={placeholder} options={options} value={chosen?.userId ?? ''} onValueChange={choose} />
      </Field>

      <p role="status" className="type-metadata text-text-secondary">
        {note}
      </p>

      {searchFailure ? (
        <Alert tone="danger" title={t('workspace:access.errors.membersLoadTitle')}>
          {t(`workspace:access.errors.${searchFailure}`)}
        </Alert>
      ) : null}
    </div>
  );
}
