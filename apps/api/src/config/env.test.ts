/**
 * Unit tests for env.ts — LIBRARY_CURSOR_KEY validation (Appendix A, RTE-R-06).
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { envSchema, resolveAppEnv } from './env.js';

function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    AUTH_MODE: 'stub',
    JWT_SECRET: randomBytes(32).toString('hex'),
    NODE_ENV: 'test',
    ...overrides,
  };
}

describe('LIBRARY_CURSOR_KEY validation', () => {
  it('accepts a 64-char hex key', () => {
    const hex = randomBytes(32).toString('hex');
    const parsed = envSchema.parse(baseEnv({ LIBRARY_CURSOR_KEY: hex }));
    expect(parsed.LIBRARY_CURSOR_KEY).toBe(hex.toLowerCase());
  });

  it('accepts a base64 key that decodes to 32 bytes', () => {
    const buf = randomBytes(32);
    const b64 = buf.toString('base64');
    const parsed = envSchema.parse(baseEnv({ LIBRARY_CURSOR_KEY: b64 }));
    // The transform converts to hex
    expect(parsed.LIBRARY_CURSOR_KEY).toBe(buf.toString('hex'));
  });

  it('rejects a base64 key that decodes to fewer than 32 bytes', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => envSchema.parse(baseEnv({ LIBRARY_CURSOR_KEY: short }))).toThrow();
  });

  it('rejects a hex key shorter than 64 chars', () => {
    const short = randomBytes(16).toString('hex'); // 32 hex chars = 16 bytes
    expect(() => envSchema.parse(baseEnv({ LIBRARY_CURSOR_KEY: short }))).toThrow();
  });

  it('production refuses to start with a missing key', () => {
    expect(() =>
      envSchema.parse(baseEnv({
        NODE_ENV: 'production',
        AUTH_MODE: 'cognito',
        MEDIA_STORAGE: 's3',
        MEDIA_BUCKET: 'test-bucket',
        MEDIA_KMS_KEY_ARN: 'arn:aws:kms:eu-central-1:123:key/abc',
        REDIS_URL: 'redis://localhost:6379',
        COGNITO_REGION: 'eu-central-1',
        COGNITO_USER_POOL_ID: 'eu-central-1_test',
        COGNITO_WEB_CLIENT_ID: 'webclient',
        COGNITO_WEB_CLIENT_SECRET: 'secret',
        COGNITO_MOBILE_CLIENT_ID: 'mobileclient',
        COGNITO_DOMAIN: 'https://auth.example.com',
        SESSION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        // LIBRARY_CURSOR_KEY intentionally missing
      }),
    )).toThrow(/LIBRARY_CURSOR_KEY/);
  });

  it('production refuses a short key', () => {
    const short = randomBytes(16).toString('hex'); // 32 hex chars -- will be rejected by cursorKeyField
    expect(() =>
      envSchema.parse(baseEnv({
        NODE_ENV: 'production',
        AUTH_MODE: 'cognito',
        MEDIA_STORAGE: 's3',
        MEDIA_BUCKET: 'test-bucket',
        MEDIA_KMS_KEY_ARN: 'arn:aws:kms:eu-central-1:123:key/abc',
        REDIS_URL: 'redis://localhost:6379',
        COGNITO_REGION: 'eu-central-1',
        COGNITO_USER_POOL_ID: 'eu-central-1_test',
        COGNITO_WEB_CLIENT_ID: 'webclient',
        COGNITO_WEB_CLIENT_SECRET: 'secret',
        COGNITO_MOBILE_CLIENT_ID: 'mobileclient',
        COGNITO_DOMAIN: 'https://auth.example.com',
        SESSION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        LIBRARY_CURSOR_KEY: short,
      }),
    )).toThrow();
  });

  it('dev/test derives key from JWT_SECRET when LIBRARY_CURSOR_KEY is absent', () => {
    const parsed = envSchema.parse(baseEnv());
    const appEnv = resolveAppEnv(parsed);
    expect(appEnv.resolvedLibraryCursorKey).toBeTruthy();
    expect(appEnv.resolvedLibraryCursorKey.length).toBe(64); // 32 bytes hex
  });

  it('throws when both LIBRARY_CURSOR_KEY and JWT_SECRET are absent', () => {
    const parsed = envSchema.parse({
      DATABASE_URL: 'postgresql://localhost:5432/test',
      AUTH_MODE: 'stub',
      JWT_SECRET: randomBytes(32).toString('hex'),
      NODE_ENV: 'test',
    });
    // Remove both keys after parse
    const modified = { ...parsed, LIBRARY_CURSOR_KEY: undefined, JWT_SECRET: undefined };
    expect(() => resolveAppEnv(modified as typeof parsed)).toThrow(/LIBRARY_CURSOR_KEY/);
  });
});
