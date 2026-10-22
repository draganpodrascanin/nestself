/**
 * Structured API error with the 5.9 error envelope.
 *
 * @see API-R-33, API-R-34, API-R-36
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export interface ApiErrorBody {
  status: number;
  code: string;
  message: string;
  requestId: string | null;
  details?: Record<string, unknown>;
}

/**
 * An HTTP exception carrying the canonical error envelope.
 * The global exception filter serialises it into the 5.9 JSON shape.
 */
export class ApiHttpException extends HttpException {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(opts.message, opts.status);
    this.code = opts.code;
    this.details = opts.details;
  }
}

/**
 * Thrown when a session has been destroyed or timed out.
 * The HTTP layer maps it to 401 `session_expired`.
 */
export class SessionExpiredError extends ApiHttpException {
  constructor(message = 'Session expired') {
    super({ status: HttpStatus.UNAUTHORIZED, code: 'session_expired', message });
  }
}

/**
 * Thrown when the session refresh lock cannot be acquired and the current
 * token is too close to expiry. The HTTP layer maps it to 503 with Retry-After.
 *
 * @see SESS-R-14
 */
export class SessionRefreshBusyError extends ApiHttpException {
  constructor() {
    super({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'locked',
      message: 'Session refresh in progress',
      details: { retryAfter: 1 },
    });
  }
}
