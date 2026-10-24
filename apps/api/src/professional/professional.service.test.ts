/**
 * ProfessionalService unit tests: every read authorizes the loaded row as a
 * confidential resource before anything is returned (T-2.4, CONF-R-03).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { ProfessionalService } from './professional.service.js';

const PRINCIPAL = { userId: 'user_milica' } as Principal;
const CREATED = new Date('2026-10-01T09:00:00.000Z');

const CONVERSATION = {
  id: 'conv_1',
  orgId: 'org_1',
  caseId: 'case_1',
  employeeUserId: 'user_jovan',
  expertUserId: 'user_milica',
  createdAt: CREATED,
};
const MESSAGE = {
  id: 'msg_1',
  conversationId: 'conv_1',
  authorUserId: 'user_jovan',
  body: 'Sample message (fixture)',
  createdAt: CREATED,
};
const INTAKE = {
  id: 'intake_1',
  orgId: 'org_1',
  caseId: 'case_1',
  employeeUserId: 'user_jovan',
  body: 'Sample intake (fixture)',
  createdAt: CREATED,
};

function setup() {
  const repo = {
    findConversation: vi.fn().mockResolvedValue(CONVERSATION),
    listMessages: vi.fn().mockResolvedValue([MESSAGE]),
    findIntake: vi.fn().mockResolvedValue(INTAKE),
    listConversationsByCaseIds: vi.fn().mockResolvedValue([]),
    listConversationsByEmployee: vi.fn().mockResolvedValue([]),
  };
  const authz = { require: vi.fn().mockResolvedValue(undefined), allows: vi.fn().mockResolvedValue(true) };
  const authzRepo = { findActiveAssignments: vi.fn().mockResolvedValue([]) };
  const service = new ProfessionalService(repo as never, authz as never, authzRepo as never);
  return { repo, authz, authzRepo, service };
}

const FORBIDDEN = new ApiHttpException({ status: 403, code: 'forbidden', message: 'Access denied' });

describe('ProfessionalService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  describe.each([
    ['readAssignedConversation', 'conversation.read.assigned'],
    ['readOwnConversation', 'conversation.participate'],
  ] as const)('%s', (method, action) => {
    it(`requires ${action} on the confidential conversation resource and returns its messages`, async () => {
      const res = await ctx.service[method](PRINCIPAL, 'conv_1');

      expect(ctx.authz.require).toHaveBeenCalledWith(PRINCIPAL, action, {
        type: 'conversation',
        id: 'case_1',
        orgId: 'org_1',
        ownerId: 'user_jovan',
        isConfidential: true,
      });
      expect(res).toEqual({
        id: 'conv_1',
        caseId: 'case_1',
        orgId: 'org_1',
        messages: [{ id: 'msg_1', authorUserId: 'user_jovan', body: 'Sample message (fixture)', createdAt: CREATED }],
      });
    });

    it('throws 404 not_found when the conversation does not exist, without authorizing', async () => {
      ctx.repo.findConversation.mockResolvedValue(null);
      const err = await ctx.service[method](PRINCIPAL, 'conv_missing').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiHttpException);
      expect((err as ApiHttpException).getStatus()).toBe(404);
      expect((err as ApiHttpException).code).toBe('not_found');
      expect(ctx.authz.require).not.toHaveBeenCalled();
      expect(ctx.repo.listMessages).not.toHaveBeenCalled();
    });

    it('never reads the messages when authorization is denied', async () => {
      ctx.authz.require.mockRejectedValue(FORBIDDEN);
      await expect(ctx.service[method](PRINCIPAL, 'conv_1')).rejects.toBe(FORBIDDEN);
      expect(ctx.repo.listMessages).not.toHaveBeenCalled();
    });
  });

  describe('readAssignedIntake', () => {
    it('requires conversation.read.assigned on the confidential intake resource', async () => {
      const res = await ctx.service.readAssignedIntake(PRINCIPAL, 'intake_1');

      expect(ctx.authz.require).toHaveBeenCalledWith(PRINCIPAL, 'conversation.read.assigned', {
        type: 'intake',
        id: 'case_1',
        orgId: 'org_1',
        ownerId: 'user_jovan',
        isConfidential: true,
      });
      expect(res).toEqual({
        id: 'intake_1',
        caseId: 'case_1',
        orgId: 'org_1',
        body: 'Sample intake (fixture)',
        createdAt: CREATED,
      });
    });

    it('throws 404 not_found when the intake record does not exist', async () => {
      ctx.repo.findIntake.mockResolvedValue(null);
      const err = await ctx.service.readAssignedIntake(PRINCIPAL, 'intake_missing').catch((e: unknown) => e);

      expect((err as ApiHttpException).getStatus()).toBe(404);
      expect((err as ApiHttpException).code).toBe('not_found');
      expect(ctx.authz.require).not.toHaveBeenCalled();
    });

    it('propagates a denial', async () => {
      ctx.authz.require.mockRejectedValue(FORBIDDEN);
      await expect(ctx.service.readAssignedIntake(PRINCIPAL, 'intake_1')).rejects.toBe(FORBIDDEN);
    });
  });

  describe('conversation lists (metadata only)', () => {
    const SUMMARY_ROW = { ...CONVERSATION, messageCount: 3 };
    const OTHER_ROW = { ...CONVERSATION, id: 'conv_2', caseId: 'case_2', messageCount: 0 };
    const assignment = (kind: string, targetId: string) => ({ id: `a_${kind}_${targetId}`, kind, targetId });

    it('listAssignedConversations reads only CASE and SUPPORT_CASE targets, de-duplicated', async () => {
      ctx.authzRepo.findActiveAssignments.mockResolvedValue([
        assignment('CASE', 'case_1'),
        assignment('SUPPORT_CASE', 'case_2'),
        assignment('CASE', 'case_1'),
        assignment('CLIENT', 'org_1'),
        assignment('QUEUE', 'queue_1'),
      ]);
      ctx.repo.listConversationsByCaseIds.mockResolvedValue([SUMMARY_ROW, OTHER_ROW]);

      const res = await ctx.service.listAssignedConversations(PRINCIPAL);

      expect(ctx.authzRepo.findActiveAssignments).toHaveBeenCalledWith('user_milica', expect.any(Date));
      expect(ctx.repo.listConversationsByCaseIds).toHaveBeenCalledWith(['case_1', 'case_2']);
      expect(res.items).toEqual([
        {
          id: 'conv_1',
          caseId: 'case_1',
          orgId: 'org_1',
          employeeUserId: 'user_jovan',
          expertUserId: 'user_milica',
          createdAt: CREATED.toISOString(),
          messageCount: 3,
        },
        expect.objectContaining({ id: 'conv_2', messageCount: 0 }),
      ]);
    });

    it('listAssignedConversations drops rows the engine denies and never calls require (no audit, no step-up)', async () => {
      ctx.authzRepo.findActiveAssignments.mockResolvedValue([assignment('CASE', 'case_1'), assignment('CASE', 'case_2')]);
      ctx.repo.listConversationsByCaseIds.mockResolvedValue([SUMMARY_ROW, OTHER_ROW]);
      ctx.authz.allows.mockImplementation(async (_p: unknown, _a: unknown, r: { id: string }) => r.id === 'case_2');

      const res = await ctx.service.listAssignedConversations(PRINCIPAL);

      expect(res.items.map((i) => i.id)).toEqual(['conv_2']);
      expect(ctx.authz.allows).toHaveBeenCalledWith(PRINCIPAL, 'conversation.read.assigned', {
        type: 'conversation',
        id: 'case_1',
        orgId: 'org_1',
        ownerId: 'user_jovan',
        isConfidential: true,
      });
      expect(ctx.authz.require).not.toHaveBeenCalled();
    });

    it('listAssignedConversations returns an empty list without assignments', async () => {
      const res = await ctx.service.listAssignedConversations(PRINCIPAL);
      expect(ctx.repo.listConversationsByCaseIds).toHaveBeenCalledWith([]);
      expect(res).toEqual({ items: [] });
    });

    it('listOwnConversations reads by employee and filters with conversation.participate', async () => {
      const jovan = { userId: 'user_jovan' } as Principal;
      ctx.repo.listConversationsByEmployee.mockResolvedValue([SUMMARY_ROW]);

      const res = await ctx.service.listOwnConversations(jovan);

      expect(ctx.repo.listConversationsByEmployee).toHaveBeenCalledWith('user_jovan');
      expect(ctx.authz.allows).toHaveBeenCalledWith(jovan, 'conversation.participate', expect.objectContaining({ ownerId: 'user_jovan' }));
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).not.toHaveProperty('messages');
      expect(res.items[0]).not.toHaveProperty('body');
    });

    it('listOwnConversations returns nothing when the engine denies (for example a personal context)', async () => {
      ctx.repo.listConversationsByEmployee.mockResolvedValue([SUMMARY_ROW]);
      ctx.authz.allows.mockResolvedValue(false);
      await expect(ctx.service.listOwnConversations(PRINCIPAL)).resolves.toEqual({ items: [] });
    });
  });
});
