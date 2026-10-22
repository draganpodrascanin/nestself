/**
 * Global exception filter producing the 5.9 error envelope.
 *
 * @see API-R-33, API-R-36, 5.9 Error semantics
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodError } from 'zod';
import { ApiHttpException, type ApiErrorBody } from './api-error.js';

/** Minimal Express-compatible request shape (avoids depending on @types/express). */
interface HttpReq { id?: string; headers: Record<string, string | undefined> }
/** Minimal Express-compatible response shape. */
interface HttpRes {
  headersSent: boolean;
  setHeader(k: string, v: string): void;
  status(code: number): HttpRes;
  json(body: unknown): void;
}

const STATUS_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation',
  [HttpStatus.UNAUTHORIZED]: 'unauthenticated',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<HttpReq>();
    const res = ctx.getResponse<HttpRes>();
    const requestId = req.id ?? null;

    const body = this.buildBody(exception, requestId);

    if (body.status >= 500) {
      this.logger.error(exception, `Unhandled ${body.code}`);
    }

    if (res.headersSent) return;

    if (requestId) {
      res.setHeader('x-request-id', requestId);
    }

    // Retry-After for 429 and 503
    if (body.details?.retryAfter != null) {
      res.setHeader('Retry-After', String(body.details.retryAfter));
    }

    res.status(body.status).json(body);
  }

  private buildBody(
    exception: unknown,
    requestId: string | null,
  ): ApiErrorBody {
    // ApiHttpException: our own structured error
    if (exception instanceof ApiHttpException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        requestId,
        details: exception.details,
      };
    }

    // ZodError: 400 validation
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'validation',
        message: 'Validation failed',
        requestId,
        details: {
          issues: exception.issues.map(({ path, message, code }) => ({
            path,
            message,
            code,
          })),
        },
      };
    }

    // ThrottlerException: 429 rate_limited
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: 'rate_limited',
        message: 'Too many requests',
        requestId,
        details: { retryAfter: 60 },
      };
    }

    // Generic HttpException (NestJS built-in)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_CODE_MAP[status] ?? 'internal';
      return {
        status,
        code,
        message: status >= 500 ? 'Internal server error' : exception.message,
        requestId,
      };
    }

    // Unknown: 500 internal
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal',
      message: 'Internal server error',
      requestId,
    };
  }
}
