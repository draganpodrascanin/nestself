/**
 * FeedbackRoutesService: the organization's recipient routes (spec FBK-03,
 * FBK-06). A route is enabled only with an active primary and an independent
 * alternate, both holding the feedback handler grant; the sensitive route
 * also needs operating hours, an escalation note and NestSelf's switch in the
 * client's listening configuration.
 */
import { Injectable } from '@nestjs/common';
import type { FeedbackRouteUpdate, FeedbackRoutesAdminResponse, FeedbackRoutesUpdateRequest, Principal } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityRepository } from '../db/repositories/identity.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningConfigurationService } from '../listening/listening-configuration.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackCasesRepository, type RouteRow } from './feedback-cases.repository.js';
import { toRouteAdmin, type DisplayNames } from './feedback-views.js';

export function conflict(code: string, message: string, details?: Record<string, unknown>): ApiHttpException {
  return new ApiHttpException({ status: 409, code, message, details });
}

export function validationError(message: string, field: string): ApiHttpException {
  return new ApiHttpException({ status: 400, code: 'validation', message, details: { field } });
}

const ROUTE_FIELDS = ['categories', 'primaryHandlerUserId', 'alternateHandlerUserId', 'enabled', 'operatingHours', 'responseTargetHours', 'escalationNote'] as const;

/** The names of the fields that differ between two rows (never their values). */
export function changedRouteFields(before: RouteRow | null, after: RouteRow): string[] {
  if (!before) return [...ROUTE_FIELDS];
  return ROUTE_FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
}

@Injectable()
export class FeedbackRoutesService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: FeedbackCasesRepository,
    private readonly authzRepo: AuthorizationRepository,
    private readonly memberships: MembershipsRepository,
    private readonly identity: IdentityRepository,
    private readonly configuration: ListeningConfigurationService,
    private readonly audit: AuditWriter,
  ) {}

  /** An active member of the organization holding a current grant with `feedback_case.handle` (spec FBK-03). */
  async handlerEligible(userId: string, orgId: string, now: Date, tx?: DbExecutor): Promise<boolean> {
    const membership = await this.memberships.findActiveByUserAndOrg(userId, orgId, tx);
    if (!membership) return false;
    const grants = await this.authzRepo.findGrantsForOrg(userId, orgId, tx);
    return grants.some(
      (g) =>
        g.actions.includes('feedback_case.handle') &&
        g.validFrom.getTime() <= now.getTime() &&
        (g.validUntil === null || g.validUntil.getTime() > now.getTime()),
    );
  }

  async displayNames(userIds: readonly string[]): Promise<DisplayNames> {
    const names = new Map<string, string>();
    for (const id of new Set(userIds)) {
      const user = await this.identity.findUserById(id);
      if (user) names.set(id, user.displayName);
    }
    return names;
  }

  async listForOrg(orgId: string): Promise<FeedbackRoutesAdminResponse> {
    const [rows, feedbackEnabled, config] = await Promise.all([
      this.dbs.withOrgScope(orgId, (tx) => this.repo.listRoutes(orgId, tx)),
      this.configuration.isEnabled(orgId, 'feedback'),
      this.configuration.find(orgId),
    ]);
    const names = await this.displayNames(rows.flatMap((r) => [r.primaryHandlerUserId, r.alternateHandlerUserId]));
    return { feedbackEnabled, sensitiveAllowed: config?.feedbackSensitiveEnabled ?? false, items: rows.map((r) => toRouteAdmin(r, names)) };
  }

  async update(orgId: string, body: FeedbackRoutesUpdateRequest, actor: Principal, now = new Date()): Promise<FeedbackRoutesAdminResponse> {
    const config = await this.configuration.find(orgId);
    for (const route of body.routes) await this.validateRoute(route, orgId, config?.feedbackSensitiveEnabled ?? false, now);
    await this.dbs.withOrgScope(orgId, async (tx) => {
      const existing = await this.repo.listRoutes(orgId, tx);
      for (const route of body.routes) {
        const before = existing.find((r) => r.kind === route.kind) ?? null;
        const saved = await this.repo.upsertRoute(
          {
            orgId,
            kind: route.kind,
            categories: route.categories,
            primaryHandlerUserId: route.primaryHandlerUserId,
            alternateHandlerUserId: route.alternateHandlerUserId,
            enabled: route.enabled,
            operatingHours: route.operatingHours ?? null,
            responseTargetHours: route.responseTargetHours,
            escalationNote: route.escalationNote ?? null,
            updatedByUserId: actor.userId,
          },
          tx,
        );
        await this.audit.record(
          {
            action: 'feedback_route.changed',
            actorUserId: actor.userId,
            actorKind: 'USER',
            orgId,
            recordType: 'feedback_route',
            recordId: saved.id,
            result: 'ALLOWED',
            details: { kind: route.kind, enabled: route.enabled, fields: changedRouteFields(before, saved) },
          },
          { tx },
        );
      }
    });
    return this.listForOrg(orgId);
  }

  /** Spec FBK-03 and FBK-06: distinct, eligible recipients before a route is enabled; a staffed process for the sensitive one. */
  async validateRoute(route: FeedbackRouteUpdate, orgId: string, sensitiveAllowed: boolean, now: Date): Promise<void> {
    if (route.primaryHandlerUserId === route.alternateHandlerUserId) {
      throw conflict('same_handler', 'The primary and the alternate recipient must be different people', { kind: route.kind });
    }
    if (!route.enabled) return;
    const handlers = [
      ['primary', route.primaryHandlerUserId],
      ['alternate', route.alternateHandlerUserId],
    ] as const;
    for (const [fn, userId] of handlers) {
      if (!(await this.handlerEligible(userId, orgId, now))) {
        throw conflict('handler_not_eligible', `The ${fn} recipient is not an active member holding the feedback handler grant`, { kind: route.kind, handler: fn });
      }
    }
    if (route.kind === 'sensitive') {
      if (!sensitiveAllowed) throw conflict('sensitive_not_enabled', 'NestSelf has not enabled the sensitive route for this organization');
      if (!route.operatingHours) throw validationError('The sensitive route needs operating hours', 'operatingHours');
      if (!route.escalationNote) throw validationError('The sensitive route needs an escalation route', 'escalationNote');
    }
  }
}
