/**
 * IdempotencyInterceptor -- replays the stored response for a repeated
 * `Idempotency-Key`, rejects reuse with a different payload and rejects a
 * concurrent duplicate.
 *
 * Redis key `idempotency:{scope}:{userId}:{key}`; value is JSON. Only the
 * request fingerprint (SHA-256) and the response are kept, never the request
 * body. Stored responses may be personal data: they live in Redis only for the
 * 24 h TTL and are never written to the database or logs (retention rules).
 * A handler error releases the reservation and is not stored, so the client
 * can retry.
 *
 * @see ARC-R-10, RTE-R-05, CLI-R-10, T-C1.07
 */
import { createHash } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, catchError, from, mergeMap, take, throwError } from 'rxjs';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../api-error.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../../redis/key-value-store.js';
import {
  IDEMPOTENCY_IN_FLIGHT_TTL,
  IDEMPOTENCY_TTL,
  idempotencyKey,
} from '../../redis/redis-keys.js';
import { IDEMPOTENT_KEY, type IdempotentMetadata } from './idempotent.metadata.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotent-Replayed';

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;
/** Nest's metadata key for `@HttpCode()`. */
const HTTP_CODE_METADATA = '__httpCode__';

interface HttpReq {
  method: string;
  path?: string;
  url?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}
interface HttpRes {
  setHeader(k: string, v: string): void;
}

type Record_ =
  | { state: 'processing'; fingerprint: string }
  | { state: 'complete'; fingerprint: string; status: number; body: unknown };

/** JSON with object keys sorted recursively, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body ?? null)}`)
    .digest('hex');
}

function conflict(reason: 'in_progress' | 'payload_mismatch'): ApiHttpException {
  return new ApiHttpException({
    status: HttpStatus.CONFLICT,
    code: 'idempotency_conflict',
    message:
      reason === 'in_progress'
        ? 'A request with this Idempotency-Key is still being processed'
        : 'This Idempotency-Key was already used with a different request',
    details: { reason },
  });
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const meta = this.reflector.get<IdempotentMetadata | undefined>(
      IDEMPOTENT_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<HttpReq>();
    const res = http.getResponse<HttpRes>();

    const header = req.headers[IDEMPOTENCY_KEY_HEADER];
    if (header === undefined) {
      if (meta.required) throw invalidKey('Idempotency-Key header is required');
      return next.handle();
    }
    if (typeof header !== 'string' || !KEY_PATTERN.test(header)) {
      throw invalidKey('Idempotency-Key must be 1 to 255 visible ASCII characters');
    }

    const userId = req.principal?.userId;
    if (!userId) {
      throw new ApiHttpException({
        status: HttpStatus.UNAUTHORIZED,
        code: 'unauthenticated',
        message: 'Authentication required',
      });
    }

    const path = (req.path ?? req.url ?? '').split('?')[0]!;
    const fingerprint = requestFingerprint(req.method, path, req.body);
    const key = idempotencyKey(meta.scope, userId, header);

    const reserved = await this.store.set(
      key,
      JSON.stringify({ state: 'processing', fingerprint } satisfies Record_),
      { onlyIfAbsent: true, ttlSeconds: IDEMPOTENCY_IN_FLIGHT_TTL },
    );

    if (!reserved) {
      const raw = await this.store.get(key);
      if (raw === null) {
        // Expired or released between the SET NX and the GET: ask to retry.
        throw conflict('in_progress');
      }
      const existing = JSON.parse(raw) as Record_;
      if (existing.fingerprint !== fingerprint) throw conflict('payload_mismatch');
      if (existing.state === 'processing') throw conflict('in_progress');
      res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      return from([existing.body]);
    }

    const status = this.successStatus(context, req.method);
    return next.handle().pipe(
      take(1),
      mergeMap(async (body) => {
        const stored: Record_ = {
          state: 'complete',
          fingerprint,
          status,
          body: body === undefined ? null : body,
        };
        await this.store.set(key, JSON.stringify(stored), { ttlSeconds: IDEMPOTENCY_TTL });
        return body;
      }),
      catchError((err: unknown) =>
        from(this.store.del(key)).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }

  private successStatus(context: ExecutionContext, method: string): number {
    const explicit = Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as
      | number
      | undefined;
    if (explicit) return explicit;
    return method.toUpperCase() === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
  }
}

function invalidKey(message: string): ApiHttpException {
  return new ApiHttpException({
    status: HttpStatus.BAD_REQUEST,
    code: 'validation',
    message,
    details: { header: 'Idempotency-Key' },
  });
}
