import { describe, it, expect, vi } from 'vitest';
import { createElement, useState } from 'react';
import type { FormEvent } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpsAdminApi } from '@nestself/api-client';
import type * as Ui from '@nestself/ui';
import type { SelectProps } from '@nestself/ui';
import { OrganizationPicker } from './organization-picker';
import { apiError, choose, makeOpsApi, organization, renderOps, t } from './ops-test-harness';

// A transparent wrapper around the real `Select` that keeps its latest props, so a
// test can call `onValueChange` the way Base UI does by itself (see "ignores the null").
const select = vi.hoisted(() => ({ latest: null as SelectProps | null }));
vi.mock('@nestself/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof Ui>();
  return {
    ...actual,
    Select: (props: SelectProps) => {
      select.latest = props;
      return createElement(actual.Select, props);
    },
  };
});

const ALPHA = organization('org_a', 'Alpha');
const BETA = organization('org_b', 'Beta');

const ORGANIZATION = t('admin:sso.create.organization');
const LOAD_MORE = t('admin:sso.create.loadMore');

/** A client list that answers `search` as the API does: a prefix match on the name. */
function listing(all = [ALPHA, BETA]) {
  return vi.fn(async (query: { search?: string; cursor?: string }) => ({
    items: all.filter((o) => !query.search || o.name.toLowerCase().startsWith(query.search.toLowerCase())),
    nextCursor: null,
  }));
}

function Picker({
  opsApi,
  enabled,
  error,
  onValueChange,
}: {
  opsApi: OpsAdminApi;
  enabled: boolean;
  error: string | undefined;
  onValueChange: (orgId: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <OrganizationPicker
      opsApi={opsApi}
      enabled={enabled}
      id="picker-org"
      label={ORGANIZATION}
      placeholder={t('admin:sso.create.organizationPlaceholder')}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
      error={error}
    />
  );
}

function renderPicker(opts: { opsApi?: OpsAdminApi; enabled?: boolean; error?: string } = {}) {
  const onValueChange = vi.fn();
  const result = renderOps(
    (opsApi) => <Picker opsApi={opsApi} enabled={opts.enabled ?? true} error={opts.error} onValueChange={onValueChange} />,
    { opsApi: opts.opsApi ?? makeOpsApi({ listOrganizations: listing() }) },
  );
  return { ...result, onValueChange };
}

const searchField = () => screen.getByRole('searchbox', { name: new RegExp(`^${t('admin:sso.create.organizationSearch')}`) });
const trigger = () => screen.getByRole('combobox', { name: ORGANIZATION });

describe('OrganizationPicker', () => {
  it('lists the first page of organisations by name and reports the one picked', async () => {
    const user = userEvent.setup();
    const listOrganizations = listing();
    const { onValueChange } = renderPicker({ opsApi: makeOpsApi({ listOrganizations }) });
    await screen.findByRole('combobox', { name: ORGANIZATION });

    await choose(user, ORGANIZATION, 'Beta');

    expect(listOrganizations).toHaveBeenCalledWith({ limit: 25 });
    expect(onValueChange).toHaveBeenCalledWith('org_b');
    expect(trigger()).toHaveTextContent('Beta');
  });

  it('searches through the API once the typing pauses, not on every keystroke', async () => {
    const user = userEvent.setup();
    const listOrganizations = listing();
    renderPicker({ opsApi: makeOpsApi({ listOrganizations }) });
    await waitFor(() => expect(listOrganizations).toHaveBeenCalledTimes(1));

    await user.type(searchField(), ' be ');

    await waitFor(() => expect(listOrganizations).toHaveBeenLastCalledWith({ limit: 25, search: 'be' }));
    expect(listOrganizations).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'b' }));
    expect(listOrganizations).toHaveBeenCalledTimes(2);

    await user.click(trigger());
    expect(await screen.findByRole('option', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument();
  });

  it('appends the next page on Load more while the API has one, then drops the button', async () => {
    const user = userEvent.setup();
    const listOrganizations = vi
      .fn()
      .mockResolvedValueOnce({ items: [ALPHA], nextCursor: 'org_a' })
      .mockResolvedValueOnce({ items: [BETA], nextCursor: null });
    renderPicker({ opsApi: makeOpsApi({ listOrganizations }) });

    await user.click(await screen.findByRole('button', { name: LOAD_MORE }));

    await waitFor(() => expect(listOrganizations).toHaveBeenLastCalledWith({ limit: 25, cursor: 'org_a' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: LOAD_MORE })).not.toBeInTheDocument());
    await user.click(trigger());
    expect(await screen.findByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
  });

  it('keeps the chosen organisation shown and selectable when a later search no longer returns it', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('combobox', { name: ORGANIZATION });
    await choose(user, ORGANIZATION, 'Alpha');

    await user.type(searchField(), 'zzz');

    expect(await screen.findByText(t('admin:organizations.noMatch'))).toBeInTheDocument();
    expect(trigger()).toHaveTextContent('Alpha');
    await user.click(trigger());
    expect(await screen.findByRole('option', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('shows the placeholder before a choice and keeps the Select controlled', async () => {
    renderPicker();
    expect(await screen.findByRole('combobox', { name: ORGANIZATION })).toHaveTextContent(
      t('admin:sso.create.organizationPlaceholder'),
    );
    expect(select.latest?.value).toBe('');
  });

  it('ignores the null the Select reports by itself, so a refined search never clears the choice', async () => {
    const user = userEvent.setup();
    const listOrganizations = listing();
    const { onValueChange } = renderPicker({ opsApi: makeOpsApi({ listOrganizations }) });
    await screen.findByRole('combobox', { name: ORGANIZATION });
    await choose(user, ORGANIZATION, 'Alpha');

    // A refined search rebuilds the options: Beta only, with Alpha kept as the choice.
    await user.type(searchField(), 'be');
    await waitFor(() => expect(listOrganizations).toHaveBeenLastCalledWith({ limit: 25, search: 'be' }));
    await waitFor(() => expect(select.latest?.options.map((o) => o.label)).toEqual(['Alpha', 'Beta']));

    // What Base UI does in Chromium when the choices are rebuilt under the selection
    // (jsdom does not rebuild them the same way, so the test makes the call itself).
    act(() => {
      select.latest?.onValueChange?.(null);
    });

    expect(select.latest?.value).toBe('org_a');
    expect(trigger()).toHaveTextContent('Alpha');
    // The form is never told that the organisation was cleared.
    expect(onValueChange.mock.calls).toEqual([['org_a']]);
  });

  it('says when no organisation matches and when there are none', async () => {
    const user = userEvent.setup();
    renderPicker({ opsApi: makeOpsApi({ listOrganizations: listing([]) }) });
    expect(await screen.findByText(t('admin:organizations.empty'))).toBeInTheDocument();

    await user.type(searchField(), 'zzz');

    expect(await screen.findByText(t('admin:organizations.noMatch'))).toBeInTheDocument();
    // The result of a search is announced: the note is a live region.
    expect(screen.getAllByRole('status').some((el) => el.textContent === t('admin:organizations.noMatch'))).toBe(true);
  });

  it('renders a failed load as translated copy, never the API message', async () => {
    renderPicker({ opsApi: makeOpsApi({ listOrganizations: vi.fn().mockRejectedValue(apiError(500, 'internal')) }) });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('admin:organizations.errors.loadTitle'));
    expect(alert).toHaveTextContent(t('admin:organizations.errors.unknown'));
    expect(screen.queryByText(/English/)).not.toBeInTheDocument();
  });

  it('explains a platform-only list that the account may not read', async () => {
    renderPicker({ opsApi: makeOpsApi({ listOrganizations: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) }) });
    expect(await screen.findByText(t('admin:organizations.limited'))).toBeInTheDocument();
  });

  it('shows a failed next page under the loaded ones', async () => {
    const user = userEvent.setup();
    const listOrganizations = vi
      .fn()
      .mockResolvedValueOnce({ items: [ALPHA], nextCursor: 'org_a' })
      .mockRejectedValueOnce(apiError(429, 'rate_limited'));
    renderPicker({ opsApi: makeOpsApi({ listOrganizations }) });

    await user.click(await screen.findByRole('button', { name: LOAD_MORE }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('admin:paging.loadMoreFailed'));
    expect(alert).toHaveTextContent(t('admin:organizations.errors.rateLimited'));
    await user.click(trigger());
    expect(await screen.findByRole('option', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('shows the error the form gives the field', async () => {
    renderPicker({ error: t('admin:sso.errors.organizationRequired') });
    expect(await screen.findByText(t('admin:sso.errors.organizationRequired'))).toBeInTheDocument();
  });

  it('keeps Enter in the search field from submitting the form around the picker', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    renderOps(
      (opsApi) => (
        <form onSubmit={onSubmit}>
          <input aria-label="Other field" />
          <Picker opsApi={opsApi} enabled error={undefined} onValueChange={vi.fn()} />
          <button type="submit">Submit</button>
        </form>
      ),
      { opsApi: makeOpsApi({ listOrganizations: listing() }) },
    );
    await screen.findByRole('combobox', { name: ORGANIZATION });

    await user.type(searchField(), 'be{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    // Control: Enter in any other field of the form still submits it.
    await user.type(screen.getByRole('textbox', { name: 'Other field' }), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not call the API while it is not enabled', async () => {
    const listOrganizations = listing();
    renderPicker({ opsApi: makeOpsApi({ listOrganizations }), enabled: false });
    expect(await screen.findByRole('combobox', { name: ORGANIZATION })).toBeInTheDocument();
    expect(listOrganizations).not.toHaveBeenCalled();
  });
});
