/**
 * In-memory identity provider for local development and tests.
 *
 * Makes the entire sign-in system testable without AWS. Users are
 * keyed by normalised email; sessions, OTP codes and refresh tokens
 * are tracked in-process Maps.
 *
 * **Not for production**: constructing this class when NODE_ENV is
 * 'production' throws immediately.
 *
 * @see D-12, D-36, T-1.15
 */
import { randomBytes } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import {
  IdentityProviderService,
  IdentityProviderError,
} from './identity-provider.service.js';
import type {
  AuthOutcome,
  TokenSet,
  IdpUser,
} from './identity-provider.service.js';
import { verifyTotp, generateTotpSecret } from './totp.js';
import {
  FakeUserStore,
  SESSION_TTL_MS,
  type FakeSession,
  type FakeUser,
} from './fake-user-store.js';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class FakeIdentityProvider extends IdentityProviderService {
  private readonly store = new FakeUserStore();
  private readonly sessions = new Map<string, FakeSession>();

  /** Public array of sent OTP codes for test assertions. */
  get sentCodes() {
    return this.store.sentCodes;
  }

  constructor() {
    super();
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FakeIdentityProvider must not be used in production',
      );
    }
  }

  // -- Helpers --------------------------------------------------------------

  private createSession(
    email: string,
    username: string,
    challenge: string,
  ): string {
    const id = randomBytes(16).toString('hex');
    this.sessions.set(id, {
      email,
      username,
      challenge,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return id;
  }

  private getSession(id: string, expected: string): FakeSession {
    const s = this.sessions.get(id);
    if (!s || s.expiresAt < Date.now()) {
      throw new IdentityProviderError('Session expired', 'expired_session');
    }
    if (s.challenge !== expected) {
      throw new IdentityProviderError('Wrong challenge type', 'not_authorized');
    }
    return s;
  }

  private nextChallenge(user: FakeUser, sessionId: string): AuthOutcome {
    if (user.temporaryPassword) {
      return {
        kind: 'challenge',
        challenge: 'NEW_PASSWORD_REQUIRED',
        session: sessionId,
        username: user.username,
      };
    }
    if (!user.totpEnrolled && user.password) {
      return {
        kind: 'challenge',
        challenge: 'MFA_SETUP',
        session: sessionId,
        username: user.username,
      };
    }
    if (user.totpEnrolled) {
      return {
        kind: 'challenge',
        challenge: 'SOFTWARE_TOKEN_MFA',
        session: sessionId,
        username: user.username,
      };
    }
    return { kind: 'tokens', tokens: this.store.issueTokens(user) };
  }

  // -- Seed helper (delegates to store) ------------------------------------

  seedUsers(
    users: Parameters<FakeUserStore['seedUsers']>[0],
  ): void {
    this.store.seedUsers(users);
  }

  // -- Auth flows -----------------------------------------------------------

  async startEmailOtp(input: {
    email: string;
    locale?: string;
  }): Promise<{ session: string; username: string } | null> {
    const user = this.store.findUser(input.email);
    if (!user) return null;
    if (!user.enabled) {
      throw new IdentityProviderError('User disabled', 'user_disabled');
    }

    this.store.sendOtp(user.email);

    const session = this.createSession(
      user.email,
      user.username,
      'EMAIL_OTP',
    );
    return { session, username: user.username };
  }

  async respondEmailOtp(input: {
    session: string;
    username: string;
    code: string;
  }): Promise<AuthOutcome> {
    const s = this.getSession(input.session, 'EMAIL_OTP');
    const user = this.store.findUser(s.email);
    if (!user) {
      throw new IdentityProviderError('User not found', 'user_not_found');
    }

    const otp = this.store.otps.get(user.email);
    const fixedOtp = process.env.FAKE_IDP_FIXED_OTP;

    const codeMatches =
      (fixedOtp && /^\d{6}$/.test(fixedOtp) && input.code === fixedOtp) ||
      (otp && otp.expiresAt >= Date.now() && otp.code === input.code);

    if (!codeMatches) {
      throw new IdentityProviderError('Invalid code', 'invalid_code');
    }

    this.store.otps.delete(user.email);
    this.sessions.delete(input.session);
    return { kind: 'tokens', tokens: this.store.issueTokens(user) };
  }

  async startPassword(input: {
    email: string;
    password: string;
  }): Promise<AuthOutcome> {
    const user = this.store.findUser(input.email);
    if (!user) {
      throw new IdentityProviderError('Invalid credentials', 'invalid_credentials');
    }
    if (!user.enabled) {
      throw new IdentityProviderError('User disabled', 'user_disabled');
    }

    const expected = user.temporaryPassword ?? user.password;
    if (!expected) {
      throw new IdentityProviderError('Invalid credentials', 'invalid_credentials');
    }

    const a = Buffer.from(input.password);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new IdentityProviderError('Invalid credentials', 'invalid_credentials');
    }

    const sessionId = this.createSession(
      user.email,
      user.username,
      'PASSWORD_DONE',
    );
    return this.nextChallenge(user, sessionId);
  }

  async respondTotp(input: {
    session: string;
    username: string;
    code: string;
  }): Promise<AuthOutcome> {
    const s = this.getSession(input.session, 'SOFTWARE_TOKEN_MFA');
    const user = this.store.findUser(s.email);
    if (!user?.totpSecret) {
      throw new IdentityProviderError('TOTP not enrolled', 'not_authorized');
    }

    if (!verifyTotp(user.totpSecret, input.code)) {
      throw new IdentityProviderError('Invalid code', 'invalid_code');
    }

    this.sessions.delete(input.session);
    return { kind: 'tokens', tokens: this.store.issueTokens(user) };
  }

  async respondNewPassword(input: {
    session: string;
    username: string;
    newPassword: string;
  }): Promise<AuthOutcome> {
    const s = this.getSession(input.session, 'NEW_PASSWORD_REQUIRED');
    const user = this.store.findUser(s.email);
    if (!user) {
      throw new IdentityProviderError('User not found', 'user_not_found');
    }

    user.password = input.newPassword;
    user.temporaryPassword = null;
    user.status = 'CONFIRMED';
    this.sessions.delete(input.session);

    const sessionId = this.createSession(
      user.email,
      user.username,
      'PASSWORD_DONE',
    );
    return this.nextChallenge(user, sessionId);
  }

  async completeMfaSetup(input: {
    session: string;
    username: string;
  }): Promise<AuthOutcome> {
    const s = this.getSession(input.session, 'MFA_SETUP');
    const user = this.store.findUser(s.email);
    if (!user) {
      throw new IdentityProviderError('User not found', 'user_not_found');
    }
    this.sessions.delete(input.session);
    return { kind: 'tokens', tokens: this.store.issueTokens(user) };
  }

  // -- TOTP management ------------------------------------------------------

  async associateSoftwareToken(input: {
    session?: string;
    accessToken?: string;
  }): Promise<{ secretCode: string; session?: string }> {
    const secret = generateTotpSecret();
    const session = input.session ?? randomBytes(16).toString('hex');
    this.sessions.set(session, {
      email: '',
      username: '',
      challenge: `TOTP_ASSOCIATE:${secret}`,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return { secretCode: secret, session };
  }

  async verifySoftwareToken(input: {
    session?: string;
    accessToken?: string;
    code: string;
    friendlyDeviceName?: string;
  }): Promise<{ session?: string }> {
    const s = this.sessions.get(input.session ?? '');
    if (!s || !s.challenge.startsWith('TOTP_ASSOCIATE:')) {
      throw new IdentityProviderError('Invalid session', 'expired_session');
    }
    const secret = s.challenge.slice('TOTP_ASSOCIATE:'.length);
    if (!verifyTotp(secret, input.code)) {
      throw new IdentityProviderError('Invalid code', 'invalid_code');
    }
    this.sessions.delete(input.session ?? '');
    return { session: input.session };
  }

  async setTotpPreferred(_input: { accessToken: string }): Promise<void> {
    // In the fake provider, TOTP preference is set during verify
  }

  // -- Token management -----------------------------------------------------

  async refresh(input: {
    refreshToken: string;
    username?: string;
  }): Promise<TokenSet> {
    const entry = this.store.refreshTokens.get(input.refreshToken);
    if (!entry || entry.revoked) {
      throw new IdentityProviderError(
        'Token revoked or not found',
        'not_authorized',
      );
    }

    const user = this.store.findByUsername(entry.username);
    if (!user) {
      throw new IdentityProviderError('User not found', 'user_not_found');
    }

    // Rotate: revoke old, issue new in same family
    entry.revoked = true;
    const { createFakeTokenSet } = await import('./fake-token-factory.js');
    const ts = createFakeTokenSet(user.sub, user.username, entry.familyId);
    this.store.refreshTokens.set(ts.refreshToken!, {
      username: entry.username,
      familyId: entry.familyId,
      revoked: false,
    });
    return ts;
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const entry = this.store.refreshTokens.get(refreshToken);
    if (entry) entry.revoked = true;
  }

  async globalSignOut(username: string): Promise<void> {
    for (const entry of this.store.refreshTokens.values()) {
      if (entry.username === username) entry.revoked = true;
    }
  }

  // -- User management (delegated to store) --------------------------------

  async disableUser(username: string): Promise<void> {
    return this.store.disableUser(username);
  }

  async enableUser(username: string): Promise<void> {
    return this.store.enableUser(username);
  }

  async createUser(input: {
    email: string;
    locale: string;
    emailVerified: boolean;
    temporaryPassword?: string;
    suppressMessage: boolean;
  }): Promise<{ username: string; sub: string }> {
    return this.store.createUser(input);
  }

  async deleteUser(username: string): Promise<void> {
    return this.store.deleteUser(username);
  }

  async findUserByEmail(email: string): Promise<IdpUser | null> {
    return this.store.findUserByEmail(email);
  }

  async forgotPassword(email: string): Promise<void> {
    return this.store.forgotPassword(email);
  }

  async confirmForgotPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<void> {
    return this.store.confirmForgotPassword(input);
  }
}
