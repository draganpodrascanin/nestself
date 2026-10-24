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
