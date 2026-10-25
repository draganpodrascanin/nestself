/**
 * Environment schema validation tests.
 *
 * @see T-1.10
 */
import { describe, it, expect } from 'vitest';
import { envSchema, resolveAppEnv } from './env.js';

const baseEnv = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a-secret-that-is-at-least-thirty-two-characters-long',
  AUTH_MODE: 'stub',
};

const cognitoEnv = {
  ...baseEnv,
  AUTH_MODE: 'cognito',
  REDIS_URL: 'redis://localhost:6379',
  COGNITO_REGION: 'eu-central-1',
  COGNITO_USER_POOL_ID: 'eu-central-1_EXAMPLE',
  COGNITO_WEB_CLIENT_ID: 'web-client-id',
  COGNITO_WEB_CLIENT_SECRET: 'web-client-secret',
  COGNITO_MOBILE_CLIENT_ID: 'mobile-client-id',
  COGNITO_DOMAIN: 'https://auth.example.com',
  SESSION_ENCRYPTION_KEY:
    '50ae5236f4be6a75e1e42b53edb562f16c001b4db854f252dbb2e6b91e9a2309',
  WORKSPACE_URL: 'https://app.example.com',
  ADMIN_URL: 'https://admin.example.com',
  API_PUBLIC_URL: 'https://api.example.com',
};

describe('envSchema', () => {
  it('accepts a valid stub-mode configuration', () => {
    const result = envSchema.safeParse(baseEnv);
    expect(result.success).toBe(true);
  });

  it('accepts a valid cognito-mode configuration', () => {
    const result = envSchema.safeParse(cognitoEnv);
    expect(result.success).toBe(true);
  });

  it('rejects AUTH_MODE=stub in production', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      NODE_ENV: 'production',
      AUTH_MODE: 'stub',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'AUTH_MODE=stub is not allowed when NODE_ENV=production',
      );
    }
  });

  it('rejects AUTH_MODE=cognito without REDIS_URL', () => {
    const { REDIS_URL: _, ...env } = cognitoEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'REDIS_URL is required when AUTH_MODE=cognito',
      );
    }
  });

  it('rejects AUTH_MODE=cognito without SESSION_ENCRYPTION_KEY', () => {
    const { SESSION_ENCRYPTION_KEY: _, ...env } = cognitoEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'SESSION_ENCRYPTION_KEY is required when AUTH_MODE=cognito',
      );
    }
  });

  it('rejects AUTH_MODE=cognito without COGNITO_WEB_CLIENT_ID', () => {
    const { COGNITO_WEB_CLIENT_ID: _, ...env } = cognitoEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('rejects AUTH_MODE=cognito without COGNITO_DOMAIN', () => {
    const { COGNITO_DOMAIN: _, ...env } = cognitoEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        'COGNITO_DOMAIN is required when AUTH_MODE=cognito',
      );
    }
  });

  it.each(['WORKSPACE_URL', 'ADMIN_URL', 'API_PUBLIC_URL'] as const)(
    'rejects AUTH_MODE=cognito without %s (SSO redirects and start URLs are built from it)',
    (key) => {
      const { [key]: _, ...env } = cognitoEnv;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message)).toContain(`${key} is required when AUTH_MODE=cognito`);
        expect(result.error.issues.find((i) => i.message.startsWith(key))?.path).toEqual([key]);
      }
    },
  );

  it('keeps WORKSPACE_URL, ADMIN_URL and API_PUBLIC_URL optional in stub mode', () => {
    const result = envSchema.safeParse(baseEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.WORKSPACE_URL).toBeUndefined();
      expect(result.data.API_PUBLIC_URL).toBeUndefined();
    }
  });

  it('accepts AUTH_MODE=stub without REDIS_URL', () => {
    // baseEnv doesn't have REDIS_URL, so this should succeed
    const result = envSchema.safeParse(baseEnv);
    expect(result.success).toBe(true);
  });

  it('rejects AUTH_MODE=stub without JWT_SECRET', () => {
    const { JWT_SECRET: _, ...env } = baseEnv;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid SESSION_ENCRYPTION_KEY format', () => {
    const result = envSchema.safeParse({
      ...cognitoEnv,
      SESSION_ENCRYPTION_KEY: 'too-short',
    });
    expect(result.success).toBe(false);
  });

  it('coerces TRUST_PROXY_HOPS to a number', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      TRUST_PROXY_HOPS: '2',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TRUST_PROXY_HOPS).toBe(2);
    }
  });

  it('validates FAKE_IDP_FIXED_OTP as exactly 6 digits', () => {
    expect(
      envSchema.safeParse({ ...baseEnv, FAKE_IDP_FIXED_OTP: '123456' }).success,
    ).toBe(true);
    expect(
      envSchema.safeParse({ ...baseEnv, FAKE_IDP_FIXED_OTP: '12345' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...baseEnv, FAKE_IDP_FIXED_OTP: 'abcdef' }).success,
    ).toBe(false);
  });
});

describe('resolveAppEnv', () => {
  it('derives SESSION_ENCRYPTION_KEY from JWT_SECRET in stub mode', () => {
    const parsed = envSchema.parse(baseEnv);
    const appEnv = resolveAppEnv(parsed);
    expect(appEnv.resolvedSessionEncryptionKey).toBeDefined();
    expect(appEnv.resolvedSessionEncryptionKey).toHaveLength(64);
  });

  it('derives COGNITO_ISSUER from region and pool id', () => {
    const parsed = envSchema.parse(cognitoEnv);
    const appEnv = resolveAppEnv(parsed);
    expect(appEnv.resolvedCognitoIssuer).toBe(
      'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_EXAMPLE',
    );
  });

  it('uses explicit COGNITO_ISSUER when provided', () => {
    const parsed = envSchema.parse({
      ...cognitoEnv,
      COGNITO_ISSUER: 'https://custom-issuer.example.com',
    });
    const appEnv = resolveAppEnv(parsed);
    expect(appEnv.resolvedCognitoIssuer).toBe(
      'https://custom-issuer.example.com',
    );
  });
});
