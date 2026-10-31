import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { hashSessionId } from '../session/session-helpers.js';
import { MeResponseBuilder, publicPrincipal } from './me-response.builder.js';

const principal = {
  userId: 'user_ivana',
  context: { kind: 'organization', orgId: 'org_sample' },
  memberships: [{ orgId: 'org_sample', status: 'ACTIVE', startDate: '2024-01-01', endDate: null }],
  staffTemplates: [],
  expert: null,
  sessionId: 'raw-cookie-value',
  tokenFamily: null,
} as unknown as Principal;

function createMockPrincipalLoader() {
  return {
    load: vi.fn().mockResolvedValue({
      ...principal,
      memberships: principal.memberships,
      staffTemplates: [],
      expert: null,
    }),
    loadAvailableContextExtras: vi.fn().mockResolvedValue({
      orgNames: new Map([['org_sample', 'Sample Org']]),
      orgGrantTemplateKeys: new Map(),
    }),
  };
}

describe('MeResponseBuilder', () => {
  it("returns the principal with the engine's effective actions and available contexts", async () => {
    const authz = { effectiveActions: vi.fn().mockResolvedValue(['program.overview', 'access.preview']) };
    const principalLoader = createMockPrincipalLoader();
    const builder = new MeResponseBuilder(authz as never, principalLoader as never);

    const me = await builder.build(principal);

    expect(authz.effectiveActions).toHaveBeenCalledWith(principal);
    expect(me.principal).toEqual({ ...principal, sessionId: hashSessionId('raw-cookie-value') });
    expect(me.effectiveActions).toEqual(['program.overview', 'access.preview']);
    expect(me.availableContexts).toBeDefined();
    expect(Array.isArray(me.availableContexts)).toBe(true);
  });

  it('never hands the raw session id (the cookie value) to the client, only its hash', async () => {
    const authz = { effectiveActions: vi.fn().mockResolvedValue([]) };
    const me = await new MeResponseBuilder(authz as never, createMockPrincipalLoader() as never).build(principal);

    expect(JSON.stringify(me)).not.toContain('raw-cookie-value');
    // The same value the sessions list names a session by, so a client can tell its own session apart.
    expect(me.principal.sessionId).toBe(hashSessionId('raw-cookie-value'));
  });

  it('keeps a bearer principal without a session at null', () => {
    expect(publicPrincipal({ ...principal, sessionId: null, tokenFamily: 'fam-1' }).sessionId).toBeNull();
  });

  it('propagates a failure instead of answering with an empty list', async () => {
    const authz = { effectiveActions: vi.fn().mockRejectedValue(new Error('db down')) };
    const principalLoader = createMockPrincipalLoader();
    await expect(new MeResponseBuilder(authz as never, principalLoader as never).build(principal)).rejects.toThrow('db down');
  });
});
