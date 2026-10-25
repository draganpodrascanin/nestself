/**
 * Append-only audit writer. Inserts AuditEvent rows with retention, IP hashing
 * and detail sanitisation.
 *
 * SESS-R-22: record() must never throw to the caller on a write failure
 * (except when strictMode is true, used in tests).
 *
 * @see D-21, SESS-R-20, SESS-R-22
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  hashIp as _hashIp,
  parseUserAgent as _parseUserAgent,
} from '../common/request-fingerprint.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditRepository } from '../db/repositories/audit.repository.js';
import { categoryFor, type AuditAction, type AuditCategory } from './audit-events.js';

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
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
}

// ---------------------------------------------------------------------------
// Forbidden detail keys (D-21)
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set([
  'password',
  'code',
  'token',
  'tokens',
  'accessToken',
  'idToken',
  'refreshToken',
  'secret',
  'oidcClientSecret',
  'verificationToken',
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
  'ip',
]);

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

  /** Insert an audit event. Never throws in production (SESS-R-22). */
  async record(input: AuditEventInput): Promise<void> {
    try {
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

      await this.repo.insertEvent({
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
        sessionId: input.sessionId ?? null,
        ipHash,
        userAgentFamily,
        retainUntil,
      });
    } catch (err) {
      this.logger.error(err, `Failed to write audit event: ${input.action}`);
      if (this.strictMode) throw err;
    }
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
    if (FORBIDDEN_KEYS.has(key)) continue;
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
