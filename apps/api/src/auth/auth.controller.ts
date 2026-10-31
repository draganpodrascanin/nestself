import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Principal } from '@nestself/contracts';
import type { SessionRecord } from '../session/session.types.js';

interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
  id?: string;
  principal?: Principal;
  session?: SessionRecord;
  authMeta?: { ip: string | null; userAgent: string | null };
  [key: string]: unknown;
}
interface HttpRes {
  setHeader(name: string, value: string | string[]): void;
  status(code: number): HttpRes;
  json(body: unknown): void;
  send(): void;
  redirect(status: number, url: string): void;
}
import { Public } from '../authz/public.decorator.js';
import { Authenticated } from '../authz/authenticated.decorator.js';
import { CurrentPrincipal } from './current-principal.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DiscoverService } from './discover.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SignInService } from './sign-in.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityResolutionService } from './identity-resolution.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { TotpService } from './totp.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PasswordResetService } from './password-reset.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SessionEndpointsService } from './session-endpoints.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SessionCookies } from '../session/session-cookie.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ProfileService } from './profile.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { StepUpService } from './step-up.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SsoCallbackService, type SsoRedirect } from './sso-callback.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SsoBindService } from './sso-bind.service.js';
import { ApiHttpException } from '../common/api-error.js';
import { RedirectOnThrottle } from '../common/redirect-on-throttle.decorator.js';
import {
  SESSION_THROTTLE,
  SSO_BIND_THROTTLE,
  SSO_CALLBACK_THROTTLE,
  SSO_START_THROTTLE,
} from '../authz/throttles.js';
import { PKCE_TTL } from '../redis/redis-keys.js';
import {
  DiscoverRequestSchema,
  EmailOtpStartRequestSchema,
  EmailOtpVerifyRequestSchema,
  PasswordRequestSchema,
  ChallengeRequestSchema,
  TotpEnrolRequestSchema,
  TotpConfirmRequestSchema,
  PasswordResetStartRequestSchema,
  PasswordResetConfirmRequestSchema,
  ContextSwitchRequestSchema,
  ProfileLocaleRequestSchema,
  ProfileDisplayNameRequestSchema,
  StepUpResendRequestSchema,
  StepUpVerifyRequestSchema,
  SsoStartQuerySchema,
  SsoCallbackQuerySchema,
  SsoBindStartRequestSchema,
  SsoBindVerifyRequestSchema,
  SsoBindResendRequestSchema,
} from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Helpers
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly discover: DiscoverService,
    private readonly signIn: SignInService,
    private readonly identityResolution: IdentityResolutionService,
    private readonly totp: TotpService,
    private readonly passwordReset: PasswordResetService,
    private readonly sessionEndpoints: SessionEndpointsService,
    private readonly cookies: SessionCookies,
    private readonly profile: ProfileService,
    private readonly stepUp: StepUpService,
    private readonly ssoCallback: SsoCallbackService,
    private readonly ssoBind: SsoBindService,
  ) {}

  // -----------------------------------------------------------------------
  // POST /api/auth/discover
  // -----------------------------------------------------------------------

  @Public()
  @Post('discover')
  @HttpCode(200)
  async discoverRoute(@Req() req: HttpReq, @Body() body: unknown) {
    const { email } = validate(DiscoverRequestSchema, body);
    return this.discover.discover(email, extractSurface(req));
  }

  // -----------------------------------------------------------------------
  // GET /api/auth/sso/start -- API-R-06
  // -----------------------------------------------------------------------

  /**
   * `?connection=<cognitoProviderName>&surface=workspace|admin[&returnPath=/x][&test=<nonce>]`
   * -> 302 to the identity provider. 400 `validation` for a malformed query,
   * including an absolute or protocol-relative `returnPath`. Throttled per IP
   * and connection; a refused start is a 302 to the workspace's
   * `/sign-in?reason=sso_rate_limited`.
   */
  @Public()
  @Get('sso/start')
  @Throttle(SSO_START_THROTTLE)
  @RedirectOnThrottle()
  async ssoStart(@Req() req: HttpReq, @Res() res: HttpRes, @Query() query: unknown): Promise<void> {
    const parsed = validate(SsoStartQuerySchema, query);
    const result = await this.ssoCallback.start(parsed, extractMeta(req));
    if (result.browserNonce) {
      res.setHeader('Set-Cookie', [this.cookies.serializeSsoNonce(result.browserNonce, PKCE_TTL)]);
    }
    this.sendRedirect(res, result);
  }

  // -----------------------------------------------------------------------
  // GET /api/auth/sso/callback -- API-R-07
  // -----------------------------------------------------------------------

  /**
   * Cognito's redirect target. Always a 302: to the surface with the session
   * cookies on success, else to the surface's `/sign-in?reason=...` (a
   * throttled callback: the workspace's `reason=sso_rate_limited`).
   */
  @Public()
  @Get('sso/callback')
  @Throttle(SSO_CALLBACK_THROTTLE)
  @RedirectOnThrottle()
  async ssoCallbackRoute(@Req() req: HttpReq, @Res() res: HttpRes, @Query() query: unknown): Promise<void> {
    const parsed = SsoCallbackQuerySchema.safeParse(query);
    const result = await this.ssoCallback.callback(
      parsed.success ? parsed.data : {},
      extractMeta(req),
      this.cookies.parseSsoNonce(req.headers),
    );
    // The browser-binding cookie is spent on every outcome.
    this.sendRedirect(res, result, [this.cookies.clearSsoNonce()]);
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/sso/bind/{start,verify,resend} -- pending binding (SSO-R-08)
  // -----------------------------------------------------------------------

  /**
   * `{ handle, locale? }` from `/sign-in?reason=sso_email_unverified&bind=`:
   * mails a code to the address the identity provider asserted and answers
   * `{ challengeToken, emailMasked }`. 400 `invalid_challenge` for an unknown
   * or expired handle. The three bind routes allow 10 a minute per IP.
   */
  @Public()
  @Post('sso/bind/start')
  @HttpCode(200)
  @Throttle(SSO_BIND_THROTTLE)
  async ssoBindStart(@Req() req: HttpReq, @Body() body: unknown) {
    return this.ssoBind.start(validate(SsoBindStartRequestSchema, body), extractMeta(req));
  }

  /**
   * `{ challengeToken, code }`: binds the identity, sets the session cookies
   * and answers `{ returnPath }`. 401 `invalid_code` / `invalid_challenge`,
   * 429 `too_many_attempts`, 403 `sso_denied` when nothing can be bound.
   */
  @Public()
  @Post('sso/bind/verify')
  @HttpCode(200)
  @Throttle(SSO_BIND_THROTTLE)
  async ssoBindVerify(
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
    @Body() body: unknown,
  ) {
    const result = await this.ssoBind.verify(validate(SsoBindVerifyRequestSchema, body), extractMeta(req));
    const { sessionId, csrfToken, absoluteExpiresAt } = result.session;
    this.setSessionCookies(res, sessionId, csrfToken, absoluteExpiresAt);
    return { returnPath: result.returnPath };
  }

  /**
   * `{ challengeToken, locale? }`: a new code for the same challenge, at most
   * one a minute counted from the previous mail (429 `rate_limited` with
   * `details.retryAfter`). Answers `{ emailMasked }`.
   */
  @Public()
  @Post('sso/bind/resend')
  @HttpCode(200)
  @Throttle(SSO_BIND_THROTTLE)
  async ssoBindResend(@Body() body: unknown) {
    const { challengeToken, locale } = validate(SsoBindResendRequestSchema, body);
    return this.ssoBind.resend(challengeToken, locale ?? 'sr-Latn');
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/email-otp/start
  // -----------------------------------------------------------------------

  @Public()
  @Post('email-otp/start')
  @HttpCode(200)
  async emailOtpStart(@Req() req: HttpReq, @Body() body: unknown) {
    const { email, locale } = validate(EmailOtpStartRequestSchema, body);
    return this.signIn.emailOtpStart(email, extractMeta(req), locale);
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/email-otp/verify
  // -----------------------------------------------------------------------

  @Public()
  @Post('email-otp/verify')
  @HttpCode(200)
  async emailOtpVerify(
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
    @Body() body: unknown,
  ) {
    const { challengeToken, code } = validate(EmailOtpVerifyRequestSchema, body);
    const surface = extractSurface(req);
    const result = await this.signIn.emailOtpVerify(
      challengeToken,
      code,
      surface,
      extractMeta(req),
    );
    this.setSessionCookies(res, result.sessionId, result.csrfToken, result.absoluteExpiresAt);
    return { principal: result.principal, effectiveActions: result.effectiveActions };
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/password
  // -----------------------------------------------------------------------

  @Public()
  @Post('password')
  @HttpCode(200)
  async password(
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
    @Body() body: unknown,
  ) {
    const { email, password } = validate(PasswordRequestSchema, body);
    const surface = extractSurface(req);
    const result = await this.signIn.passwordSignIn(
      email,
      password,
      surface,
      extractMeta(req),
    );

    if ('step' in result) {
      return result;
    }

    this.setSessionCookies(res, result.sessionId, result.csrfToken, result.absoluteExpiresAt);
    return { principal: result.principal, effectiveActions: result.effectiveActions };
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/challenge
  // -----------------------------------------------------------------------

  @Public()
  @Post('challenge')
  @HttpCode(200)
  async challenge(
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
    @Body() body: unknown,
  ) {
    const { challengeToken, response } = validate(ChallengeRequestSchema, body);
    const surface = extractSurface(req);
    const result = await this.signIn.respondChallenge(
      challengeToken,
      response,
      surface,
      extractMeta(req),
    );
    if ('step' in result) {
      return result;
    }
    this.setSessionCookies(res, result.sessionId, result.csrfToken, result.absoluteExpiresAt);
    return { principal: result.principal, effectiveActions: result.effectiveActions };
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/totp/enrol
  // -----------------------------------------------------------------------

  @Public()
  @Post('totp/enrol')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async totpEnrol(@Body() body: unknown) {
    const { challengeToken } = validate(TotpEnrolRequestSchema, body);
    return this.totp.totpEnrol(challengeToken);
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/me/totp/enrol — authenticator enrolment for a signed-in user
  // -----------------------------------------------------------------------

  /**
   * Starts enrolment with the session's identity-provider access token and
   * returns `{ secretUri, challengeToken: null }`; the caller confirms with
   * POST /auth/totp/confirm. 409 `totp_already_enrolled` when the user
   * already has an authenticator. The secret is never cached.
   */
  @Authenticated()
  @Post('me/totp/enrol')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async totpEnrolSignedIn(@CurrentPrincipal() principal: Principal, @Req() req: HttpReq) {
    return this.totp.totpEnrolSignedIn(principal, req.session?.cognito?.accessToken);
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/totp/confirm
  // -----------------------------------------------------------------------

  @Authenticated()
  @Post('totp/confirm')
  @HttpCode(200)
  async totpConfirm(
    @Req() req: HttpReq,
    @Body() body: unknown,
  ) {
    const { code } = validate(TotpConfirmRequestSchema, body);
    const accessToken = req.session?.cognito?.accessToken;
    await this.totp.totpConfirm(code, accessToken);
    return { enrolled: true };
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/password-reset/start
  // -----------------------------------------------------------------------

  @Public()
  @Post('password-reset/start')
  @HttpCode(200)
  async passwordResetStart(@Body() body: unknown) {
    const { email } = validate(PasswordResetStartRequestSchema, body);
    return this.passwordReset.passwordResetStart(email);
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/password-reset/confirm
  // -----------------------------------------------------------------------

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  async passwordResetConfirm(@Body() body: unknown) {
    const { email, code, newPassword } = validate(
      PasswordResetConfirmRequestSchema,
      body,
    );
    return this.passwordReset.passwordResetConfirm(email, code, newPassword);
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/context
  // -----------------------------------------------------------------------

  @Authenticated()
  @Post('context')
  @HttpCode(200)
  async switchContext(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
    @Body() body: unknown,
  ) {
    const { context } = validate(ContextSwitchRequestSchema, body);
    const session = req.session;
    if (!session) {
      throw new ApiHttpException({
        status: 401,
        code: 'session_required',
        message: 'Context switch requires an active session',
      });
    }
    return this.sessionEndpoints.switchContext(session.sessionId, principal, context);
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/step-up/start
  // -----------------------------------------------------------------------

  /**
   * Mails a code: Cognito's for a native user, a NestSelf one to the
   * federated identity's address otherwise; 403 `step_up_unavailable` when
   * there is neither. The three step-up routes allow 10 a minute per session
   * (bearer: per token family), and wrong codes lock the user (StepUpThrottle).
   */
  @Authenticated()
  @Post('step-up/start')
  @HttpCode(200)
  @Throttle(SESSION_THROTTLE)
  async stepUpStart(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
  ) {
    return this.stepUp.start(principal, extractMeta(req), req.session?.surface ?? extractSurface(req));
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/step-up/resend
  // -----------------------------------------------------------------------

  /**
   * A new code for the challenge of an earlier start, at most one a minute
   * counted from the previous mail (429 `rate_limited` with
   * `details.retryAfter`). Answers like start; the Cognito kind answers with a
   * new challenge token.
   */
  @Authenticated()
  @Post('step-up/resend')
  @HttpCode(200)
  @Throttle(SESSION_THROTTLE)
  async stepUpResend(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
    @Body() body: unknown,
  ) {
    const { challengeToken } = validate(StepUpResendRequestSchema, body);
    return this.stepUp.resend(principal, challengeToken, extractMeta(req));
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/step-up/verify
  // -----------------------------------------------------------------------

  @Authenticated()
  @Post('step-up/verify')
  @HttpCode(204)
  @Throttle(SESSION_THROTTLE)
  async stepUpVerify(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
    @Body() body: unknown,
  ): Promise<void> {
    const { challengeToken, response } = validate(StepUpVerifyRequestSchema, body);
    const result = await this.stepUp.verify(principal, challengeToken, response, extractMeta(req));
    if (result.session) {
      const { sessionId, csrfToken, absoluteExpiresAt } = result.session;
      this.setSessionCookies(res, sessionId, csrfToken, absoluteExpiresAt);
    }
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/sign-out
  // -----------------------------------------------------------------------

  @Authenticated()
  @Post('sign-out')
  @HttpCode(200)
  async signOut(
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const session = req.session;
    if (session) {
      await this.sessionEndpoints.signOut(session.sessionId);
    }
    this.clearSessionCookies(res);
    return { signedOut: true };
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/sign-out-all
  // -----------------------------------------------------------------------

  @Authenticated()
  @Post('sign-out-all')
  @HttpCode(200)
  async signOutAll(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
  ) {
    const session = req.session;
    if (!session) {
      throw new ApiHttpException({
        status: 401,
        code: 'session_required',
        message: 'Sign-out-all requires an active session',
      });
    }
    await this.sessionEndpoints.signOutAll(principal.userId, session.sessionId);
    return { signedOutOthers: true };
  }

  // -----------------------------------------------------------------------
  // POST /api/auth/ws-ticket
  // -----------------------------------------------------------------------

  @Authenticated()
  @Post('ws-ticket')
  @HttpCode(200)
  async wsTicket(@CurrentPrincipal() principal: Principal) {
    const ticket = await this.sessionEndpoints.createWsTicket(principal.userId, principal.auth);
    return { ticket };
  }

  // -----------------------------------------------------------------------
  // GET /api/auth/me
  // -----------------------------------------------------------------------

  @Authenticated()
  @Get('me')
  async me(@CurrentPrincipal() principal: Principal) {
    return this.sessionEndpoints.getMe(principal);
  }

  // -----------------------------------------------------------------------
  // PATCH /api/auth/me/locale
  // -----------------------------------------------------------------------

  @Authenticated()
  @Patch('me/locale')
  @HttpCode(200)
  async updateLocale(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
    @Body() body: unknown,
  ) {
    const { locale } = validate(ProfileLocaleRequestSchema, body);
    return this.profile.updateLocale(principal, locale, extractMeta(req));
  }

  // -----------------------------------------------------------------------
  // PATCH /api/auth/me/display-name
  // -----------------------------------------------------------------------

  @Authenticated()
  @Patch('me/display-name')
  @HttpCode(200)
  async updateDisplayName(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
    @Body() body: unknown,
  ) {
    const { displayName } = validate(ProfileDisplayNameRequestSchema, body);
    return this.profile.updateDisplayName(principal, displayName, extractMeta(req));
  }

  // -----------------------------------------------------------------------
  // GET /api/auth/sessions
  // -----------------------------------------------------------------------

  @Authenticated()
  @Get('sessions')
  async sessions(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
  ) {
    const session = req.session;
    return this.sessionEndpoints.getSessions(
      principal.userId,
      session?.sessionId ?? null,
    );
  }

  // -----------------------------------------------------------------------
  // DELETE /api/auth/sessions/:sessionId
  // -----------------------------------------------------------------------

  @Authenticated()
  @Delete('sessions/:sessionId')
  @HttpCode(200)
  async deleteSession(
    @CurrentPrincipal() principal: Principal,
    @Req() req: HttpReq,
    @Param('sessionId') sessionIdHash: string,
  ) {
    const session = req.session;
    if (!session) {
      throw new ApiHttpException({
        status: 401,
        code: 'session_required',
        message: 'Requires an active session',
      });
    }
    await this.sessionEndpoints.destroySession(
      principal.userId,
      sessionIdHash,
      session.sessionId,
    );
    return { destroyed: true };
  }

  // -----------------------------------------------------------------------
  // Cookie helpers
  // -----------------------------------------------------------------------

  private sendRedirect(res: HttpRes, result: SsoRedirect, extraCookies: string[] = []): void {
    const cookies = [...extraCookies];
    if (result.session) {
      const { sessionId, csrfToken, absoluteExpiresAt } = result.session;
      cookies.push(
        this.cookies.serializeSession(sessionId, absoluteExpiresAt),
        this.cookies.serializeCsrf(csrfToken, absoluteExpiresAt),
      );
    }
    if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, result.location);
  }

  private setSessionCookies(
    res: HttpRes,
    sessionId: string,
    csrfToken: string,
    absoluteExpiresAt: Date,
  ): void {
    res.setHeader('Set-Cookie', [
      this.cookies.serializeSession(sessionId, absoluteExpiresAt),
      this.cookies.serializeCsrf(csrfToken, absoluteExpiresAt),
    ]);
  }

  private clearSessionCookies(res: HttpRes): void {
    res.setHeader('Set-Cookie', this.cookies.clear());
  }
}
