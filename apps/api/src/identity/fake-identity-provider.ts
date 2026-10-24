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
  decodeJwtClaims,
} from './identity-provider.service.js';
import type {
  AuthOutcome,
  TokenSet,
  IdpUser,
} from './identity-provider.service.js';
import { verifyTotp, generateTotpSecret, codesEqual } from './totp.js';
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
  /** username -> pending TOTP association session id (signed-in enrolment). */
  private readonly pendingByUsername = new Map<string, string>();

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

  private updateSessionChallenge(sessionId: string, challenge: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.challenge = challenge;
  }

  private nextChallenge(user: FakeUser, sessionId: string): AuthOutcome {
    if (user.temporaryPassword) {
      this.updateSessionChallenge(sessionId, 'NEW_PASSWORD_REQUIRED');
      return {
        kind: 'challenge',
        challenge: 'NEW_PASSWORD_REQUIRED',
        session: sessionId,
        username: user.username,
      };
    }
    if (!user.totpEnrolled && user.password) {
      this.updateSessionChallenge(sessionId, 'MFA_SETUP');
      return {
        kind: 'challenge',
        challenge: 'MFA_SETUP',
        session: sessionId,
        username: user.username,
      };
    }
    if (user.totpEnrolled) {
      this.updateSessionChallenge(sessionId, 'SOFTWARE_TOKEN_MFA');
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
      (fixedOtp && /^\d{6}$/.test(fixedOtp) && codesEqual(fixedOtp, input.code)) ||
      (otp && otp.expiresAt >= Date.now() && codesEqual(otp.code, input.code));

    if (!codeMatches) {
      // The session survives a mismatch, as Cognito's does (CodeMismatchException).
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
    // Cognito only completes MFA_SETUP after VerifySoftwareToken succeeded
    // on the same session; mirror that so the flow cannot skip the code.
    if (!s.totpVerified || !user.totpEnrolled) {
      throw new IdentityProviderError(
        'Software token not verified for this session',
        'not_authorized',
      );
    }
    this.sessions.delete(input.session);
    return { kind: 'tokens', tokens: this.store.issueTokens(user) };
  }

  // -- TOTP management ------------------------------------------------------

  /** Resolve the user behind a fake access token (claims.username). */
  private userFromAccessToken(accessToken: string): FakeUser {
    const claims = decodeJwtClaims(accessToken);
    const user = claims.username
      ? this.store.findByUsername(claims.username)
      : undefined;
    if (!user) {
      throw new IdentityProviderError('Invalid access token', 'not_authorized');
    }
    return user;
  }

  async associateSoftwareToken(input: {
    session?: string;
    accessToken?: string;
  }): Promise<{ secretCode: string; session?: string }> {
    const secret = generateTotpSecret();

    if (input.session) {
      // MFA_SETUP path: keep the challenge session, attach the pending secret.
      const s = this.getSession(input.session, 'MFA_SETUP');
      s.pendingTotpSecret = secret;
      s.totpVerified = false;
      return { secretCode: secret, session: input.session };
    }

    if (input.accessToken) {
      // Signed-in path: remember the pending secret on a dedicated session
      // keyed by a fresh id so verifySoftwareToken can find it.
      const user = this.userFromAccessToken(input.accessToken);
      const id = randomBytes(16).toString('hex');
      this.sessions.set(id, {
        email: user.email,
        username: user.username,
        challenge: 'TOTP_ASSOCIATE',
        expiresAt: Date.now() + SESSION_TTL_MS,
        pendingTotpSecret: secret,
      });
      this.pendingByUsername.set(user.username, id);
      return { secretCode: secret, session: id };
    }

    throw new IdentityProviderError(
      'Either session or accessToken is required',
      'not_authorized',
    );
  }

  async verifySoftwareToken(input: {
    session?: string;
    accessToken?: string;
    code: string;
    friendlyDeviceName?: string;
  }): Promise<{ session?: string }> {
    let sessionId = input.session;
    if (!sessionId && input.accessToken) {
      const user = this.userFromAccessToken(input.accessToken);
      sessionId = this.pendingByUsername.get(user.username);
    }
    const s = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!s || s.expiresAt < Date.now() || !s.pendingTotpSecret) {
      throw new IdentityProviderError('Invalid session', 'expired_session');
    }
    if (!verifyTotp(s.pendingTotpSecret, input.code)) {
      throw new IdentityProviderError('Invalid code', 'invalid_code');
    }
    const user = this.store.findUser(s.email);
    if (!user) {
      throw new IdentityProviderError('User not found', 'user_not_found');
    }
    user.totpSecret = s.pendingTotpSecret;
    user.totpEnrolled = true;
    s.pendingTotpSecret = undefined;
    s.totpVerified = true;

    if (s.challenge === 'TOTP_ASSOCIATE') {
      // Signed-in enrolment is complete; the session has no further use.
      this.sessions.delete(sessionId!);
      this.pendingByUsername.delete(user.username);
      return {};
    }
    // MFA_SETUP: the same session continues to completeMfaSetup().
    return { session: sessionId };
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
