/**
 * Job authorization wrapper for BullMQ processors (T-1.17).
 *
 * Every job payload carries `principalId` and `context` (never tokens or
 * grants, AUTHZ-R-54). At execution time the wrapper re-loads the principal,
 * rebuilds the authorization context and calls `authorize()` with the job's
 * action and resource (AUTHZ-R-53). A denied, suspended, deactivated or
 * unknown principal completes the job as `skipped`, not `failed`, so BullMQ
 * does not retry it. Every outcome is audited with `actorKind: 'JOB'`.
 *
 * @see 4.6.4, D-19, DR-01
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { Action, ActiveContext, Principal, Resource } from '@nestself/contracts';
import { isAction } from '@nestself/contracts';

import { PrincipalLoader, type LoadedPrincipal } from '../principal/principal-loader.js';

import { ContextLoader } from '../authz/context-loader.js';

import { AuditWriter } from '../audit/audit-writer.js';
import { authorize } from '../authz/authorize.js';
import { isContextValid } from '../authz/context.js';

/** The envelope every authorized job payload must carry. */
export interface AuthorizedJobPayload<TData = unknown> {
  /** User id of the actor who enqueued the job. */
  principalId: string;
  /** Active context at enqueue time. */
  context: ActiveContext;
  /** Action the job performs on behalf of the principal. */
  action: Action;
  /** Resource the action targets. */
  resource: Resource;
  /** Job-specific data; must never contain tokens, cookies or grant objects. */
  data: TData;
}

export type JobOutcome<TResult> =
  | { status: 'completed'; result: TResult }
  | { status: 'skipped'; reason: JobSkipReason; detail?: string };

export type JobSkipReason =
  | 'invalid_payload'
  | 'principal_not_found'
  | 'principal_inactive'
  | 'context_invalid'
  | 'denied';

/** Minimal BullMQ `Job` shape the wrapper needs; avoids a hard dependency on bullmq types here. */
export interface JobLike<TData> {
  id?: string;
  name: string;
  data: TData;
}

export type AuthorizedJobHandler<TData, TResult> = (
  principal: Principal,
  data: TData,
  job: JobLike<AuthorizedJobPayload<TData>>,
) => Promise<TResult>;

const FORBIDDEN_PAYLOAD_KEYS = ['accessToken', 'idToken', 'refreshToken', 'cookie', 'grants', 'token'];

/** Pure payload validation (AUTHZ-R-54). Exported for tests. */
export function validateJobPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return 'payload must be an object';
  const p = payload as Record<string, unknown>;
  if (typeof p['principalId'] !== 'string' || p['principalId'].length === 0) {
    return 'principalId is required';
  }
  const ctx = p['context'] as { kind?: unknown } | undefined;
  if (!ctx || typeof ctx.kind !== 'string') return 'context is required';
  if (typeof p['action'] !== 'string' || !isAction(p['action'])) return 'action is not in the catalogue';
  const resource = p['resource'] as { type?: unknown } | undefined;
  if (!resource || typeof resource.type !== 'string') return 'resource.type is required';
  const data = p['data'];
  if (data && typeof data === 'object') {
    for (const key of Object.keys(data as Record<string, unknown>)) {
      if (FORBIDDEN_PAYLOAD_KEYS.includes(key)) return `data must not contain '${key}'`;
    }
  }
  return null;
}

@Injectable()
export class JobAuthorization {
  private readonly logger = new Logger(JobAuthorization.name);

  constructor(
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => ContextLoader)) private readonly contextLoader: ContextLoader,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
  ) {}

  /**
   * Wrap a handler into a BullMQ-compatible processor. The returned function
   * resolves to a `JobOutcome`; it rejects only when the handler itself throws.
   */
  wrap<TData, TResult>(
    handler: AuthorizedJobHandler<TData, TResult>,
  ): (job: JobLike<AuthorizedJobPayload<TData>>) => Promise<JobOutcome<TResult>> {
    return (job) => this.run(job, handler);
  }

  /** Authorize and run one job. */
  async run<TData, TResult>(
    job: JobLike<AuthorizedJobPayload<TData>>,
    handler: AuthorizedJobHandler<TData, TResult>,
  ): Promise<JobOutcome<TResult>> {
    const payload = job.data;
    const invalid = validateJobPayload(payload);
    if (invalid) {
      this.logger.warn(`Job ${job.name}#${job.id ?? '?'} skipped: ${invalid}`);
      return { status: 'skipped', reason: 'invalid_payload', detail: invalid };
    }

    const loaded = await this.principalLoader.load(payload.principalId);
    if (!loaded) {
      await this.auditSkip(job, payload, 'principal_not_found');
      return { status: 'skipped', reason: 'principal_not_found' };
    }
    if (loaded.isSuspended || loaded.isDeactivated) {
      await this.auditSkip(job, payload, 'principal_inactive', loaded.userId);
      return { status: 'skipped', reason: 'principal_inactive' };
    }

    const principal = this.assemblePrincipal(loaded, payload.context);
    const ctx = await this.contextLoader.build(principal, payload.resource, {
      action: payload.action,
      loadedPrincipal: loaded,
    });

    const contextResult = isContextValid(principal, ctx);
    if (!contextResult.valid) {
      await this.auditSkip(job, payload, 'context_invalid', loaded.userId);
      return { status: 'skipped', reason: 'context_invalid' };
    }

    const decision = authorize(principal, payload.action, payload.resource, ctx);
    if (!decision.allowed) {
      await this.auditSkip(job, payload, 'denied', loaded.userId, decision.denialReason);
      return { status: 'skipped', reason: 'denied', detail: decision.denialReason ?? undefined };
    }

    const result = await handler(principal, payload.data, job);
    await this.audit.record({
      action: 'export.generated',
      actorUserId: loaded.userId,
      actorKind: 'JOB',
      orgId: payload.resource.orgId ?? null,
      recordType: payload.resource.type,
      recordId: payload.resource.id ?? job.name,
      result: 'ALLOWED',
      details: { job: job.name, jobId: job.id ?? null, action: payload.action },
    });
    return { status: 'completed', result };
  }

  /** Principal for a background job: context from the payload, no interactive auth. */
  private assemblePrincipal(loaded: LoadedPrincipal, context: ActiveContext): Principal {
    return {
      userId: loaded.userId,
      displayName: loaded.displayName,
      initials: loaded.initials,
      locale: loaded.locale,
      memberships: loaded.memberships,
      staffTemplates: loaded.staffTemplates,
      expert: loaded.expert,
      context,
      // Jobs never satisfy a step-up requirement: the auth snapshot is
      // deliberately old and without a second factor.
      auth: {
        method: 'sso',
        time: new Date(0).toISOString(),
        secondFactor: false,
        lastStepUpAt: null,
      },
      sessionId: null,
      tokenFamily: null,
    };
  }

  private async auditSkip(
    job: JobLike<AuthorizedJobPayload<unknown>>,
    payload: AuthorizedJobPayload<unknown>,
    reason: JobSkipReason,
    actorUserId: string | null = null,
    detail: string | null = null,
  ): Promise<void> {
    this.logger.warn(`Job ${job.name}#${job.id ?? '?'} skipped: ${reason}${detail ? ` (${detail})` : ''}`);
    await this.audit.record({
      action: 'access.denied',
      actorUserId,
      actorKind: 'JOB',
      orgId: payload.resource.orgId ?? null,
      recordType: payload.resource.type,
      recordId: payload.resource.id ?? job.name,
      result: 'DENIED',
      details: { job: job.name, jobId: job.id ?? null, actionAttempted: payload.action, reason, detail },
    });
  }
}
