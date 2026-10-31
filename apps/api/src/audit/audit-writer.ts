/**
 * Append-only audit writer. Inserts AuditEvent rows with retention, IP hashing
 * and detail sanitisation.
 *
 * Inside a transaction, `record(event, { tx })` inserts through the caller's
 * executor: the row commits with the change it describes, and an insert
 * failure propagates so that the change rolls back with it.
 *
 * SESS-R-22: without an executor, record() never throws to the caller on a
 * write failure (except when strictMode is true, used in tests).
 *
 * @see D-21, SESS-R-20, SESS-R-22
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  hashIp as _hashIp,
  parseUserAgent as _parseUserAgent,
} from '../common/request-fingerprint.js';
import type { DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditRepository, type NewAuditEvent } from '../db/repositories/audit.repository.js';
import { categoryFor, type AuditAction, type AuditCategory } from './audit-events.js';
import { hashSessionId } from '../session/session-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEventInput {
  action: AuditAction;
  actorUserId: string | null;
  actorKind: 'USER' | 'SYSTEM' | 'JOB';
  orgId?: string | null;
  recordType: string;
  recordId: string;
  result: 'ALLOWED' | 'DENIED' | 'NONE';
  details?: Record<string, unknown>;
  /** The raw session id of the actor's web session; stored as its hash (`hashSessionId`), never as the cookie value. */
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
}

// ---------------------------------------------------------------------------
// Forbidden detail keys (D-21)
// ---------------------------------------------------------------------------

/**
 * Keys are compared after lower-casing and dropping every character that is
 * not a letter or digit, so `joinToken`, `JoinToken`, `JOINTOKEN` and
 * `join_token` all match (CW-R-69). The match is on the whole key:
 * `codeVerifierHash` and `tokenFamily` are kept.
 */
const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const FORBIDDEN_KEY_NAMES = [
  'password',
  'code',
  'token',
  'tokens',
  'accessToken',
  'idToken',
  'refreshToken',
  // Chime SDK attendee credential and the credentials blob (CW-R-69, CW-R-33a, D-CW-08)
  'joinToken',
  'credentials',
  'secret',
  'oidcClientSecret',
  'verificationToken',
  // SSO code flow (API-R-06/07): the PKCE verifier and the OAuth state.
  'codeVerifier',
  'verifier',
  'state',
  'nonce',
  'testNonce',
  'browserNonce',
  // Email-code flows (step-up of a federated user, pending SSO binding): the
  // handle of a pending binding and the challenge token are bearer secrets
  // for as long as they live.
  'handle',
  'challengeToken',
  'cookie',
  'authorization',
  'body',
  'messageBody',
  'conversationBody',
  'intake',
  'intakeText',
  'notes',
  'professionalNotes',
  'professionalNote',
  'voucherCode',
  'emailAddress',
  // Crisis-readiness location an employee shares before a consultation (CALL-34, CW-R-80a)
  'locationText',
  'ip',
];

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(FORBIDDEN_KEY_NAMES.map(normaliseKey));

const MAX_STRING_LENGTH = 500;

// ---------------------------------------------------------------------------
// Retention defaults (years)
// ---------------------------------------------------------------------------

const CATEGORY_TO_DATA_CATEGORY: Record<AuditCategory, string> = {
  SECURITY: 'audit_security',
  AUTHORIZATION: 'audit_authorization',
  FINANCIAL: 'audit_financial',
  CONTENT_ACCESS: 'audit_content_access',
  ADMIN: 'audit_admin',
};

const DEFAULT_RETENTION_DAYS: Record<string, number> = {
  audit_security: 3 * 365,
  audit_authorization: 10 * 365,
  audit_financial: 10 * 365,
  audit_content_access: 1 * 365,
  audit_admin: 10 * 365,
};

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AuditWriter {
  private readonly logger = new Logger(AuditWriter.name);

  /** When true, record() re-throws on write failure (for test assertions). */
  strictMode = false;

  private retentionCache: Map<string, number> | null = null;
  private retentionCacheLoadedAt = 0;

  constructor(private readonly repo: AuditRepository) {}

  /**
   * Insert an audit event.
   *
   * With `opts.tx` (the executor of a `withOrgScope` or `withTransaction`
   * callback) the row is part of that transaction and any error propagates,
   * so the caller's change rolls back with its audit row: strict by
   * construction, whatever `strictMode` says. Without it the row is written
   * on the pool and a failure is logged, never thrown (SESS-R-22).
   */
  async record(input: AuditEventInput, opts: { tx?: DbExecutor } = {}): Promise<void> {
    if (opts.tx) {
      await this.repo.insertEvent(await this.buildRow(input), opts.tx);
      return;
    }
    try {
      await this.repo.insertEvent(await this.buildRow(input));
    } catch (err) {
      this.logger.error(err, `Failed to write audit event: ${input.action}`);
      if (this.strictMode) throw err;
    }
  }

  /** The stored row: category, retention horizon (read on the pool), IP hash, sanitised details. */
  private async buildRow(input: AuditEventInput): Promise<NewAuditEvent> {
    const now = input.occurredAt ?? new Date();
    const category = categoryFor(input.action);
    const dataCategory = CATEGORY_TO_DATA_CATEGORY[category];
    const retentionDays = await this.getRetentionDays(dataCategory);
    const retainUntil = new Date(now.getTime() + retentionDays * 86_400_000);

    const ipHash = input.ip ? hashIp(input.ip) : null;
    const userAgentFamily = parseUserAgentFamily(input.userAgent);
    const details = input.details
      ? sanitizeDetails(input.details)
      : {};

    return {
      occurredAt: now,
      actorUserId: input.actorUserId,
      actorKind: input.actorKind,
      orgId: input.orgId ?? null,
      action: input.action,
      recordType: input.recordType,
      recordId: input.recordId,
      result: input.result,
      category,
      details,
      sessionId: input.sessionId ? hashSessionId(input.sessionId) : null,
      ipHash,
      userAgentFamily,
      retainUntil,
    };
  }

  // -------------------------------------------------------------------------
  // Retention cache (lazy)
  // -------------------------------------------------------------------------

  private async getRetentionDays(dataCategory: string): Promise<number> {
    const now = Date.now();
    if (!this.retentionCache || now - this.retentionCacheLoadedAt > CACHE_TTL_MS) {
      await this.loadRetentionCache();
    }
    return this.retentionCache?.get(dataCategory)
      ?? DEFAULT_RETENTION_DAYS[dataCategory]
      ?? 10 * 365;
  }

  private async loadRetentionCache(): Promise<void> {
    try {
      const rows = await this.repo.findRetentionPolicies();
      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(row.dataCategory, row.minDays);
      }
      this.retentionCache = map;
      this.retentionCacheLoadedAt = Date.now();
    } catch {
      this.logger.warn('Failed to load retention policies; using defaults');
      this.retentionCache = new Map();
      this.retentionCacheLoadedAt = Date.now();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (re-exported for backward compatibility)
// ---------------------------------------------------------------------------

/** @see common/request-fingerprint.ts */
export const hashIp = _hashIp;

/** @see common/request-fingerprint.ts */
export const parseUserAgentFamily = _parseUserAgent;

/**
 * Recursively remove forbidden keys and truncate long strings.
 * The key `email` is kept only when the key name is `emailNormalised`.
 */
export function sanitizeDetails(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeObject(obj);
}

function sanitizeObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normaliseKey(key))) continue;
    if (key === 'email') continue; // drop bare 'email'; callers use 'emailNormalised'
    result[key] = sanitizeValue(val);
  }
  return result;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? value.slice(0, MAX_STRING_LENGTH)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}
