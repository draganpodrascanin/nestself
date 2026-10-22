/**
 * Public invitation routes: preview and accept.
 *
 * Routes under `/invitations/*`. All `@Public()` and throttled at 10/min.
 *
 * @see T-1.5, API-R-08, API-R-09
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InvitationAcceptRequestSchema } from '@nestself/contracts';
import { Public } from '../authz/public.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { InvitationActivationService } from './invitation-activation.service.js';

interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
  authMeta?: { ip: string | null; userAgent: string | null };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

function validate<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'issues' in err
        ? JSON.stringify((err as { issues: unknown }).issues)
        : 'Validation failed';
    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message,
    });
  }
}

function extractMeta(req: HttpReq): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.authMeta?.ip ?? req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

function extractSurface(req: HttpReq): 'workspace' | 'admin' {
  const origin = req.headers['origin'] ?? '';
  if (typeof origin === 'string' && origin.includes('admin')) return 'admin';
  return 'workspace';
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('invitations')
export class InvitationActivationController {
  constructor(
    private readonly activation: InvitationActivationService,
  ) {}

  // -----------------------------------------------------------------------
  // GET /invitations/:token/preview
  // -----------------------------------------------------------------------

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':token/preview')
  async preview(@Param('token') token: string) {
    return this.activation.preview(token);
  }

  // -----------------------------------------------------------------------
  // POST /invitations/accept
  // -----------------------------------------------------------------------

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept')
  @HttpCode(200)
  async accept(@Req() req: HttpReq, @Body() body: unknown) {
    const { token } = validate(InvitationAcceptRequestSchema, body);
    const surface = extractSurface(req);
    return this.activation.accept(token, surface, extractMeta(req));
  }
}
