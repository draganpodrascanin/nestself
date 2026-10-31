/**
 * Unit tests for WsAuthService — WebSocket handshake authentication.
 *
 * @see T-1.11, AUTHZ-R-58, AUTHZ-R-60
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WsAuthService, WsAuthError } from './ws-auth.service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];

const LOADED_PRINCIPAL = {
  userId: 'user_jovan',
  displayName: 'Jovan Petrovic',
  initials: 'JP',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'mem_1',
      orgId: 'org_sample',
      orgUnitId: 'ou_root',
      status: 'ACTIVE' as const,
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  isSuspended: false,
  isDeactivated: false,
  populationHints: {
    hasStaffGrants: false,
    hasExpertGrants: false,
    hasActiveMembership: true,
  },
};

const SESSION_RECORD = {
  sessionId: 'sid_abc',
  userId: 'user_jovan',
  auth: {
    method: 'email_otp' as const,
    time: '2024-01-01T00:00:00Z',
    secondFactor: false,
  },
  context: { kind: 'organization' as const, orgId: 'org_sample' },
  lastStepUpAt: null,
  csrfToken: 'csrf_tok',
  surface: 'workspace' as const,
  createdAt: '2024-01-01T00:00:00Z',
  lastActivityAt: '2024-01-01T00:00:00Z',
  absoluteExpiresAt: '2024-12-31T23:59:59Z',
  ipHash: 'abc',
  userAgentFamily: 'test',
  population: 'employee' as const,
};

function createMocks() {
  const sessions = {
    get: vi.fn(),
  };
  const cookies = {
    parse: vi.fn(),
    sessionName: 'nestself_session',
    csrfName: 'nestself_csrf',
  };
  const principalLoader = {
    load: vi.fn(),
  };
  const store = {
    kind: 'memory' as const,
    getDel: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    incr: vi.fn(),
    sAdd: vi.fn(),
    sRem: vi.fn(),
    sMembers: vi.fn(),
    scan: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
    compareAndDelete: vi.fn(),
    compareAndSet: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
  };

  const service = new WsAuthService(
    sessions as never,
    cookies as never,
    principalLoader as never,
    store,
  );

  return { service, sessions, cookies, principalLoader, store };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WsAuthService', () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  // -----------------------------------------------------------------------
  // Cookie path
  // -----------------------------------------------------------------------

  describe('cookie path', () => {
    it('authenticates a valid session cookie', async () => {
      mocks.cookies.parse.mockReturnValue({
        sessionId: 'sid_abc',
        csrfToken: 'csrf_tok',
      });
      mocks.sessions.get.mockResolvedValue(SESSION_RECORD);
      mocks.principalLoader.load.mockResolvedValue(LOADED_PRINCIPAL);

      const principal = await mocks.service.authenticateHandshake(
        { cookie: 'nestself_session=sid_abc' },
        {},
        'http://localhost:5173',
        ALLOWED_ORIGINS,
      );

      expect(principal.userId).toBe('user_jovan');
      expect(principal.context).toEqual({
        kind: 'organization',
        orgId: 'org_sample',
      });
    });

    it('rejects when session is missing', async () => {
      mocks.cookies.parse.mockReturnValue({
        sessionId: 'sid_gone',
        csrfToken: null,
      });
      mocks.sessions.get.mockResolvedValue(null);

      await expect(
        mocks.service.authenticateHandshake(
          { cookie: 'nestself_session=sid_gone' },
          {},
          'http://localhost:5173',
          ALLOWED_ORIGINS,
        ),
      ).rejects.toThrow(WsAuthError);

      try {
        await mocks.service.authenticateHandshake(
          { cookie: 'nestself_session=sid_gone' },
          {},
          'http://localhost:5173',
          ALLOWED_ORIGINS,
        );
      } catch (err) {
        expect((err as WsAuthError).code).toBe('unauthorized');
      }
    });

    it('rejects a suspended user', async () => {
      mocks.cookies.parse.mockReturnValue({
        sessionId: 'sid_abc',
        csrfToken: null,
      });
      mocks.sessions.get.mockResolvedValue(SESSION_RECORD);
      mocks.principalLoader.load.mockResolvedValue({
        ...LOADED_PRINCIPAL,
        isSuspended: true,
      });

      await expect(
        mocks.service.authenticateHandshake(
          { cookie: 'nestself_session=sid_abc' },
          {},
          'http://localhost:5173',
          ALLOWED_ORIGINS,
        ),
      ).rejects.toThrow(WsAuthError);
    });

    it('rejects when no cookie is present', async () => {
      mocks.cookies.parse.mockReturnValue({
        sessionId: null,
        csrfToken: null,
      });

      await expect(
        mocks.service.authenticateHandshake({}, {}, null, ALLOWED_ORIGINS),
      ).rejects.toThrow(WsAuthError);
    });
  });

  // -----------------------------------------------------------------------
  // Ticket path
  // -----------------------------------------------------------------------

  describe('ticket path', () => {
    it('authenticates a valid ticket', async () => {
      const ticketData = JSON.stringify({
        userId: 'user_jovan',
        createdAt: new Date().toISOString(),
      });
      mocks.store.getDel.mockResolvedValue(ticketData);
      mocks.principalLoader.load.mockResolvedValue(LOADED_PRINCIPAL);

      const principal = await mocks.service.authenticateHandshake(
        {},
        { ticket: 'valid-ticket-base64' },
        null,
        ALLOWED_ORIGINS,
      );

      expect(principal.userId).toBe('user_jovan');
      expect(mocks.store.getDel).toHaveBeenCalledTimes(1);
    });

    it('rejects a reused ticket (single-use, AUTHZ-R-60)', async () => {
      // First use consumes the ticket
      const ticketData = JSON.stringify({
        userId: 'user_jovan',
        createdAt: new Date().toISOString(),
      });
      mocks.store.getDel.mockResolvedValueOnce(ticketData);
      mocks.principalLoader.load.mockResolvedValue(LOADED_PRINCIPAL);

      await mocks.service.authenticateHandshake(
        {},
        { ticket: 'single-use-ticket' },
        null,
        ALLOWED_ORIGINS,
      );

      // Second use: getDel returns null (already consumed)
      mocks.store.getDel.mockResolvedValueOnce(null);

      await expect(
        mocks.service.authenticateHandshake(
          {},
          { ticket: 'single-use-ticket' },
          null,
          ALLOWED_ORIGINS,
        ),
      ).rejects.toThrow(WsAuthError);

      try {
        mocks.store.getDel.mockResolvedValueOnce(null);
        await mocks.service.authenticateHandshake(
          {},
          { ticket: 'single-use-ticket' },
          null,
          ALLOWED_ORIGINS,
        );
      } catch (err) {
        expect((err as WsAuthError).code).toBe('invalid_ticket');
      }
    });

    it('rejects an expired ticket (>30s)', async () => {
      const ticketData = JSON.stringify({
        userId: 'user_jovan',
        createdAt: new Date(Date.now() - 60_000).toISOString(), // 60s ago
      });
      mocks.store.getDel.mockResolvedValue(ticketData);

      await expect(
        mocks.service.authenticateHandshake(
          {},
          { ticket: 'expired-ticket' },
          null,
          ALLOWED_ORIGINS,
        ),
      ).rejects.toThrow(WsAuthError);
    });
  });

  // -----------------------------------------------------------------------
  // Origin check
  // -----------------------------------------------------------------------

  describe('origin check', () => {
    it('rejects a bad origin', async () => {
      await expect(
        mocks.service.authenticateHandshake(
          {},
          {},
          'http://evil.example.com',
          ALLOWED_ORIGINS,
        ),
      ).rejects.toThrow(WsAuthError);

      try {
        await mocks.service.authenticateHandshake(
          {},
          {},
          'http://evil.example.com',
          ALLOWED_ORIGINS,
        );
      } catch (err) {
        expect((err as WsAuthError).code).toBe('forbidden_origin');
      }
    });

    it('allows when no origin header is present (mobile)', async () => {
      const ticketData = JSON.stringify({
        userId: 'user_jovan',
        createdAt: new Date().toISOString(),
      });
      mocks.store.getDel.mockResolvedValue(ticketData);
      mocks.principalLoader.load.mockResolvedValue(LOADED_PRINCIPAL);

      const principal = await mocks.service.authenticateHandshake(
        {},
        { ticket: 'mobile-ticket' },
        null,
        ALLOWED_ORIGINS,
      );

      expect(principal.userId).toBe('user_jovan');
    });
  });
});
