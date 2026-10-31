/**
 * In-memory user store for the fake identity provider.
 *
 * Extracted to keep fake-identity-provider.ts under the ~400 line limit.
 * The store holds users, refresh tokens, and provides user-management methods.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { codesEqual } from './totp.js';
import { Logger } from '@nestjs/common';
import type { IdpUser, TokenSet } from './identity-provider.service.js';
import { IdentityProviderError } from './identity-provider.service.js';
import { createFakeTokenSet } from './fake-token-factory.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface FakeUser {
  username: string;
  sub: string;
  email: string;
  password: string | null;
  temporaryPassword: string | null;
  totpSecret: string | null;
  totpEnrolled: boolean;
  enabled: boolean;
  emailVerified: boolean;
  locale: string;
  status: string;
}

export interface FakeOtp {
  code: string;
  expiresAt: number;
}

export interface FakeRefreshEntry {
  username: string;
  familyId: string;
  revoked: boolean;
}

export interface FakeSession {
  email: string;
  username: string;
  challenge: string;
  expiresAt: number;
  newPassword?: string;
  /** Secret issued by associateSoftwareToken, pending verification. */
  pendingTotpSecret?: string;
  /** Set once verifySoftwareToken succeeded for this session (MFA_SETUP). */
  totpVerified?: boolean;
}

export const SESSION_TTL_MS = 5 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_SENT_CODES = 50;

// ---------------------------------------------------------------------------
// User store
// ---------------------------------------------------------------------------

export class FakeUserStore {
  private readonly logger = new Logger('FakeUserStore');

  readonly users = new Map<string, FakeUser>();
  readonly otps = new Map<string, FakeOtp>();
  readonly refreshTokens = new Map<string, FakeRefreshEntry>();
  /** Every code "sent", newest last; `locale` is the language the caller asked for (tests assert it). */
  readonly sentCodes: Array<{ email: string; code: string; sentAt: Date; locale?: string }> = [];

  findUser(email: string): FakeUser | undefined {
    return this.users.get(email.toLowerCase());
  }

  findByUsername(username: string): FakeUser | undefined {
    for (const u of this.users.values()) {
      if (u.username === username) return u;
    }
    return undefined;
  }

  issueTokens(user: FakeUser, idClaims?: Record<string, unknown>): TokenSet {
    const familyId = randomUUID();
    const ts = createFakeTokenSet(user.sub, user.username, familyId, idClaims);
    this.refreshTokens.set(ts.refreshToken!, {
      username: user.username,
      familyId,
      revoked: false,
    });
    return ts;
  }

  sendOtp(email: string, locale?: string): string {
    const code = String(randomInt(100_000, 1_000_000));
    this.otps.set(email, { code, expiresAt: Date.now() + OTP_TTL_MS });
    this.sentCodes.push({ email, code, sentAt: new Date(), locale });
    if (this.sentCodes.length > MAX_SENT_CODES) this.sentCodes.shift();
    this.logger.log(`Fake identity provider: OTP for ${email} is ${code}`);
    return code;
  }

  /**
   * The pool user Cognito creates on a federated user's first sign-in
   * (status EXTERNAL_PROVIDER, username `<providerName>_<subject>`). Kept
   * under a `federated:` key so native email lookups never find it, exactly
   * as a native user and a federated user with the same email are separate
   * Cognito users.
   */
  upsertFederatedUser(input: {
    username: string;
    email: string;
    emailVerified: boolean;
  }): FakeUser {
    const key = `federated:${input.username}`;
    const existing = this.users.get(key);
    if (existing) {
      existing.email = input.email.toLowerCase();
      existing.emailVerified = input.emailVerified;
      return existing;
    }
    const user: FakeUser = {
      username: input.username,
      sub: randomUUID(),
      email: input.email.toLowerCase(),
      password: null,
      temporaryPassword: null,
      totpSecret: null,
      totpEnrolled: false,
      enabled: true,
      emailVerified: input.emailVerified,
      locale: 'en',
      status: 'EXTERNAL_PROVIDER',
    };
    this.users.set(key, user);
    return user;
  }

  // -- User management (public API) ----------------------------------------

  async disableUser(username: string): Promise<void> {
    const u = this.findByUsername(username);
    if (u) u.enabled = false;
  }

  async enableUser(username: string): Promise<void> {
    const u = this.findByUsername(username);
    if (u) u.enabled = true;
  }

  async createUser(input: {
    email: string;
    locale: string;
    emailVerified: boolean;
    temporaryPassword?: string;
    suppressMessage: boolean;
  }): Promise<{ username: string; sub: string }> {
    const email = input.email.toLowerCase();
    const username = randomUUID();
    const sub = randomUUID();
    this.users.set(email, {
      username,
      sub,
      email,
      password: null,
      temporaryPassword: input.temporaryPassword ?? null,
      totpSecret: null,
      totpEnrolled: false,
      enabled: true,
      emailVerified: input.emailVerified,
      locale: input.locale,
      status: input.temporaryPassword ? 'FORCE_CHANGE_PASSWORD' : 'CONFIRMED',
    });
    return { username, sub };
  }

  async deleteUser(username: string): Promise<void> {
    for (const [email, u] of this.users.entries()) {
      if (u.username === username) {
        this.users.delete(email);
        return;
      }
    }
  }

  async findUserByEmail(email: string): Promise<IdpUser | null> {
    const user = this.findUser(email);
    if (!user) return null;
    return {
      username: user.username,
      sub: user.sub,
      email: user.email,
      emailVerified: user.emailVerified,
      enabled: user.enabled,
      status: user.status,
      hasPassword: user.password != null,
      mfaEnrolled: user.totpEnrolled,
      locale: user.locale,
    };
  }

  async forgotPassword(email: string): Promise<void> {
    const user = this.findUser(email);
    if (!user) return;
    this.sendOtp(user.email);
  }

  async confirmForgotPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<void> {
    const user = this.findUser(input.email);
    if (!user) {
      throw new IdentityProviderError('User not found', 'user_not_found');
    }
    const otp = this.otps.get(user.email);
    if (!otp || otp.expiresAt < Date.now() || !codesEqual(otp.code, input.code)) {
      throw new IdentityProviderError('Invalid code', 'invalid_code');
    }
    user.password = input.newPassword;
    user.temporaryPassword = null;
    this.otps.delete(user.email);
  }

  // -- Seed helper ----------------------------------------------------------

  seedUsers(
    users: Array<{
      email: string;
      /** Deterministic subject (sample fixtures); random when omitted. */
      sub?: string;
      username?: string;
      password?: string;
      temporaryPassword?: string;
      totpSecret?: string;
      totpEnrolled?: boolean;
      enabled?: boolean;
      locale?: string;
    }>,
  ): void {
    for (const u of users) {
      const email = u.email.toLowerCase();
      this.users.set(email, {
        username: u.username ?? randomUUID(),
        sub: u.sub ?? randomUUID(),
        email,
        password: u.password ?? null,
        temporaryPassword: u.temporaryPassword ?? null,
        totpSecret: u.totpSecret ?? null,
        totpEnrolled: u.totpEnrolled ?? false,
        enabled: u.enabled ?? true,
        emailVerified: true,
        locale: u.locale ?? 'en',
        status: u.temporaryPassword ? 'FORCE_CHANGE_PASSWORD' : 'CONFIRMED',
      });
    }
  }
}
