import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiError } from '@nestself/api-client';
import { SampleAuthProvider } from './sample-auth-provider';
import { useAuth } from './auth-context';

afterEach(cleanup);

function renderSample(initialRole: 'hr_admin' | 'admin') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SampleAuthProvider initialRole={initialRole}>{children}</SampleAuthProvider>
  );
  return renderHook(() => useAuth(), { wrapper });
}

describe('SampleAuthProvider context switching', () => {
  it('switches the sample principal locally', async () => {
    const { result } = renderSample('hr_admin');
    // Ruling E: hr_admin defaults to personal context.
    expect(result.current.principal?.context).toEqual({ kind: 'personal', orgId: 'org_sample' });
    await act(() => result.current.switchContext({ kind: 'organization', orgId: 'org_sample' }));
    expect(result.current.principal?.context).toEqual({ kind: 'organization', orgId: 'org_sample' });
    await act(() => result.current.switchContext({ kind: 'personal' }));
    expect(result.current.principal?.context).toEqual({ kind: 'personal' });
  });

  it('refuses a context the sample principal could not hold, as the API does', async () => {
    const { result } = renderSample('hr_admin');
    for (const context of [
      { kind: 'organization' as const, orgId: 'org_other' },
      { kind: 'expert' as const },
      { kind: 'operations' as const },
    ]) {
      const err = await result.current.switchContext(context).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('invalid_context');
    }
    // Ruling E: context stays at personal (the default) after refused switches.
    expect(result.current.principal?.context).toEqual({ kind: 'personal', orgId: 'org_sample' });
  });

  it('lets staff move between operations and personal', async () => {
    const { result } = renderSample('admin');
    await act(() => result.current.switchContext({ kind: 'personal' }));
    expect(result.current.principal?.context).toEqual({ kind: 'personal' });
    await act(() => result.current.switchContext({ kind: 'operations' }));
    expect(result.current.principal?.context).toEqual({ kind: 'operations' });
  });
});
