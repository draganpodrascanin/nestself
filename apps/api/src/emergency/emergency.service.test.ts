/**
 * EmergencyService unit tests: the request, approve, deny and revoke rules
 * (API-R-26, CONF-R-08) and the single-record read (CONF-R-09, CONF-R-10).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { EmergencyService } from './emergency.service.js';

const NOW = new Date('2026-10-24T10:00:00.000Z');
const minutes = (n: number): Date => new Date(NOW.getTime() + n * 60_000);

const REQUESTER = { userId: 'user_nikola', sessionId: 'sess_n', context: { kind: 'operations' } } as Principal;
const APPROVER = { userId: 'user_admin_test', sessionId: 'sess_a', context: { kind: 'operations' } } as Principal;
const PURPOSE = 'Safeguarding concern raised by the assigned expert';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ema_1',
    userId: 'user_nikola',
    approvedByUserId: null,
    approvedAt: null,
    purpose: PURPOSE,
    scopeKind: 'CASE',
    scopeId: 'case_1',
    requestedDurationMinutes: 30,
    grantedAt: NOW,
    expiresAt: minutes(30),
    revokedAt: null,
    revokedByUserId: null,
    ...overrides,
  };
}

const ACTIVE = row({ approvedByUserId: 'user_admin_test', approvedAt: NOW });

const CONVERSATION = {
  id: 'conv_1',
  orgId: 'org_1',
  caseId: 'case_1',
  employeeUserId: 'user_jovan',
  expertUserId: 'user_milica',
  createdAt: NOW,
};
const MESSAGE = { id: 'msg_1', conversationId: 'conv_1', authorUserId: 'user_jovan', body: 'Sample message (fixture)', createdAt: NOW };
const INTAKE = { id: 'intake_1', orgId: 'org_1', caseId: 'case_1', employeeUserId: 'user_jovan', body: 'Sample intake (fixture)', createdAt: NOW };

function setup() {
  const authzRepo = {
    createEmergencyRequest: vi.fn().mockImplementation((v: Record<string, unknown>) => Promise.resolve(row(v))),
    findEmergencyAccess: vi.fn().mockResolvedValue(row()),
    listEmergencyAccess: vi.fn().mockResolvedValue([row()]),
    approveEmergencyAccess: vi
      .fn()
      .mockImplementation((id: string, by: string, at: Date, expiresAt: Date) =>
        Promise.resolve(row({ id, approvedByUserId: by, approvedAt: at, grantedAt: at, expiresAt })),
      ),
    deleteEmergencyRequest: vi.fn().mockResolvedValue(true),
    revokeEmergencyAccess: vi
      .fn()
      .mockImplementation((id: string, by: string, at: Date) =>
        Promise.resolve({ ...ACTIVE, id, revokedAt: at, revokedByUserId: by }),
      ),
  };
  const professional = {
    findConversation: vi.fn().mockResolvedValue(CONVERSATION),
    listMessages: vi.fn().mockResolvedValue([MESSAGE]),
    findIntake: vi.fn().mockResolvedValue(INTAKE),
  };
  const authz = { require: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const principals = { invalidateUser: vi.fn().mockResolvedValue(undefined) };
  const db = { withTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn('tx')) };
  const service = new EmergencyService(
    authzRepo as never,
    professional as never,
    authz as never,
    audit as never,
    principals as never,
    db as never,
  );
  return { authzRepo, professional, authz, audit, principals, db, service };
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiHttpException);
  expect((err as ApiHttpException).getStatus()).toBe(status);
  expect((err as ApiHttpException).code).toBe(code);
}

describe('EmergencyService', () => {
  let ctx: ReturnType<typeof setup>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    ctx = setup();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('request', () => {
    it('creates a pending record with a provisional window and audits the truncated purpose', async () => {
      const longPurpose = 'p'.repeat(800);
      const res = await ctx.service.request(
        { purpose: longPurpose, scopeKind: 'CASE', scopeId: 'case_1', durationMinutes: 30 },
        REQUESTER,
      );

      expect(ctx.authzRepo.createEmergencyRequest).toHaveBeenCalledWith(
        {
          userId: 'user_nikola',
          purpose: longPurpose,
          scopeKind: 'CASE',
          scopeId: 'case_1',
          requestedDurationMinutes: 30,
          grantedAt: NOW,
          expiresAt: minutes(30),
        },
        'tx',
      );
      expect(res).toMatchObject({
        userId: 'user_nikola',
        approvedByUserId: null,
        approvedAt: null,
        durationMinutes: 30,
        grantedAt: NOW.toISOString(),
        expiresAt: minutes(30).toISOString(),
        revokedAt: null,
      });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'emergency_access.requested',
          actorUserId: 'user_nikola',
          actorKind: 'USER',
          recordType: 'emergency_access',
          details: { purpose: 'p'.repeat(500), scopeKind: 'CASE', scopeId: 'case_1', durationMinutes: 30 },
        }),
      );
      expect(ctx.principals.invalidateUser).toHaveBeenCalledWith('user_nikola');
    });
  });

  describe('approve', () => {
    it('rejects the requester approving their own request with 403 self_approval_denied', async () => {
      await expectApiError(ctx.service.approve('ema_1', REQUESTER), 403, 'self_approval_denied');
      expect(ctx.authzRepo.approveEmergencyAccess).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'access.denied',
          result: 'DENIED',
          recordId: 'ema_1',
          details: expect.objectContaining({ reason: 'self_approval_denied' }),
        }),
      );
    });

    it('restarts the window at approval time, audits, logs the metric line and invalidates the requester', async () => {
      const res = await ctx.service.approve('ema_1', APPROVER);

      expect(ctx.authzRepo.approveEmergencyAccess).toHaveBeenCalledWith('ema_1', 'user_admin_test', NOW, minutes(30), 'tx');
      expect(res).toMatchObject({
        approvedByUserId: 'user_admin_test',
        approvedAt: NOW.toISOString(),
        grantedAt: NOW.toISOString(),
        expiresAt: minutes(30).toISOString(),
      });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'emergency_access.approved', actorUserId: 'user_admin_test', recordId: 'ema_1' }),
      );
      expect(warn).toHaveBeenCalledWith(
        { action: 'emergency_access.approved', emergencyAccessId: 'ema_1' },
        'Emergency access approved',
      );
      expect(ctx.principals.invalidateUser).toHaveBeenCalledWith('user_nikola');
    });

    it('caps the window at 240 minutes whatever was requested', async () => {
      ctx.authzRepo.findEmergencyAccess.mockResolvedValue(row({ requestedDurationMinutes: 600 }));
      await ctx.service.approve('ema_1', APPROVER);
      expect(ctx.authzRepo.approveEmergencyAccess).toHaveBeenCalledWith('ema_1', 'user_admin_test', NOW, minutes(240), 'tx');
    });

    it('answers 404 for an unknown id and 409 conflict for a record that is no longer pending', async () => {
      ctx.authzRepo.findEmergencyAccess.mockResolvedValueOnce(null);
      await expectApiError(ctx.service.approve('nope', APPROVER), 404, 'not_found');

      ctx.authzRepo.findEmergencyAccess.mockResolvedValueOnce(ACTIVE);
      await expectApiError(ctx.service.approve('ema_1', APPROVER), 409, 'conflict');

      // A concurrent approval wins the conditional update.
      ctx.authzRepo.approveEmergencyAccess.mockResolvedValueOnce(null);
      await expectApiError(ctx.service.approve('ema_1', APPROVER), 409, 'conflict');
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('deny', () => {
    it('deletes a pending request and audits emergency_access.denied', async () => {
      await ctx.service.deny('ema_1', APPROVER);
      expect(ctx.authzRepo.deleteEmergencyRequest).toHaveBeenCalledWith('ema_1', 'tx');
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'emergency_access.denied', actorUserId: 'user_admin_test', recordId: 'ema_1' }),
      );
      expect(ctx.principals.invalidateUser).toHaveBeenCalledWith('user_nikola');
    });

    it('answers 409 conflict for an approved record', async () => {
      ctx.authzRepo.findEmergencyAccess.mockResolvedValue(ACTIVE);
      await expectApiError(ctx.service.deny('ema_1', APPROVER), 409, 'conflict');
      expect(ctx.authzRepo.deleteEmergencyRequest).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on an active record and audits emergency_access.revoked', async () => {
      ctx.authzRepo.findEmergencyAccess.mockResolvedValue(ACTIVE);
      const res = await ctx.service.revoke('ema_1', APPROVER);
      expect(ctx.authzRepo.revokeEmergencyAccess).toHaveBeenCalledWith('ema_1', 'user_admin_test', NOW, 'tx');
      expect(res.revokedAt).toBe(NOW.toISOString());
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'emergency_access.revoked', actorUserId: 'user_admin_test', recordId: 'ema_1' }),
      );
      expect(ctx.principals.invalidateUser).toHaveBeenCalledWith('user_nikola');
    });

    it('answers 409 emergency_not_active for a pending, revoked or expired record', async () => {
      for (const r of [row(), row({ ...ACTIVE, revokedAt: NOW }), row({ ...ACTIVE, expiresAt: minutes(-1) })]) {
        ctx.authzRepo.findEmergencyAccess.mockResolvedValueOnce(r);
        await expectApiError(ctx.service.revoke('ema_1', APPROVER), 409, 'emergency_not_active');
      }
      expect(ctx.authzRepo.revokeEmergencyAccess).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('maps every record to the response shape', async () => {
      const res = await ctx.service.list({});
      expect(ctx.authzRepo.listEmergencyAccess).toHaveBeenCalledWith({});
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({ id: 'ema_1', durationMinutes: 30, approvedAt: null });
    });
  });

  describe('readRecord', () => {
    beforeEach(() => {
      ctx.authzRepo.findEmergencyAccess.mockResolvedValue(ACTIVE);
    });

    it('authorizes the conversation as a confidential resource, returns it and audits the read without content', async () => {
      const res = await ctx.service.readRecord(REQUESTER, 'ema_1', 'conversation', 'conv_1');

      expect(ctx.authz.require).toHaveBeenCalledWith(REQUESTER, 'records.read.emergency', {
        type: 'conversation',
        id: 'case_1',
        orgId: 'org_1',
        ownerId: 'user_jovan',
        isConfidential: true,
      });
      expect(res).toEqual({
        emergencyAccessId: 'ema_1',
        recordType: 'conversation',
        recordId: 'conv_1',
        content: {
          id: 'conv_1',
          caseId: 'case_1',
          orgId: 'org_1',
          messages: [{ id: 'msg_1', authorUserId: 'user_jovan', body: 'Sample message (fixture)', createdAt: NOW }],
        },
      });
      expect(ctx.audit.record).toHaveBeenCalledWith({
        action: 'emergency_access.used',
        actorUserId: 'user_nikola',
        actorKind: 'USER',
        orgId: 'org_1',
        recordType: 'emergency_access',
        recordId: 'ema_1',
        result: 'ALLOWED',
        sessionId: 'sess_n',
        details: { emergencyAccessId: 'ema_1', recordType: 'conversation', recordId: 'conv_1' },
      });
      expect(JSON.stringify(ctx.audit.record.mock.calls)).not.toContain('Sample message');
    });

    it('reads an intake record in the same shape as the professional route', async () => {
      const res = await ctx.service.readRecord(REQUESTER, 'ema_1', 'intake', 'intake_1');
      expect(res.content).toEqual({ id: 'intake_1', caseId: 'case_1', orgId: 'org_1', body: 'Sample intake (fixture)', createdAt: NOW });
    });

    it('propagates the engine denial (expired, revoked, out of scope) without reading content or auditing use', async () => {
      ctx.authz.require.mockRejectedValue(new ApiHttpException({ status: 403, code: 'forbidden', message: 'Access denied' }));
      await expectApiError(ctx.service.readRecord(REQUESTER, 'ema_1', 'conversation', 'conv_1'), 403, 'forbidden');
      expect(ctx.professional.listMessages).not.toHaveBeenCalled();
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it("answers 404 for another user's record, an unknown record or an unknown id", async () => {
      ctx.authzRepo.findEmergencyAccess.mockResolvedValueOnce({ ...ACTIVE, userId: 'user_other' });
      await expectApiError(ctx.service.readRecord(REQUESTER, 'ema_1', 'conversation', 'conv_1'), 404, 'not_found');

      ctx.authzRepo.findEmergencyAccess.mockResolvedValueOnce(null);
      await expectApiError(ctx.service.readRecord(REQUESTER, 'nope', 'conversation', 'conv_1'), 404, 'not_found');

      ctx.professional.findConversation.mockResolvedValueOnce(null);
      await expectApiError(ctx.service.readRecord(REQUESTER, 'ema_1', 'conversation', 'conv_x'), 404, 'not_found');
      expect(ctx.authz.require).not.toHaveBeenCalled();
    });

    it('answers 403 emergency_not_active when the named record is not the one that covers the read', async () => {
      // Another active record lets the engine allow, but the path names a pending one.
      ctx.authzRepo.findEmergencyAccess.mockResolvedValueOnce(row());
      await expectApiError(ctx.service.readRecord(REQUESTER, 'ema_1', 'conversation', 'conv_1'), 403, 'emergency_not_active');

      // An active record whose scope is a different case.
      ctx.authzRepo.findEmergencyAccess.mockResolvedValueOnce({ ...ACTIVE, scopeId: 'case_other' });
      await expectApiError(ctx.service.readRecord(REQUESTER, 'ema_1', 'conversation', 'conv_1'), 403, 'emergency_not_active');

      expect(ctx.professional.listMessages).not.toHaveBeenCalled();
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it('rejects a caller outside the operations context', async () => {
      const expert = { ...REQUESTER, context: { kind: 'expert' } } as Principal;
      await expectApiError(ctx.service.readRecord(expert, 'ema_1', 'conversation', 'conv_1'), 403, 'context_mismatch');
    });
  });
});
