import { describe, it, expect, beforeEach } from 'vitest';
import { FakeIdentityProvider } from './fake-identity-provider.js';
import { IdentityProviderError, decodeJwtClaims } from './identity-provider.service.js';

describe('FakeIdentityProvider', () => {
  let provider: FakeIdentityProvider;

  beforeEach(() => {
    provider = new FakeIdentityProvider();
  });

  describe('production guard', () => {
    it('throws when NODE_ENV is production', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(() => new FakeIdentityProvider()).toThrow('production');
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });

  describe('email OTP flow', () => {
    beforeEach(() => {
      provider.seedUsers([{ email: 'alice@example.com' }]);
    });

    it('returns null for unknown users', async () => {
      const result = await provider.startEmailOtp({
        email: 'nobody@example.com',
      });
      expect(result).toBeNull();
    });

    it('sends an OTP code and completes sign-in', async () => {
      const start = await provider.startEmailOtp({
        email: 'alice@example.com',
      });
      expect(start).not.toBeNull();
      expect(provider.sentCodes.length).toBe(1);

      const code = provider.sentCodes[0]!.code;
      const result = await provider.respondEmailOtp({
        session: start!.session,
        username: start!.username,
        code,
      });

      expect(result.kind).toBe('tokens');
      if (result.kind === 'tokens') {
        expect(result.tokens.accessToken).toBeTruthy();
        expect(result.tokens.refreshToken).toBeTruthy();
        // Verify the token looks like a real JWT
        const claims = decodeJwtClaims(result.tokens.accessToken);
        expect(claims.sub).toBeTruthy();
        expect(claims.token_use).toBe('access');
      }
    });

    it('rejects an invalid code', async () => {
      const start = await provider.startEmailOtp({
        email: 'alice@example.com',
      });

      await expect(
        provider.respondEmailOtp({
          session: start!.session,
          username: start!.username,
          code: '000000',
        }),
      ).rejects.toThrow(IdentityProviderError);
    });
  });

  describe('FAKE_IDP_FIXED_OTP', () => {
    it('accepts the fixed OTP code when set', async () => {
      provider.seedUsers([{ email: 'bob@example.com' }]);
      const original = process.env.FAKE_IDP_FIXED_OTP;
      process.env.FAKE_IDP_FIXED_OTP = '999999';
      try {
        const start = await provider.startEmailOtp({
          email: 'bob@example.com',
        });
        const result = await provider.respondEmailOtp({
          session: start!.session,
          username: start!.username,
          code: '999999',
        });
        expect(result.kind).toBe('tokens');
      } finally {
        process.env.FAKE_IDP_FIXED_OTP = original;
      }
    });
  });

  describe('password + TOTP flow', () => {
    beforeEach(() => {
      provider.seedUsers([
        {
          email: 'expert@example.com',
          password: 'SecureP@ss1',
          totpSecret: 'JBSWY3DPEHPK3PXP',
          totpEnrolled: true,
        },
      ]);
    });

    it('returns SOFTWARE_TOKEN_MFA challenge after password', async () => {
      const result = await provider.startPassword({
        email: 'expert@example.com',
        password: 'SecureP@ss1',
      });
      expect(result.kind).toBe('challenge');
      if (result.kind === 'challenge') {
        expect(result.challenge).toBe('SOFTWARE_TOKEN_MFA');
      }
    });

    it('rejects wrong password', async () => {
      await expect(
        provider.startPassword({
          email: 'expert@example.com',
          password: 'WrongPassword',
        }),
      ).rejects.toThrow(IdentityProviderError);
    });
  });

  describe('temporary password -> NEW_PASSWORD_REQUIRED', () => {
    it('returns NEW_PASSWORD_REQUIRED challenge', async () => {
      provider.seedUsers([
        {
          email: 'newuser@example.com',
          temporaryPassword: 'TempP@ss1',
        },
      ]);

      const result = await provider.startPassword({
        email: 'newuser@example.com',
        password: 'TempP@ss1',
      });
      expect(result.kind).toBe('challenge');
      if (result.kind === 'challenge') {
        expect(result.challenge).toBe('NEW_PASSWORD_REQUIRED');
      }
    });
  });

  describe('refresh token rotation', () => {
    it('rotates refresh tokens and revokes old ones', async () => {
      provider.seedUsers([{ email: 'carol@example.com' }]);
      const start = await provider.startEmailOtp({
        email: 'carol@example.com',
      });
      const code = provider.sentCodes[0]!.code;
      const result = await provider.respondEmailOtp({
        session: start!.session,
        username: start!.username,
        code,
      });

      if (result.kind !== 'tokens') throw new Error('Expected tokens');
      const firstRefresh = result.tokens.refreshToken!;

      // Refresh -> get a new refresh token
      const refreshed = await provider.refresh({
        refreshToken: firstRefresh,
      });
      expect(refreshed.refreshToken).not.toBe(firstRefresh);

      // Old refresh token should now be revoked
      await expect(
        provider.refresh({ refreshToken: firstRefresh }),
      ).rejects.toThrow(IdentityProviderError);
    });
  });

  describe('globalSignOut', () => {
    it('revokes all refresh tokens for the user', async () => {
      provider.seedUsers([{ email: 'dave@example.com' }]);
      const start = await provider.startEmailOtp({
        email: 'dave@example.com',
      });
      const code = provider.sentCodes[0]!.code;
      const result = await provider.respondEmailOtp({
        session: start!.session,
        username: start!.username,
        code,
      });

      if (result.kind !== 'tokens') throw new Error('Expected tokens');

      await provider.globalSignOut(start!.username);

      await expect(
        provider.refresh({ refreshToken: result.tokens.refreshToken! }),
      ).rejects.toThrow(IdentityProviderError);
    });
  });

  describe('createUser', () => {
    it('creates a user and finds them by email', async () => {
      const { username, sub } = await provider.createUser({
        email: 'New@Example.COM',
        locale: 'sr-Latn',
        emailVerified: true,
        suppressMessage: true,
      });

      expect(username).toBeTruthy();
      expect(sub).toBeTruthy();

      const found = await provider.findUserByEmail('new@example.com');
      expect(found).not.toBeNull();
      expect(found!.sub).toBe(sub);
      expect(found!.locale).toBe('sr-Latn');
    });
  });

  describe('findUserByEmail', () => {
    it('returns null for unknown users', async () => {
      const result = await provider.findUserByEmail('ghost@example.com');
      expect(result).toBeNull();
    });
  });

  describe('disableUser / enableUser', () => {
    it('disables and re-enables a user', async () => {
      provider.seedUsers([{ email: 'eve@example.com' }]);
      const user = await provider.findUserByEmail('eve@example.com');
      await provider.disableUser(user!.username);

      await expect(
        provider.startEmailOtp({ email: 'eve@example.com' }),
      ).rejects.toThrow(IdentityProviderError);

      await provider.enableUser(user!.username);
      const result = await provider.startEmailOtp({
        email: 'eve@example.com',
      });
      expect(result).not.toBeNull();
    });
  });

  describe('decodeJwtClaims', () => {
    it('decodes a valid JWT payload', () => {
      const payload = Buffer.from(
        JSON.stringify({ sub: 'abc', exp: 1234567890 }),
      ).toString('base64url');
      const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
      const claims = decodeJwtClaims(token);
      expect(claims.sub).toBe('abc');
      expect(claims.exp).toBe(1234567890);
    });

    it('returns empty object for malformed tokens', () => {
      expect(decodeJwtClaims('not-a-jwt')).toEqual({});
      expect(decodeJwtClaims('')).toEqual({});
    });
  });
});
