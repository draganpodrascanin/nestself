import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrgAdminApi } from '@nestself/api-client';
import type { MemberItem } from '@nestself/contracts';
import { useMembers } from './use-org-admin';

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

function setup() {
  const listMembers = vi.fn().mockResolvedValue({
    items: [member('user_ana', 'Ana Nikolić'), member('user_ivana', 'Ivana Jovanović')],
    nextCursor: null,
  });
  const adminApi = { listMembers } as unknown as OrgAdminApi;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { adminApi, listMembers, wrapper };
}

describe('useMembers', () => {
  it('asks for the first page of active members and names them by user id', async () => {
    const { adminApi, listMembers, wrapper } = setup();

    const { result } = renderHook(() => useMembers(adminApi, 'org_sample'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listMembers).toHaveBeenCalledWith('org_sample', { status: 'ACTIVE', limit: 100 });
    expect(result.current.data).toEqual([
      { userId: 'user_ana', displayName: 'Ana Nikolić' },
      { userId: 'user_ivana', displayName: 'Ivana Jovanović' },
    ]);
  });

  it('sends the search text to the API as it was typed', async () => {
    const { adminApi, listMembers, wrapper } = setup();

    const { result } = renderHook(() => useMembers(adminApi, 'org_sample', '50%_\\ana'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The API escapes %, _ and \ itself: the client sends the text unchanged.
    expect(listMembers).toHaveBeenCalledWith('org_sample', { status: 'ACTIVE', limit: 100, search: '50%_\\ana' });
  });

  it('keeps the answers of different searches apart, and shares the one without a search', async () => {
    const { adminApi, listMembers, wrapper } = setup();

    const plain = renderHook(() => useMembers(adminApi, 'org_sample'), { wrapper });
    const sameAgain = renderHook(() => useMembers(adminApi, 'org_sample', ''), { wrapper });
    const searched = renderHook(() => useMembers(adminApi, 'org_sample', 'ana'), { wrapper });

    await waitFor(() => expect(searched.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(plain.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(sameAgain.result.current.isSuccess).toBe(true));
    // One request for "no search" (shared by both), one for "ana".
    expect(listMembers).toHaveBeenCalledTimes(2);
    expect(listMembers).toHaveBeenCalledWith('org_sample', { status: 'ACTIVE', limit: 100 });
    expect(listMembers).toHaveBeenCalledWith('org_sample', { status: 'ACTIVE', limit: 100, search: 'ana' });
  });

  it('does not ask without an organization', () => {
    const { adminApi, listMembers, wrapper } = setup();

    renderHook(() => useMembers(adminApi, null, 'ana'), { wrapper });

    expect(listMembers).not.toHaveBeenCalled();
  });
});
