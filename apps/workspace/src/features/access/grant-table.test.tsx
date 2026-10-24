import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import type { GrantResponse } from '@nestself/contracts';
import { GrantTable } from './grant-table';

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});

function grant(id: string, validFrom: string): GrantResponse {
  return {
    id,
    subjectUserId: 'user_stefan',
    templateKey: 'team_manager',
    actions: [],
    scopeType: 'organization',
    scopeOrgId: 'org_sample',
    scopeOrgUnitId: null,
    includeDescendants: false,
    conditions: [],
    validFrom,
    validUntil: null,
    parentGrantId: null,
    grantedByUserId: 'user_ivana',
    grantedAt: validFrom,
    revokedAt: null,
  };
}

function table(grants: GrantResponse[]) {
  return (
    <I18nextProvider i18n={testI18n}>
      <GrantTable grants={grants} members={[]} orgUnits={[]} currentUserId="user_ivana" canRevoke={false} canDelegate={false} actionsDisabled={false} onRevoke={() => {}} onDelegate={() => {}} />
    </I18nextProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GrantTable status', () => {
  it('follows the current time: a grant created after the first render shows Active, not Scheduled', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T10:00:00.000Z'));
    const { rerender } = render(table([]));

    // A minute later the user creates a grant; its validFrom is a second ago.
    vi.setSystemTime(new Date('2026-10-24T10:01:00.000Z'));
    rerender(table([grant('g_new', '2026-10-24T10:00:59.000Z')]));

    const row = screen.getAllByRole('row')[1]!;
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).queryByText('Scheduled')).not.toBeInTheDocument();
  });

  it('still shows Scheduled for a grant that starts in the future', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T10:00:00.000Z'));
    render(table([grant('g_later', '2026-10-25T00:00:00.000Z')]));
    expect(within(screen.getAllByRole('row')[1]!).getByText('Scheduled')).toBeInTheDocument();
  });
});
