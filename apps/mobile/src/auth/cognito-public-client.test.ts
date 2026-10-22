import { describe, it, expect, vi } from 'vitest';
import { createCognitoPublicClient, CognitoError } from './cognito-public-client';
import type { CognitoConfig } from './config';

const CONFIG: CognitoConfig = {
  region: 'eu-central-1',
  userPoolId: 'eu-central-1_TestPool',
  clientId: 'test-client-id',
  domain: 'https://test.auth.eu-central-1.amazoncognito.com',
};

const ENDPOINT = `https://cognito-idp.${CONFIG.region}.amazonaws.com/`;

function mockFetch(body: Record<string, unknown>, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('CognitoPublicClient', () => {
  describe('initiateEmailOtp', () => {
    it('sends the correct request', async () => {
      const fetchFn = mockFetch({
        ChallengeName: 'EMAIL_OTP',
        Session: 'session-token-abc',
      });
      const client = createCognitoPublicClient(CONFIG, fetchFn);
      const result = await client.initiateEmailOtp('user@example.com');

      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(url).toBe(ENDPOINT);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/x-amz-json-1.1');
      expect(init.headers['X-Amz-Target']).toBe(
        'AWSCognitoIdentityProviderService.InitiateAuth',
      );

      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['AuthFlow']).toBe('USER_AUTH');
      expect(body['ClientId']).toBe('test-client-id');
      expect((body['AuthParameters'] as Record<string, string>)['USERNAME']).toBe('user@example.com');
      expect((body['AuthParameters'] as Record<string, string>)['PREFERRED_CHALLENGE']).toBe('EMAIL_OTP');

      expect(result.session).toBe('session-token-abc');
      expect(result.challengeName).toBe('EMAIL_OTP');
    });

    it('maps UserNotFoundException to not_authorized', async () => {
      const fetchFn = mockFetch(
        { __type: 'UserNotFoundException', message: 'User does not exist.' },
        false,
        400,
      );
      const client = createCognitoPublicClient(CONFIG, fetchFn);

      await expect(client.initiateEmailOtp('nobody@example.com')).rejects.toThrow(CognitoError);
      try {
        await client.initiateEmailOtp('nobody@example.com');
      } catch (err) {
        expect((err as CognitoError).code).toBe('not_authorized');
      }
    });
  });

  describe('respondToEmailOtp', () => {
    it('sends the correct request and returns tokens', async () => {
      const fetchFn = mockFetch({
        AuthenticationResult: {
          AccessToken: 'access-tok',
          IdToken: 'id-tok',
          RefreshToken: 'refresh-tok',
        },
      });
      const client = createCognitoPublicClient(CONFIG, fetchFn);
      const result = await client.respondToEmailOtp('sess', 'user@example.com', '123456');

      const [, init] = fetchFn.mock.calls[0]!;
      expect(init.headers['X-Amz-Target']).toBe(
        'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
      );
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['ChallengeName']).toBe('EMAIL_OTP');
      expect(body['Session']).toBe('sess');
      expect((body['ChallengeResponses'] as Record<string, string>)['EMAIL_OTP_CODE']).toBe('123456');

      expect(result.accessToken).toBe('access-tok');
      expect(result.idToken).toBe('id-tok');
      expect(result.refreshToken).toBe('refresh-tok');
    });

    it('maps CodeMismatchException to invalid_code', async () => {
      const fetchFn = mockFetch(
        { __type: 'CodeMismatchException', message: 'Invalid code' },
        false,
        400,
      );
      const client = createCognitoPublicClient(CONFIG, fetchFn);

      try {
        await client.respondToEmailOtp('sess', 'user@example.com', '000000');
      } catch (err) {
        expect(err).toBeInstanceOf(CognitoError);
        expect((err as CognitoError).code).toBe('invalid_code');
      }
    });

    it('maps ExpiredCodeException to expired_code', async () => {
      const fetchFn = mockFetch(
        { __type: 'ExpiredCodeException', message: 'Code expired' },
        false,
        400,
      );
      const client = createCognitoPublicClient(CONFIG, fetchFn);

      try {
        await client.respondToEmailOtp('sess', 'user@example.com', '000000');
      } catch (err) {
        expect((err as CognitoError).code).toBe('expired_code');
      }
    });

    it('maps NotAuthorizedException with session message to expired_code', async () => {
      const fetchFn = mockFetch(
        { __type: 'NotAuthorizedException', message: 'Session is expired' },
        false,
        400,
      );
      const client = createCognitoPublicClient(CONFIG, fetchFn);

      try {
        await client.respondToEmailOtp('sess', 'user@example.com', '000000');
      } catch (err) {
        expect((err as CognitoError).code).toBe('expired_code');
      }
    });

    it('maps TooManyRequestsException to too_many_attempts', async () => {
      const fetchFn = mockFetch(
        { __type: 'TooManyRequestsException', message: 'Rate exceeded' },
        false,
        429,
      );
      const client = createCognitoPublicClient(CONFIG, fetchFn);

      try {
        await client.respondToEmailOtp('sess', 'user@example.com', '000000');
      } catch (err) {
        expect((err as CognitoError).code).toBe('too_many_attempts');
      }
    });

    it('maps LimitExceededException to too_many_attempts', async () => {
      const fetchFn = mockFetch(
        { __type: 'LimitExceededException', message: 'Attempt limit exceeded' },
        false,
        400,
      );
      const client = createCognitoPublicClient(CONFIG, fetchFn);

      try {
        await client.respondToEmailOtp('sess', 'user@example.com', '000000');
      } catch (err) {
        expect((err as CognitoError).code).toBe('too_many_attempts');
      }
    });
  });

  describe('refreshTokens', () => {
    it('sends GetTokensFromRefreshToken', async () => {
      const fetchFn = mockFetch({
        AuthenticationResult: {
          AccessToken: 'new-access',
          IdToken: 'new-id',
        },
      });
      const client = createCognitoPublicClient(CONFIG, fetchFn);
      const result = await client.refreshTokens('refresh-tok');

      const [, init] = fetchFn.mock.calls[0]!;
      expect(init.headers['X-Amz-Target']).toBe(
        'AWSCognitoIdentityProviderService.GetTokensFromRefreshToken',
      );
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['RefreshToken']).toBe('refresh-tok');
      expect(body['ClientId']).toBe('test-client-id');

      expect(result.accessToken).toBe('new-access');
      expect(result.idToken).toBe('new-id');
    });
  });

  describe('revokeToken', () => {
    it('sends RevokeToken', async () => {
      const fetchFn = mockFetch({});
      const client = createCognitoPublicClient(CONFIG, fetchFn);
      await client.revokeToken('refresh-tok');

      const [, init] = fetchFn.mock.calls[0]!;
      expect(init.headers['X-Amz-Target']).toBe(
        'AWSCognitoIdentityProviderService.RevokeToken',
      );
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['Token']).toBe('refresh-tok');
    });
  });

  describe('globalSignOut', () => {
    it('sends GlobalSignOut', async () => {
      const fetchFn = mockFetch({});
      const client = createCognitoPublicClient(CONFIG, fetchFn);
      await client.globalSignOut('access-tok');

      const [, init] = fetchFn.mock.calls[0]!;
      expect(init.headers['X-Amz-Target']).toBe(
        'AWSCognitoIdentityProviderService.GlobalSignOut',
      );
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['AccessToken']).toBe('access-tok');
    });
  });

  describe('error with namespaced __type', () => {
    it('extracts exception type after hash', async () => {
      const fetchFn = mockFetch(
        {
          __type: 'com.amazonaws.cognito.identity.idp.model#CodeMismatchException',
          message: 'Invalid code',
        },
        false,
        400,
      );
      const client = createCognitoPublicClient(CONFIG, fetchFn);

      try {
        await client.respondToEmailOtp('s', 'u@e.com', '000000');
      } catch (err) {
        expect((err as CognitoError).code).toBe('invalid_code');
      }
    });
  });
});
