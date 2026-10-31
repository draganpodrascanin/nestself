import { describe, expect, it } from 'vitest';
import {
  TotpConfirmResponseSchema,
  TotpEnrolRequestSchema,
  DiscoverRequestSchema,
  PrincipalSchema,
  ActiveContextSchema,
  AUTH_ERROR_CODES,
  ApiErrorResponseSchema,
  StepUpRequiredErrorSchema,
  EmailOtpStartRequestSchema,
  EmailOtpStartResponseSchema,
  MeResponseSchema,
  PasswordResetConfirmRequestSchema,
  ProfileDisplayNameRequestSchema,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_OTP_MAX_LENGTH,
  EMAIL_OTP_MIN_LENGTH,
  InvitationAcceptRequestSchema,
  SSO_SIGN_IN_REASONS,
  SsoBindResendRequestSchema,
  SsoBindResendResponseSchema,
  SsoBindStartRequestSchema,
  SsoBindStartResponseSchema,
  SsoBindTokenRequestSchema,
  SsoBindVerifyRequestSchema,
  SsoBindVerifyResponseSchema,
  StepUpResendRequestSchema,
  StepUpStartResponseSchema,
} from './auth.ts';

describe('DiscoverRequestSchema', () => {
  it('lowercases and trims email', () => {
    const result = DiscoverRequestSchema.parse({ email: '  Alice@Example.COM  ' });
    expect(result.email).toBe('alice@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => DiscoverRequestSchema.parse({ email: 'not-an-email' })).toThrow();
  });
});

describe('PasswordResetConfirmRequestSchema', () => {
  it('normalizes email', () => {
    const result = PasswordResetConfirmRequestSchema.parse({
      email: ' User@Example.COM ',
      code: '123456',
      newPassword: 'longpassword',
    });
    expect(result.email).toBe('user@example.com');
  });

  it('rejects short password', () => {
    expect(() =>
      PasswordResetConfirmRequestSchema.parse({
        email: 'a@b.com',
        code: '123456',
        newPassword: 'short',
      }),
    ).toThrow();
  });
});

describe('PrincipalSchema', () => {
  const validPrincipal = {
    userId: 'u1',
    displayName: 'Test User',
    initials: 'TU',
    locale: 'en',
    memberships: [
      {
        membershipId: 'm1',
        orgId: 'o1',
        orgName: 'Org One',
        orgUnitId: 'ou1',
        status: 'ACTIVE',
        startDate: '2026-01-01T00:00:00Z',
        endDate: null,
      },
    ],
    staffTemplates: [],
    expert: null,
    context: { kind: 'personal' as const },
    auth: {
      method: 'email_otp' as const,
      time: '2026-10-21T10:00:00Z',
      secondFactor: false,
      lastStepUpAt: null,
    },
    sessionId: 's1',
    tokenFamily: null,
  };

  it('parses a valid principal', () => {
    const result = PrincipalSchema.parse(validPrincipal);
    expect(result.userId).toBe('u1');
    expect(result.context.kind).toBe('personal');
  });

  it('parses a principal with organization context', () => {
    const result = PrincipalSchema.parse({
      ...validPrincipal,
      context: { kind: 'organization', orgId: 'org-1' },
    });
    expect(result.context.kind).toBe('organization');
  });

  it('parses a principal with expert capability', () => {
    const result = PrincipalSchema.parse({
      ...validPrincipal,
      expert: { id: 'exp1', approvedCategories: ['psychological'] },
      context: { kind: 'expert' },
    });
    expect(result.expert?.id).toBe('exp1');
  });

  it('rejects missing userId', () => {
    expect(() =>
      PrincipalSchema.parse({ ...validPrincipal, userId: '' }),
    ).toThrow();
  });

  it('carries the organization name on a membership and requires it', () => {
    expect(PrincipalSchema.parse(validPrincipal).memberships[0]?.orgName).toBe('Org One');
    const { orgName: _omit, ...withoutName } = validPrincipal.memberships[0]!;
    expect(() =>
      PrincipalSchema.parse({ ...validPrincipal, memberships: [withoutName] }),
    ).toThrow();
    expect(() =>
      PrincipalSchema.parse({
        ...validPrincipal,
        memberships: [{ ...validPrincipal.memberships[0], orgName: '' }],
      }),
    ).toThrow();
  });
});

describe('ActiveContextSchema', () => {
  it('accepts personal context', () => {
    expect(ActiveContextSchema.parse({ kind: 'personal' })).toEqual({ kind: 'personal' });
  });

  it('accepts organization context with orgId', () => {
    const ctx = ActiveContextSchema.parse({ kind: 'organization', orgId: 'o1' });
    expect(ctx.kind).toBe('organization');
  });

  it('accepts expert context', () => {
    expect(ActiveContextSchema.parse({ kind: 'expert' })).toEqual({ kind: 'expert' });
  });

  it('accepts operations context', () => {
    expect(ActiveContextSchema.parse({ kind: 'operations' })).toEqual({ kind: 'operations' });
  });

  it('rejects organization context without orgId', () => {
    expect(() => ActiveContextSchema.parse({ kind: 'organization' })).toThrow();
  });

  it('rejects unknown context kind', () => {
    expect(() => ActiveContextSchema.parse({ kind: 'admin' })).toThrow();
  });
});

describe('AUTH_ERROR_CODES', () => {
  const required = [
    'unauthenticated',
    'invalid_code',
    'invalid_credentials',
    'invalid_challenge',
    'expired_code',
    'too_many_attempts',
    'step_up_required',
    'org_context_expired',
    'invalid_context',
    'totp_already_enrolled',
    'session_required',
    'forbidden',
    'not_found',
    'validation',
    'rate_limited',
    'csrf_rejected',
    'session_expired',
    'unavailable',
    'cannot_suspend_self',
    'cannot_end_self',
  ];

  it('contains all required error codes', () => {
    const codeSet = new Set<string>(AUTH_ERROR_CODES);
    for (const code of required) {
      expect(codeSet.has(code), `missing error code: ${code}`).toBe(true);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(AUTH_ERROR_CODES).size).toBe(AUTH_ERROR_CODES.length);
  });
});

describe('ApiErrorResponseSchema', () => {
  it('parses a valid error response', () => {
    const result = ApiErrorResponseSchema.parse({
      status: 403,
      code: 'forbidden',
      message: 'Access denied',
      requestId: 'req-123',
    });
    expect(result.code).toBe('forbidden');
  });

  it('accepts null requestId', () => {
    const result = ApiErrorResponseSchema.parse({
      status: 401,
      code: 'unauthenticated',
      message: 'Not authenticated',
      requestId: null,
    });
    expect(result.requestId).toBeNull();
  });
});

describe('StepUpRequiredErrorSchema', () => {
  it('parses a valid step-up required error', () => {
    const result = StepUpRequiredErrorSchema.parse({
      status: 403,
      code: 'step_up_required',
      message: 'Step-up required',
      requestId: null,
      details: {
        stepUpClass: 'financial',
        maxAge: 900,
        method: 'totp',
      },
    });
    expect(result.details.stepUpClass).toBe('financial');
    expect(result.details.maxAge).toBe(900);
  });
});

describe('EmailOtpStartRequestSchema', () => {
  it('accepts a request without a locale', () => {
    const result = EmailOtpStartRequestSchema.parse({ email: 'a@b.co' });
    expect(result).toEqual({ email: 'a@b.co' });
  });

  it.each(['en', 'sr-Latn', 'sr-Cyrl', 'hu'])('accepts the %s locale', (locale) => {
    expect(EmailOtpStartRequestSchema.parse({ email: 'a@b.co', locale }).locale).toBe(locale);
  });

  it('rejects a locale outside the four supported ones', () => {
    expect(() => EmailOtpStartRequestSchema.parse({ email: 'a@b.co', locale: 'de' })).toThrow();
    expect(() => EmailOtpStartRequestSchema.parse({ email: 'a@b.co', locale: 'sr' })).toThrow();
  });
});

describe('EmailOtpStartResponseSchema', () => {
  it('parses a valid response', () => {
    const result = EmailOtpStartResponseSchema.parse({
      challengeToken: 'tok123',
      codeDeliveryMedium: 'EMAIL',
    });
    expect(result.codeDeliveryMedium).toBe('EMAIL');
  });
});

describe('MeResponseSchema', () => {
  it('parses a response with principal and effectiveActions', () => {
    const result = MeResponseSchema.parse({
      principal: {
        userId: 'u1',
        displayName: 'Test',
        initials: 'T',
        locale: 'en',
        memberships: [],
        staffTemplates: [],
        expert: null,
        context: { kind: 'personal' },
        auth: {
          method: 'email_otp',
          time: '2026-01-01T00:00:00Z',
          secondFactor: false,
          lastStepUpAt: null,
        },
        sessionId: null,
        tokenFamily: null,
      },
      effectiveActions: ['preferences.manage', 'feedback.submit'],
    });
    expect(result.effectiveActions).toHaveLength(2);
  });
});

describe('TotpEnrolRequestSchema', () => {
  it('requires the sign-in challengeToken', () => {
    expect(TotpEnrolRequestSchema.parse({ challengeToken: 'tok' })).toEqual({ challengeToken: 'tok' });
    expect(TotpEnrolRequestSchema.safeParse({}).success).toBe(false);
    expect(TotpEnrolRequestSchema.safeParse({ challengeToken: '' }).success).toBe(false);
  });
});

describe('TotpConfirmResponseSchema', () => {
  it('accepts { enrolled: true } only', () => {
    expect(TotpConfirmResponseSchema.parse({ enrolled: true })).toEqual({ enrolled: true });
    expect(TotpConfirmResponseSchema.safeParse({ enrolled: false }).success).toBe(false);
  });
});

describe('ProfileDisplayNameRequestSchema', () => {
  it('accepts a trimmed name up to DISPLAY_NAME_MAX_LENGTH characters', () => {
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(120);
    const name = 'x'.repeat(DISPLAY_NAME_MAX_LENGTH);
    expect(ProfileDisplayNameRequestSchema.parse({ displayName: `  ${name}  ` }).displayName).toBe(name);
  });

  it('rejects an empty or too long name', () => {
    expect(() => ProfileDisplayNameRequestSchema.parse({ displayName: '   ' })).toThrow();
    expect(() =>
      ProfileDisplayNameRequestSchema.parse({ displayName: 'x'.repeat(DISPLAY_NAME_MAX_LENGTH + 1) }),
    ).toThrow();
  });
});

describe('phase 4 auth contracts', () => {
  /** 32 random bytes, base64url: the length the pending-bind handle has. */
  const HANDLE = 'A'.repeat(42) + '_';

  it('contains the phase 4 codes and reasons', () => {
    expect(AUTH_ERROR_CODES).toEqual(expect.arrayContaining(['step_up_unavailable', 'sso_denied']));
    expect(SSO_SIGN_IN_REASONS).toContain('sso_rate_limited');
  });

  it('bind schemas', () => {
    expect(SsoBindStartRequestSchema.safeParse({ handle: 'short' }).success).toBe(false);
    expect(
      StepUpStartResponseSchema.parse({ method: 'email_otp', challengeToken: 't', ssoStartUrl: null, emailMasked: 'd***@x.example' })
        .emailMasked,
    ).toBe('d***@x.example');
  });

  it('StepUpStartResponseSchema requires emailMasked, which may be null', () => {
    const base = { method: 'email_otp', challengeToken: 't', ssoStartUrl: null };
    expect(StepUpStartResponseSchema.parse({ ...base, emailMasked: null }).emailMasked).toBeNull();
    expect(StepUpStartResponseSchema.safeParse(base).success).toBe(false);
  });

  it('StepUpResendRequestSchema requires the challenge token', () => {
    expect(StepUpResendRequestSchema.parse({ challengeToken: 'tok' })).toEqual({ challengeToken: 'tok' });
    expect(StepUpResendRequestSchema.safeParse({ challengeToken: '' }).success).toBe(false);
    expect(StepUpResendRequestSchema.safeParse({}).success).toBe(false);
  });

  it('SsoBindStartRequestSchema takes a base64url handle of 32 to 128 characters and an optional locale', () => {
    expect(SsoBindStartRequestSchema.parse({ handle: HANDLE })).toEqual({ handle: HANDLE });
    expect(SsoBindStartRequestSchema.parse({ handle: HANDLE, locale: 'hu' }).locale).toBe('hu');
    for (const handle of ['x'.repeat(31), 'x'.repeat(129), `${'x'.repeat(40)}+/=`, `${'x'.repeat(40)} ab`]) {
      expect(SsoBindStartRequestSchema.safeParse({ handle }).success, handle).toBe(false);
    }
    expect(SsoBindStartRequestSchema.safeParse({ handle: 'x'.repeat(32) }).success).toBe(true);
    expect(SsoBindStartRequestSchema.safeParse({ handle: 'x'.repeat(128) }).success).toBe(true);
    expect(SsoBindStartRequestSchema.safeParse({ handle: HANDLE, locale: 'de' }).success).toBe(false);
  });

  it('SsoBindStartResponseSchema carries the challenge token and the masked address, never empty', () => {
    const body = { challengeToken: 'tok', emailMasked: 'i***@acme.example' };
    expect(SsoBindStartResponseSchema.parse(body)).toEqual(body);
    expect(SsoBindStartResponseSchema.safeParse({ ...body, emailMasked: '' }).success).toBe(false);
    expect(SsoBindStartResponseSchema.safeParse({ ...body, emailMasked: null }).success).toBe(false);
    expect(SsoBindStartResponseSchema.safeParse({ ...body, challengeToken: '' }).success).toBe(false);
  });

  it('SsoBindVerifyRequestSchema bounds the code by the email code lengths', () => {
    const code = (n: number) => '1'.repeat(n);
    for (const n of [EMAIL_OTP_MIN_LENGTH, EMAIL_OTP_MAX_LENGTH]) {
      expect(SsoBindVerifyRequestSchema.safeParse({ challengeToken: 'tok', code: code(n) }).success, String(n)).toBe(true);
    }
    for (const n of [EMAIL_OTP_MIN_LENGTH - 1, EMAIL_OTP_MAX_LENGTH + 1]) {
      expect(SsoBindVerifyRequestSchema.safeParse({ challengeToken: 'tok', code: code(n) }).success, String(n)).toBe(false);
    }
    expect(SsoBindVerifyRequestSchema.safeParse({ challengeToken: '', code: code(EMAIL_OTP_MAX_LENGTH) }).success).toBe(false);
  });

  it('SsoBindVerifyResponseSchema returns the path to continue on', () => {
    expect(SsoBindVerifyResponseSchema.parse({ returnPath: '/home' })).toEqual({ returnPath: '/home' });
    expect(SsoBindVerifyResponseSchema.safeParse({}).success).toBe(false);
  });

  it('SsoBindResendRequestSchema requires the challenge token and takes an optional locale', () => {
    expect(SsoBindResendRequestSchema.parse({ challengeToken: 'tok' })).toEqual({ challengeToken: 'tok' });
    expect(SsoBindResendRequestSchema.parse({ challengeToken: 'tok', locale: 'sr-Cyrl' }).locale).toBe('sr-Cyrl');
    expect(SsoBindResendRequestSchema.safeParse({ challengeToken: '' }).success).toBe(false);
    expect(SsoBindResendRequestSchema.safeParse({}).success).toBe(false);
    expect(SsoBindResendRequestSchema.safeParse({ challengeToken: 'tok', locale: 'de' }).success).toBe(false);
  });

  it('SsoBindResendResponseSchema carries the masked address, never empty', () => {
    expect(SsoBindResendResponseSchema.parse({ emailMasked: 'i***@acme.example' })).toEqual({
      emailMasked: 'i***@acme.example',
    });
    expect(SsoBindResendResponseSchema.safeParse({ emailMasked: '' }).success).toBe(false);
    expect(SsoBindResendResponseSchema.safeParse({}).success).toBe(false);
  });

  it('SsoBindTokenRequestSchema takes a non-empty ID token of at most 8192 characters', () => {
    expect(SsoBindTokenRequestSchema.parse({ idToken: 'eyJ.x.y' })).toEqual({ idToken: 'eyJ.x.y' });
    expect(SsoBindTokenRequestSchema.safeParse({ idToken: 'x'.repeat(8192) }).success).toBe(true);
    expect(SsoBindTokenRequestSchema.safeParse({ idToken: 'x'.repeat(8193) }).success).toBe(false);
    expect(SsoBindTokenRequestSchema.safeParse({ idToken: '' }).success).toBe(false);
  });

  it('InvitationAcceptRequestSchema accepts an optional locale of the four supported ones', () => {
    expect(InvitationAcceptRequestSchema.parse({ token: 'tok' })).toEqual({ token: 'tok' });
    expect(InvitationAcceptRequestSchema.parse({ token: 'tok', locale: 'sr-Latn' }).locale).toBe('sr-Latn');
    expect(InvitationAcceptRequestSchema.safeParse({ token: 'tok', locale: 'de' }).success).toBe(false);
  });
});
