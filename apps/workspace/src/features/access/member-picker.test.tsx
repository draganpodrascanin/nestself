import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { FormEvent } from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { OrgAdminApi } from '@nestself/api-client';
import type { MemberItem } from '@nestself/contracts';
import { MemberPicker } from './member-picker';
import type { MemberPickerProps } from './member-picker';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace', 'auth']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
const t = (key: string) => testI18n.t(key);

const ORG_ID = 'org_sample';
const LABEL = 'Member';

function member(userId: string, displayName: string): MemberItem {
  return {
    membershipId: `mem_${userId}`,
    userId,
    displayName,
    email: `${userId}@example.test`,
    orgUnitId: null,
    costCenterUnitId: null,
    lineManagerUserId: null,
    status: 'ACTIVE',
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: null,
  };
}

const IVANA = member('user_ivana', 'Ivana Jovanović');
const STEFAN = member('user_stefan', 'Stefan Marković');
const ANA = member('user_ana', 'Ana Nikolić');
const MEMBERS = [IVANA, STEFAN, ANA];

/** A member list that answers `search` as the API does: a prefix of the name or the email. */
function listing(all: MemberItem[] = MEMBERS) {
  return vi.fn(async (_orgId: string, query: { search?: string }) => {
    const term = query.search?.toLowerCase();
    return {
      items: all.filter(
        (m) => !term || m.displayName.toLowerCase().startsWith(term) || m.email.toLowerCase().startsWith(term),
      ),
      nextCursor: null,
    };
  });
}

function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null });
}

function renderPicker(
  opts: { listMembers?: ReturnType<typeof vi.fn>; onValueChange?: Mock<(userId: string | null) => void> } & Partial<MemberPickerProps> = {},
) {
  const { listMembers = listing(), onValueChange = vi.fn<(userId: string | null) => void>(), ...props } = opts;
  const adminApi = { listMembers } as unknown as OrgAdminApi;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <MemberPicker
          adminApi={adminApi}
          orgId={ORG_ID}
          id="picker-member"
          label={LABEL}
          placeholder={t('workspace:access.assign.choose')}
          onValueChange={onValueChange}
          {...props}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { ...result, listMembers, onValueChange };
}

const searchField = () => screen.getByRole('searchbox', { name: new RegExp(`^${t('workspace:access.memberSearch.label')}`) });
const trigger = () => screen.getByRole('combobox', { name: LABEL });

async function optionNames() {
  const options = await screen.findAllByRole('option');
  return options.map((o) => o.textContent);
}

async function pick(user: UserEvent, name: string) {
  await user.click(trigger());
  await user.click(await screen.findByRole('option', { name }));
}

afterEach(() => {
  cleanup();
});

describe('MemberPicker', () => {
  it('offers the first page of active members and reports the one picked', async () => {
    const user = userEvent.setup();
    const { listMembers, onValueChange } = renderPicker();

    await user.click(trigger());
    expect(await optionNames()).toEqual(['Ivana Jovanović', 'Stefan Marković', 'Ana Nikolić']);
    await user.click(screen.getByRole('option', { name: 'Ana Nikolić' }));

    expect(listMembers).toHaveBeenCalledWith(ORG_ID, { status: 'ACTIVE', limit: 100 });
    expect(onValueChange).toHaveBeenCalledWith('user_ana');
    expect(trigger()).toHaveTextContent('Ana Nikolić');
  });

  it('searches through the API once the typing pauses, not on every keystroke', async () => {
    const user = userEvent.setup();
    const { listMembers } = renderPicker();
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(1));

    await user.type(searchField(), ' ana ');

    await waitFor(() => expect(listMembers).toHaveBeenLastCalledWith(ORG_ID, { status: 'ACTIVE', limit: 100, search: 'ana' }));
    expect(listMembers).not.toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ search: 'an' }));
    expect(listMembers).toHaveBeenCalledTimes(2);
    await user.click(trigger());
    expect(await optionNames()).toEqual(['Ana Nikolić']);
  });

  it('sends special characters as typed: the API escapes them, the client does not', async () => {
    const user = userEvent.setup();
    const { listMembers } = renderPicker();

    await user.type(searchField(), '50%_\\');

    await waitFor(() => expect(listMembers).toHaveBeenLastCalledWith(ORG_ID, { status: 'ACTIVE', limit: 100, search: '50%_\\' }));
  });

  it('keeps the chosen member shown and selectable when a later search no longer returns them', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderPicker();
    await pick(user, 'Ana Nikolić');

    await user.type(searchField(), 'zzz');

    expect(await screen.findByText(t('workspace:access.memberSearch.noMatch'))).toBeInTheDocument();
    expect(trigger()).toHaveTextContent('Ana Nikolić');
    await user.click(trigger());
    expect(await optionNames()).toEqual(['Ana Nikolić']);
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('lets the user pick another member after a second search', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderPicker();
    await pick(user, 'Ana Nikolić');

    await user.clear(searchField());
    await user.type(searchField(), 'Stefan');
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: 'Stefan Marković' }));

    // Only the two choices are reported; the picker never reports a cleared choice.
    expect(onValueChange.mock.calls).toEqual([['user_ana'], ['user_stefan']]);
    expect(trigger()).toHaveTextContent('Stefan Marković');
  });

  it('says when no member matches and when there are none', async () => {
    const user = userEvent.setup();
    renderPicker({ listMembers: listing([]) });
    expect(await screen.findByText(t('workspace:access.memberSearch.empty'))).toBeInTheDocument();

    await user.type(searchField(), 'zzz');

    expect(await screen.findByText(t('workspace:access.memberSearch.noMatch'))).toBeInTheDocument();
    // The result of a search is announced: the note is a live region.
    expect(screen.getAllByRole('status').some((el) => el.textContent === t('workspace:access.memberSearch.noMatch'))).toBe(true);
  });

  it('leaves out the member the form excludes', async () => {
    const user = userEvent.setup();
    renderPicker({ excludeUserId: 'user_ivana' });

    await user.click(trigger());

    expect(await optionNames()).toEqual(['Stefan Marković', 'Ana Nikolić']);
  });

  it('renders a failed search as translated copy, never the API message', async () => {
    const user = userEvent.setup();
    const listMembers = vi
      .fn()
      .mockResolvedValueOnce({ items: MEMBERS, nextCursor: null })
      .mockRejectedValue(apiError(429, 'rate_limited'));
    renderPicker({ listMembers });
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(1));

    await user.type(searchField(), 'ana');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('workspace:access.errors.membersLoadTitle'));
    expect(alert).toHaveTextContent(t('workspace:access.errors.rateLimited'));
    expect(screen.queryByText(/English rate_limited/)).not.toBeInTheDocument();
  });

  it('falls back to the generic copy for a failure it has no copy for', async () => {
    const user = userEvent.setup();
    const listMembers = vi
      .fn()
      .mockResolvedValueOnce({ items: MEMBERS, nextCursor: null })
      .mockRejectedValue(apiError(500, 'internal_error'));
    renderPicker({ listMembers });
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(1));

    await user.type(searchField(), 'ana');

    expect(await screen.findByRole('alert')).toHaveTextContent(t('workspace:access.errors.unknown'));
  });

  it('leaves the failure of the plain member list to the screen, which reports it once', async () => {
    renderPicker({ listMembers: vi.fn().mockRejectedValue(apiError(429, 'rate_limited')) });

    await waitFor(() => expect(trigger()).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error the form gives the field', async () => {
    renderPicker({ error: t('workspace:access.errors.memberRequired') });

    expect(await screen.findByText(t('workspace:access.errors.memberRequired'))).toBeInTheDocument();
  });

  it('keeps Enter in the search field from submitting the form around the picker', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const adminApi = { listMembers: listing() } as unknown as OrgAdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={testI18n}>
          <form onSubmit={onSubmit}>
            <input aria-label="Other field" />
            <MemberPicker
              adminApi={adminApi}
              orgId={ORG_ID}
              id="picker-member"
              label={LABEL}
              placeholder="Choose"
              onValueChange={vi.fn()}
            />
            <button type="submit">Submit</button>
          </form>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    await user.type(searchField(), 'ana{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    // Control: Enter in any other field of the form still submits it.
    await user.type(screen.getByRole('textbox', { name: 'Other field' }), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not call the API without an organization', async () => {
    const { listMembers } = renderPicker({ orgId: null });

    expect(await screen.findByRole('combobox', { name: LABEL })).toBeInTheDocument();
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('searches the sample members in the browser, without any request', async () => {
    const user = userEvent.setup();
    const { listMembers } = renderPicker({
      orgId: null,
      sampleMembers: [
        { userId: 'user_ivana', displayName: 'Ivana Jovanović' },
        { userId: 'user_ana', displayName: 'Ana Nikolić' },
      ],
    });

    await user.type(searchField(), 'an');
    await user.click(trigger());

    // The list narrows once the typing pauses.
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ana Nikolić']));
    expect(listMembers).not.toHaveBeenCalled();
  });
});
