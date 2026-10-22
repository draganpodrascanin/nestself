import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdentityProviderError } from './identity-provider.service.js';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  // Must be a constructor (class) for `new` to work
  class MockClient {
    send = mockSend;
  }
  return {
    CognitoIdentityProviderClient: MockClient,
    AdminInitiateAuthCommand: class {
      constructor(public input: unknown) {}
    },
    AdminRespondToAuthChallengeCommand: class {
      constructor(public input: unknown) {}
    },
    GetTokensFromRefreshTokenCommand: class {
      constructor(public input: unknown) {}
    },
    RevokeTokenCommand: class {
      constructor(public input: unknown) {}
    },
    AdminUserGlobalSignOutCommand: class {
      constructor(public input: unknown) {}
    },
    AdminCreateUserCommand: class {
      constructor(public input: unknown) {}
    },
    AdminDeleteUserCommand: class {
      constructor(public input: unknown) {}
    },
    AdminDisableUserCommand: class {
      constructor(public input: unknown) {}
    },
    AdminEnableUserCommand: class {
      constructor(public input: unknown) {}
    },
    ListUsersCommand: class {
      constructor(public input: unknown) {}
    },
    AssociateSoftwareTokenCommand: class {
      constructor(public input: unknown) {}
    },
    VerifySoftwareTokenCommand: class {
      constructor(public input: unknown) {}
    },
    SetUserMFAPreferenceCommand: class {
      constructor(public input: unknown) {}
    },
    ForgotPasswordCommand: class {
      constructor(public input: unknown) {}
    },
    ConfirmForgotPasswordCommand: class {
      constructor(public input: unknown) {}
    },
  };
});

// Import AFTER the mock is set up
const { CognitoIdentityProvider } = await import(
  './cognito-identity-provider.js'
);

const REGION = 'eu-central-1';
const POOL_ID = 'eu-central-1_TEST';
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

describe('CognitoIdentityProvider', () => {
  let provider: InstanceType<typeof CognitoIdentityProvider>;

  beforeEach(() => {
    mockSend.mockReset();
    provider = new CognitoIdentityProvider(
      REGION,
      POOL_ID,
      CLIENT_ID,
      CLIENT_SECRET,
    );
  });

  describe('startEmailOtp', () => {
    it('calls AdminInitiateAuth with USER_AUTH and SECRET_HASH', async () => {
      mockSend.mockResolvedValueOnce({
        Session: 'session-123',
        ChallengeName: 'EMAIL_OTP',
        ChallengeParameters: { USER_ID_FOR_SRP: 'user-abc' },
      });

      const result = await provider.startEmailOtp({
        email: 'test@example.com',
      });

      expect(result).toEqual({
        session: 'session-123',
        username: 'user-abc',
      });

      const cmd = mockSend.mock.calls[0]![0] as { input: Record<string, unknown> };
      const input = cmd.input as {
        AuthFlow: string;
        AuthParameters: Record<string, string>;
      };
      expect(input.AuthFlow).toBe('USER_AUTH');
      expect(input.AuthParameters.PREFERRED_CHALLENGE).toBe('EMAIL_OTP');
      expect(input.AuthParameters.SECRET_HASH).toBeTruthy();
      expect(input.AuthParameters.USERNAME).toBe('test@example.com');
    });

    it('returns null when user does not exist', async () => {
      const err = new Error('User not found');
      err.name = 'UserNotFoundException';
      mockSend.mockRejectedValueOnce(err);

      const result = await provider.startEmailOtp({
        email: 'unknown@example.com',
      });
      expect(result).toBeNull();
    });
  });

  describe('respondEmailOtp', () => {
    it('sends EMAIL_OTP_CODE and SECRET_HASH', async () => {
      mockSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: 'access',
          IdToken: 'id',
          RefreshToken: 'refresh',
          ExpiresIn: 900,
        },
      });

      const result = await provider.respondEmailOtp({
        session: 'sess',
        username: 'user-1',
        code: '123456',
      });

      expect(result.kind).toBe('tokens');
      const cmd = mockSend.mock.calls[0]![0] as { input: Record<string, unknown> };
      const input = cmd.input as {
        ChallengeResponses: Record<string, string>;
      };
      expect(input.ChallengeResponses.EMAIL_OTP_CODE).toBe('123456');
      expect(input.ChallengeResponses.SECRET_HASH).toBeTruthy();
    });
  });

  describe('startPassword', () => {
    it('uses ADMIN_USER_PASSWORD_AUTH', async () => {
      mockSend.mockResolvedValueOnce({
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        Session: 's1',
        ChallengeParameters: {},
      });

      const result = await provider.startPassword({
        email: 'test@example.com',
        password: 'Password1!',
      });

      expect(result.kind).toBe('challenge');
      const cmd = mockSend.mock.calls[0]![0] as { input: Record<string, unknown> };
      const input = cmd.input as {
        AuthFlow: string;
        AuthParameters: Record<string, string>;
      };
      expect(input.AuthFlow).toBe('ADMIN_USER_PASSWORD_AUTH');
      expect(input.AuthParameters.PASSWORD).toBe('Password1!');
    });
  });

  describe('error mapping', () => {
    it('maps CodeMismatchException to invalid_code', async () => {
      const err = new Error('Code mismatch');
      err.name = 'CodeMismatchException';
      mockSend.mockRejectedValueOnce(err);

      try {
        await provider.respondEmailOtp({
          session: 's',
          username: 'u',
          code: '000000',
        });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(IdentityProviderError);
        expect((e as IdentityProviderError).code).toBe('invalid_code');
      }
    });

    it('maps NotAuthorizedException to invalid_credentials in auth context', async () => {
      const err = new Error('Not authorized');
      err.name = 'NotAuthorizedException';
      mockSend.mockRejectedValueOnce(err);

      try {
        await provider.startPassword({
          email: 'test@example.com',
          password: 'wrong',
        });
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(IdentityProviderError);
        expect((e as IdentityProviderError).code).toBe('invalid_credentials');
      }
    });
  });

  describe('refresh', () => {
    it('calls GetTokensFromRefreshToken with client secret', async () => {
      mockSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: 'new-access',
          IdToken: 'new-id',
          RefreshToken: 'new-refresh',
          ExpiresIn: 900,
        },
      });

      const result = await provider.refresh({
        refreshToken: 'old-refresh',
      });

      expect(result.accessToken).toBe('new-access');
      const cmd = mockSend.mock.calls[0]![0] as { input: Record<string, unknown> };
      const input = cmd.input as {
        ClientId: string;
        ClientSecret: string;
        RefreshToken: string;
      };
      expect(input.ClientId).toBe(CLIENT_ID);
      expect(input.ClientSecret).toBe(CLIENT_SECRET);
      expect(input.RefreshToken).toBe('old-refresh');
    });
  });

  describe('createUser', () => {
    it('returns username and sub', async () => {
      mockSend.mockResolvedValueOnce({
        User: {
          Attributes: [
            { Name: 'sub', Value: 'sub-uuid' },
            { Name: 'email', Value: 'new@example.com' },
          ],
        },
      });

      const result = await provider.createUser({
        email: 'new@example.com',
        locale: 'en',
        emailVerified: true,
        suppressMessage: true,
      });

      expect(result.sub).toBe('sub-uuid');
      expect(result.username).toBeTruthy();
      const cmd = mockSend.mock.calls[0]![0] as { input: Record<string, unknown> };
      expect((cmd.input as { MessageAction: string }).MessageAction).toBe(
        'SUPPRESS',
      );
    });
  });

  describe('findUserByEmail', () => {
    it('rejects email with quotes to prevent filter injection', async () => {
      const result = await provider.findUserByEmail('a"b@example.com');
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects email with backslash', async () => {
      const result = await provider.findUserByEmail('a\\b@example.com');
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('rejects email with whitespace', async () => {
      const result = await provider.findUserByEmail('a b@example.com');
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns null when no users match', async () => {
      mockSend.mockResolvedValueOnce({ Users: [] });
      const result = await provider.findUserByEmail('nobody@example.com');
      expect(result).toBeNull();
    });

    it('parses user attributes', async () => {
      mockSend.mockResolvedValueOnce({
        Users: [
          {
            Username: 'user-1',
            Enabled: true,
            UserStatus: 'CONFIRMED',
            Attributes: [
              { Name: 'sub', Value: 'sub-1' },
              { Name: 'email', Value: 'found@example.com' },
              { Name: 'email_verified', Value: 'true' },
              { Name: 'custom:locale', Value: 'sr-Latn' },
            ],
          },
        ],
      });

      const result = await provider.findUserByEmail('found@example.com');
      expect(result).toMatchObject({
        username: 'user-1',
        sub: 'sub-1',
        email: 'found@example.com',
        emailVerified: true,
        enabled: true,
        locale: 'sr-Latn',
      });
    });
  });
});

describe('CognitoIdentityProvider.setTotpPreferred', () => {
  it('uses the user-level SetUserMFAPreference call with the access token', async () => {
    const { CognitoIdentityProvider } = await import('./cognito-identity-provider.js');
    const provider = new CognitoIdentityProvider('eu-central-1', 'eu-central-1_test', 'web', 'secret');
    const sent: unknown[] = [];
    (provider as unknown as { client: { send: (c: unknown) => Promise<unknown> } }).client = {
      send: async (command: unknown) => {
        sent.push(command);
        return {};
      },
    };

    await provider.setTotpPreferred({ accessToken: 'at-123' });

    expect(sent).toHaveLength(1);
    const command = sent[0] as { constructor: { name: string }; input: Record<string, unknown> };
    expect(command.constructor.name).toBe('SetUserMFAPreferenceCommand');
    expect(command.input.AccessToken).toBe('at-123');
    expect(command.input).not.toHaveProperty('Username');
  });
});
