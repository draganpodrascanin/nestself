import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileService } from './profile.service.js';

const PRINCIPAL = {
  userId: 'user-1',
  displayName: 'Ana Petrović',
  initials: 'AP',
  locale: 'sr-Latn' as const,
  memberships: [],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal' as const },
  auth: { method: 'email_otp' as const, time: new Date().toISOString(), secondFactor: false, lastStepUpAt: null },
  sessionId: 'sess-1',
  tokenFamily: null,
};
const META = { ip: '203.0.113.1', userAgent: 'test' };

function createMocks() {
  return {
    identities: { updateProfile: vi.fn().mockResolvedValue({ id: 'user-1' }) },
    principalLoader: {
      invalidateUser: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue({
        userId: 'user-1',
        displayName: 'Ana Petrović',
        initials: 'AP',
        locale: 'sr-Latn',
        memberships: [],
        staffTemplates: [],
        expert: null,
        isSuspended: false,
        isDeactivated: false,
      }),
      loadAvailableContextExtras: vi.fn().mockResolvedValue({
        orgGrantTemplateKeys: new Map(),
        orgNames: new Map(),
      }),
    },
    contextLoader: {
      build: vi.fn().mockResolvedValue({
        now: new Date(),
        isDeactivated: false,
        isSuspended: false,
        grants: [],
        assignments: [],
        ancestorIds: [],
        orgSelfApprovalAllowed: false,
        organizationTimezone: 'Europe/Belgrade',
      }),
    },
    audit: { record: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('ProfileService', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: ProfileService;

  beforeEach(() => {
    mocks = createMocks();
    service = new ProfileService(
      mocks.identities as never,
      mocks.principalLoader as never,
      mocks.contextLoader as never,
      mocks.audit as never,
    );
  });

  it('updates the locale, audits and invalidates the principal cache', async () => {
    const result = await service.updateLocale(PRINCIPAL, 'hu', META);

    expect(mocks.identities.updateProfile).toHaveBeenCalledWith('user-1', { locale: 'hu' });
    expect(result.principal.locale).toBe('hu');
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.updated', actorUserId: 'user-1', details: { fields: ['locale'] } }),
    );
    expect(mocks.principalLoader.invalidateUser).toHaveBeenCalledWith('user-1');
  });

  it('updates the display name and recomputes the initials', async () => {
    const result = await service.updateDisplayName(PRINCIPAL, 'Milica Ristić', META);
    expect(result.principal.displayName).toBe('Milica Ristić');
    expect(result.principal.initials).toBe('MR');
  });

  it('returns 401 when the user row is gone', async () => {
    mocks.identities.updateProfile.mockResolvedValue(null);
    await expect(service.updateLocale(PRINCIPAL, 'en', META)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.audit.record).not.toHaveBeenCalled();
  });
});
