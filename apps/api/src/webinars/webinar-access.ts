/**
 * WebinarAccess: who the caller is to an occurrence (T-CW-2.1, D-CW-15,
 * D-CW-17, guidelines 7.3), decided with the authorization engine inside the
 * services, for the routes whose policy depends on the occurrence:
 *
 * - a **presenter**: a `webinar_hosts` PRESENTER row and `event.present` on
 *   the occurrence (the `expert` template through the CASE assignment the
 *   occurrence form adds);
 * - the **moderator**: the `webinar_hosts` MODERATOR row and `event.moderate`
 *   on the occurrence (CW-R-31a: start and end accept either);
 * - a **moderating** principal: `event.moderate` on the occurrence, with or
 *   without a host row (the moderation routes and the moderator's view of
 *   the chat, WBN-23);
 * - an **attendee**: `event.register` on their own registration of the
 *   occurrence (`own` scope), with the audience policy evaluated against the
 *   person's memberships at registration and again at join (D-CW-17).
 *
 * Every probe here is silent (no `access.denied` row); a route that ends in
 * a denial calls {@link deny}, which audits it and answers 404 (D-CW-30).
 */
import { Injectable } from '@nestjs/common';
import { ACTIONS, type Action, type Principal, type Resource } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { authorize } from '../authz/authorize.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ContextLoader } from '../authz/context-loader.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import {
  WEBINAR_RESOURCE_TYPE,
  contextOrgId,
  webinarRegistrantResourceOf,
  webinarStaffResourceOf,
} from './webinar.resolver.js';
import { eligibleOrgId } from './webinar-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarsRepository, type WebinarHostRecord, type WebinarRecord } from './webinars.repository.js';

/** The caller's place in a live occurrence. */
export type WebinarHostRole = 'presenter' | 'moderator';

export function apiError(status: number, code: string, message: string, details?: Record<string, unknown>): ApiHttpException {
  return new ApiHttpException({ status, code, message, details });
}

export function notFound(): ApiHttpException {
  return apiError(404, 'not_found', 'Resource not found');
}

export function invalidField(field: string, message: string): ApiHttpException {
  return apiError(400, 'validation', message, { field });
}

/** 409 `conflict` for a step the occurrence, message or poll does not allow in its current state. */
export function conflict(reason: string, message: string): ApiHttpException {
  return apiError(409, 'conflict', message, { reason });
}

export function webinarNotOpen(): ApiHttpException {
  return apiError(409, 'webinar_not_open', 'The webinar is not open for this');
}

export function joinWindowClosed(): ApiHttpException {
  return apiError(403, 'join_window_closed', 'The join window for this webinar is not open');
}

export function notEligible(): ApiHttpException {
  return apiError(403, 'not_eligible', 'You are not in the audience of this webinar');
}

/** 409 `not_editable`: an edit the occurrence's status no longer allows (T-CW-2.1). */
export function notEditable(message: string): ApiHttpException {
  return apiError(409, 'not_editable', message);
}

@Injectable()
export class WebinarAccess {
  constructor(
    private readonly repo: WebinarsRepository,
    private readonly dbs: DbService,
    private readonly contextLoader: ContextLoader,
    private readonly audit: AuditWriter,
  ) {}

  /** The occurrence, or 404. */
  async load(webinarId: string): Promise<WebinarRecord> {
    const webinar = await this.repo.findById(webinarId);
    if (!webinar) throw notFound();
    return webinar;
  }

  /** Whether the engine allows `action` on `resource`; no audit row. */
  async allows(principal: Principal, action: Action, resource: Resource): Promise<boolean> {
    const ctx = await this.contextLoader.build(principal, resource, { action });
    return authorize(principal, action, resource, ctx).allowed;
  }

  /**
   * The organisations whose occurrences the caller may act on with any of
   * `actions`: null for every organisation (a platform-scoped grant, which
   * also reaches the occurrences open to several organisations), otherwise
   * the CLIENT assignment targets the engine allows (`client_operations`).
   */
  async organisationsFor(principal: Principal, actions: readonly Action[]): Promise<string[] | null> {
    const platform: Resource = { type: WEBINAR_RESOURCE_TYPE };
    const ctx = await this.contextLoader.build(principal, platform);
    if (actions.some((action) => authorize(principal, action, platform, ctx).allowed)) return null;
    const allowed: string[] = [];
    const targets = new Set(ctx.assignments.filter((a) => a.kind === 'CLIENT').map((a) => a.targetId));
    for (const orgId of targets) {
      const resource: Resource = { type: WEBINAR_RESOURCE_TYPE, orgId };
      for (const action of actions) {
        if (await this.allows(principal, action, resource)) {
          allowed.push(orgId);
          break;
        }
      }
    }
    return allowed;
  }

  /** `event.moderate` on the occurrence. */
  canModerate(webinar: WebinarRecord, principal: Principal): Promise<boolean> {
    return this.allows(principal, ACTIONS['event.moderate'], webinarStaffResourceOf(webinar));
  }

  /** `event.register` on the caller's own registration of the occurrence. */
  canRegister(webinar: WebinarRecord, principal: Principal): Promise<boolean> {
    return this.allows(principal, ACTIONS['event.register'], webinarRegistrantResourceOf(webinar, principal));
  }

  /** The caller's host row, if the engine backs it: `event.present` for a presenter, `event.moderate` for the moderator. */
  async host(webinar: WebinarRecord, principal: Principal): Promise<WebinarHostRecord | null> {
    const host = await this.scoped(webinar.orgId, (tx) => this.repo.findHost(webinar.id, principal.userId, tx));
    if (!host) return null;
    const action = host.role === 'moderator' ? ACTIONS['event.moderate'] : ACTIONS['event.present'];
    return (await this.allows(principal, action, webinarStaffResourceOf(webinar))) ? host : null;
  }

  /**
   * The organisation through which the person is in the audience, or null
   * (D-CW-17). Their active organisation is preferred.
   */
  async eligibleOrg(webinar: WebinarRecord, principal: Principal, now: Date = new Date()): Promise<string | null> {
    const facts = await this.repo.membershipFacts(principal.userId, now);
    return eligibleOrgId(webinar.audiencePolicy, facts, contextOrgId(principal) ?? null);
  }

  /** Audits the denial as the guard does and answers 404 (D-CW-30). */
  async deny(principal: Principal, action: Action, webinar: Pick<WebinarRecord, 'id' | 'orgId'> | null): Promise<never> {
    await this.audit.record({
      action: 'access.denied',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: webinar?.orgId ?? null,
      recordType: 'webinar',
      recordId: webinar?.id ?? 'unknown',
      result: 'DENIED',
      details: { actionAttempted: action, resourceType: 'webinar', resourceId: webinar?.id, reason: 'no_matching_grant' },
    });
    throw notFound();
  }

  /** A read or write in the organisation's RLS scope; the system context for an occurrence of several organisations. */
  scoped<T>(orgId: string | null, fn: (tx: DbExecutor | undefined) => Promise<T>): Promise<T> {
    return orgId ? this.dbs.withOrgScope(orgId, fn) : fn(undefined);
  }

  /** A transaction in the organisation's RLS scope, or a plain one (system context). */
  transaction<T>(orgId: string | null, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return orgId ? this.dbs.withOrgScope(orgId, fn) : this.dbs.withTransaction(fn);
  }
}
