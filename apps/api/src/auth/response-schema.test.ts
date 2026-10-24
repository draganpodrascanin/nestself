import { describe, it, expect } from 'vitest';
import {
  DiscoverResponseSchema,
  MeResponseSchema,
  SessionListResponseSchema,
  WsTicketResponseSchema,
  TotpEnrolResponseSchema,
  PrincipalSchema,
} from '@nestself/contracts';

describe('Auth response schemas', () => {
  // ── DiscoverResponseSchema ──────────────────────────────────────────────

  describe('DiscoverResponseSchema', () => {
    it('accepts valid email_otp response', () => {
      const data = { method: 'email_otp', ssoStartUrl: null, connection: null };
      expect(DiscoverResponseSchema.parse(data)).toEqual(data);
    });

    it('accepts valid sso response', () => {
      const data = {
        method: 'sso',
        ssoStartUrl: 'https://idp.example.com/login',
        connection: 'okta-1',
      };
      expect(DiscoverResponseSchema.parse(data)).toEqual(data);
    });

    it('rejects invalid method', () => {
      expect(() =>
        DiscoverResponseSchema.parse({ method: 'magic_link', ssoStartUrl: null, connection: null }),
      ).toThrow();
    });
  });

  // ── PrincipalSchema ─────────────────────────────────────────────────────

  describe('PrincipalSchema', () => {
    const VALID_PRINCIPAL = {
      userId: 'u-1',
      displayName: 'Test User',
      initials: 'TU',
      locale: 'sr-Latn',
      memberships: [],
      staffTemplates: [],
      expert: null,
      context: { kind: 'personal' },
      auth: { method: 'email_otp', time: new Date().toISOString(), secondFactor: false, lastStepUpAt: null },
      sessionId: 'sess-1',
      tokenFamily: null,
    };

    it('accepts a valid principal', () => {
      expect(() => PrincipalSchema.parse(VALID_PRINCIPAL)).not.toThrow();
    });

    it('rejects empty userId', () => {
      expect(() => PrincipalSchema.parse({ ...VALID_PRINCIPAL, userId: '' })).toThrow();
    });

    it('rejects initials longer than 3', () => {
      expect(() =>
        PrincipalSchema.parse({ ...VALID_PRINCIPAL, initials: 'ABCD' }),
      ).toThrow();
    });

    it('accepts principal with expert data', () => {
      const withExpert = {
        ...VALID_PRINCIPAL,
        expert: { id: 'exp-1', approvedCategories: ['eap', 'coaching'] },
      };
      expect(() => PrincipalSchema.parse(withExpert)).not.toThrow();
    });

    it('accepts principal with memberships', () => {
      const withMembership = {
        ...VALID_PRINCIPAL,
        memberships: [
          {
            membershipId: 'm-1',
            orgId: 'org-1',
            orgUnitId: null,
            status: 'ACTIVE',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: null,
          },
        ],
      };
      expect(() => PrincipalSchema.parse(withMembership)).not.toThrow();
    });
  });

  // ── MeResponseSchema ────────────────────────────────────────────────────

  describe('MeResponseSchema', () => {
    it('accepts valid me response', () => {
      const data = {
        principal: {
          userId: 'u-1',
          displayName: 'A',
          initials: 'A',
          locale: 'en',
          memberships: [],
          staffTemplates: [],
          expert: null,
          context: { kind: 'personal' },
          auth: { method: 'email_otp', time: new Date().toISOString(), secondFactor: false, lastStepUpAt: null },
          sessionId: null,
          tokenFamily: null,
        },
        effectiveActions: ['wellbeing_checkin:read'],
        availableContexts: [{ kind: 'personal', orgId: 'org-1' }],
      };
      expect(() => MeResponseSchema.parse(data)).not.toThrow();
    });
  });

  // ── SessionListResponseSchema ───────────────────────────────────────────

  describe('SessionListResponseSchema', () => {
    it('accepts valid session list', () => {
      const data = {
        sessions: [
          {
            sessionId: 's-1',
            surface: 'workspace',
            createdAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            ipHash: 'abc',
            userAgentFamily: 'Chrome',
            isCurrent: true,
          },
        ],
      };
      expect(SessionListResponseSchema.parse(data)).toEqual(data);
    });

    it('accepts empty session list', () => {
      expect(SessionListResponseSchema.parse({ sessions: [] })).toEqual({ sessions: [] });
    });
  });

  // ── WsTicketResponseSchema ──────────────────────────────────────────────

  describe('WsTicketResponseSchema', () => {
    it('accepts valid ticket', () => {
      const data = { ticket: 'abc123' };
      expect(WsTicketResponseSchema.parse(data)).toEqual(data);
    });

    it('rejects empty ticket', () => {
      expect(() => WsTicketResponseSchema.parse({ ticket: '' })).toThrow();
    });
  });

  // ── TotpEnrolResponseSchema ─────────────────────────────────────────────

  describe('TotpEnrolResponseSchema', () => {
    it('accepts valid totp enrol response', () => {
      const data = {
        secretUri: 'otpauth://totp/NestSelf:user@example.com?secret=ABC&issuer=NestSelf',
        challengeToken: 'tok-123',
      };
      expect(TotpEnrolResponseSchema.parse(data)).toEqual(data);
    });

    it('accepts null challengeToken', () => {
      const data = {
        secretUri: 'otpauth://totp/NestSelf:user@example.com?secret=ABC',
        challengeToken: null,
      };
      expect(TotpEnrolResponseSchema.parse(data)).toEqual(data);
    });

    it('rejects empty secretUri', () => {
      expect(() =>
        TotpEnrolResponseSchema.parse({ secretUri: '', challengeToken: null }),
      ).toThrow();
    });
  });
});
