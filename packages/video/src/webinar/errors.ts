/**
 * Coded failures of webinar actions and their translated copy (error
 * visibility rule): every `CALL_ERROR_CODES` entry and the generic API codes
 * map to `calls:errors.*`; anything else falls back to `errors.unknown`. The
 * API's own `message` is English and written for developers, so it is never
 * shown.
 */
import { CALL_ERROR_CODES, WEBINAR_REPLICATED_CAPACITY } from '@nestself/contracts';
import type { CallErrorCode } from '@nestself/contracts';
import type { WebinarAction, WebinarActionErrorLike } from './types';

/** A failed webinar action. `cause` keeps the transport's own error (the api-client's `ApiError`). */
export class WebinarActionError extends Error implements WebinarActionErrorLike {
  readonly code: string;
  readonly action: WebinarAction | 'floor.audio';
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(action: WebinarAction | 'floor.audio', code: string, options?: { cause?: unknown; details?: Readonly<Record<string, unknown>> }) {
    super(`Webinar action ${action} failed: ${code}`, options);
    this.name = 'WebinarActionError';
    this.action = action;
    this.code = code;
    if (options?.details) this.details = options.details;
  }
}

/** Normalises whatever the transport rejected with: the `code` of an `ApiError`, else `network` or `unknown`. */
export function toWebinarActionError(action: WebinarAction | 'floor.audio', error: unknown): WebinarActionError {
  if (error instanceof WebinarActionError) return error;
  const { code, details } = (error ?? {}) as { code?: unknown; details?: unknown };
  if (typeof code === 'string' && code.length > 0) {
    const known = details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined;
    return new WebinarActionError(action, code, { cause: error, ...(known ? { details: known } : {}) });
  }
  if (error instanceof TypeError) return new WebinarActionError(action, 'network', { cause: error });
  return new WebinarActionError(action, 'unknown', { cause: error });
}

type CallsT = (key: string, options?: Record<string, unknown>) => string;

/**
 * Every call error code has copy at `calls:errors.<camelCase code>` (the
 * i18n package's test enforces it for each `CALL_ERROR_CODES` entry), except
 * the capacity limit, whose copy names the limit.
 */
function callErrorKey(code: CallErrorCode): string {
  if (code === 'capacity_above_limit') return 'webinar.capacityAboveLimit';
  return `errors.${code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;
}

/** Codes whose webinar copy differs from the shared call copy, checked first. */
const WEBINAR_KEYS: Readonly<Record<string, string>> = {
  /** An occurrence edit its status no longer allows (hosts and operations only). */
  not_editable: 'webinar.errors.notEditable',
};

const GENERIC_KEYS: Readonly<Record<string, string>> = {
  network: 'errors.network',
  not_found: 'errors.notFound',
  forbidden: 'errors.forbidden',
  rate_limited: 'errors.rateLimited',
  validation: 'errors.validation',
  microphone_unavailable: 'webinar.errors.microphoneUnavailable',
};

function isCallErrorCode(code: string): code is CallErrorCode {
  return (CALL_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Translated copy for a webinar action failure, using `t` of the `calls`
 * namespace. Returns null when there is no error, `errors.unknown` for a code
 * without copy.
 */
export function webinarErrorMessage(error: WebinarActionErrorLike | string | null | undefined, t: CallsT): string | null {
  if (!error) return null;
  const code = typeof error === 'string' ? error : error.code;
  const webinarKey = WEBINAR_KEYS[code];
  if (webinarKey) return t(webinarKey);
  if (isCallErrorCode(code)) {
    // The capacity copy names the limit: the server's own `limit` detail, else the replicated ceiling (D-CW-36).
    const limit = typeof error === 'string' ? undefined : error.details?.['limit'];
    return t(callErrorKey(code), { limit: typeof limit === 'number' ? limit : WEBINAR_REPLICATED_CAPACITY });
  }
  const generic = GENERIC_KEYS[code];
  return t(generic ?? 'errors.unknown');
}
