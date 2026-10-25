/**
 * The screens that need a context switch once on mount must not undo a
 * choice made in the header picker: once a mount has seen its context, a
 * later change of context does not trigger another switch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Principal } from '@nestself/contracts';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';
import { useOrgContext } from '../people/use-org-context';
import { useExpertContext } from '../cases/use-expert-context';
import { makeAuth } from '../cases/cases-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithAuth<T>(hook: () => T, initial: AuthContextValue) {
  let auth = initial;
  const wrapper = ({ children }: { children: ReactNode }) => <AuthContext value={auth}>{children}</AuthContext>;
  const utils = renderHook(hook, { wrapper });
  return {
    ...utils,
    setPrincipal(principal: Principal) {
      auth = { ...auth, principal };
      utils.rerender();
    },
  };
}

const HR = SAMPLE_PRINCIPALS.hr_admin.principal;
const EXPERT = SAMPLE_PRINCIPALS.expert.principal;

describe('useOrgContext', () => {
  it('switches once when the session is not in the organization context', () => {
    const switchContext = vi.fn().mockResolvedValue(undefined);
    renderWithAuth(() => useOrgContext(false), makeAuth({ principal: { ...HR, context: { kind: 'personal' } }, switchContext }));
    expect(switchContext).toHaveBeenCalledTimes(1);
    expect(switchContext).toHaveBeenCalledWith({ kind: 'organization', orgId: 'org_sample' });
  });

  it('does not switch back after the picker moved an organization screen to another context', () => {
    const switchContext = vi.fn().mockResolvedValue(undefined);
    const { result, setPrincipal } = renderWithAuth(() => useOrgContext(false), makeAuth({ principal: HR, switchContext }));
    expect(result.current.apiOrgId).toBe('org_sample');
    setPrincipal({ ...HR, context: { kind: 'personal' } });
    expect(switchContext).not.toHaveBeenCalled();
    expect(result.current.apiOrgId).toBeNull();
  });
});

describe('useExpertContext', () => {
  it('switches once when the session is not in the expert context', () => {
    const switchContext = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderWithAuth(
      () => useExpertContext(false),
      makeAuth({ principal: { ...EXPERT, context: { kind: 'personal' } }, switchContext }),
    );
    rerender();
    expect(switchContext).toHaveBeenCalledTimes(1);
    expect(switchContext).toHaveBeenCalledWith({ kind: 'expert' });
  });

  it('does not switch back after the picker moved the expert area to another context', () => {
    const switchContext = vi.fn().mockResolvedValue(undefined);
    const { result, setPrincipal } = renderWithAuth(() => useExpertContext(false), makeAuth({ principal: EXPERT, switchContext }));
    expect(result.current.ready).toBe(true);
    setPrincipal({ ...EXPERT, context: { kind: 'personal' } });
    expect(switchContext).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
  });

  it('never switches in sample mode', () => {
    const switchContext = vi.fn();
    renderWithAuth(() => useExpertContext(true), makeAuth({ principal: { ...EXPERT, context: { kind: 'personal' } }, switchContext }));
    expect(switchContext).not.toHaveBeenCalled();
  });
});
