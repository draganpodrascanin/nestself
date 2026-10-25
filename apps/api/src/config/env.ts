/**
 * Environment validation schema with AUTH_MODE discrimination.
 *
 * @see T-1.10, D-36, Appendix E.1
 */
import { z } from 'zod';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Reusable field definitions
// ---------------------------------------------------------------------------

/** Coerce empty strings from .env files to undefined before validation. */
const optionalUrl = z.union([
  z.literal('').transform(() => undefined),
  z.string().url(),
]).optional();

const optionalEmail = z.union([
  z.literal('').transform(() => undefined),
  z.string().email(),
]).optional();

const optionalString = z.union([
  z.literal('').transform(() => undefined),
  z.string(),
]).optional();

const hexKey64 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'Must be a 64-character hex string (32 bytes)');

const optionalHexKey64 = z.union([
  z.literal('').transform(() => undefined),
  hexKey64,
]).optional();

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    /** pg Pool size for the API process (D-37). */
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    // Auth mode: stub or cognito (D-36)
    AUTH_MODE: z.enum(['stub', 'cognito']).default('stub'),

    // Legacy stub auth (removed after cutover)
    JWT_SECRET: z.string().min(32).optional(),
    JWT_EXPIRES_IN: z.string().default('1h'),

    // Redis / Valkey
    REDIS_URL: optionalUrl,

    // Cognito
    COGNITO_REGION: optionalString,
    COGNITO_USER_POOL_ID: optionalString,
    COGNITO_WEB_CLIENT_ID: optionalString,
    COGNITO_WEB_CLIENT_SECRET: optionalString,
    COGNITO_MOBILE_CLIENT_ID: optionalString,
    COGNITO_DOMAIN: optionalUrl,
    COGNITO_ISSUER: optionalUrl,

    // Keyed IP hashing for audit and session records (falls back to SESSION_ENCRYPTION_KEY)
    IP_HASH_SALT: optionalString,

    // Session encryption
    SESSION_ENCRYPTION_KEY: optionalHexKey64,
    SESSION_ENCRYPTION_KEY_PREVIOUS: optionalHexKey64,

    // Cookie names
    SESSION_COOKIE_NAME: optionalString,
    CSRF_COOKIE_NAME: optionalString,
    SESSION_COOKIE_INSECURE_DEV: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),

    // Session lifetime overrides (JSON)
    SESSION_LIFETIME_OVERRIDES: optionalString,

    // URLs
    MARKETING_URL: optionalUrl,
    WORKSPACE_URL: optionalUrl,
    ADMIN_URL: optionalUrl,
    API_PUBLIC_URL: optionalUrl,

    // Email
    SES_FROM_EMAIL: optionalEmail,

    // Maintenance jobs (worker process only): IANA timezone for the cron schedules
    JOBS_TIMEZONE: optionalString,

    // Proxy
    TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),

    // Stub mode: every SSO domain verification passes (Playwright); ignored with AUTH_MODE=cognito
    FAKE_DNS_TXT_AUTOVERIFY: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),

    // Fake identity provider
    FAKE_IDP_FIXED_OTP: z.union([
      z.literal('').transform(() => undefined),
      z.string().regex(/^\d{6}$/),
    ]).optional(),
  })
  .superRefine((data, ctx) => {
    // D-36: stub mode is refused in production
    if (data.AUTH_MODE === 'stub' && data.NODE_ENV === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AUTH_MODE=stub is not allowed when NODE_ENV=production',
        path: ['AUTH_MODE'],
      });
    }

    // stub mode requires JWT_SECRET
    if (data.AUTH_MODE === 'stub' && !data.JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'JWT_SECRET is required when AUTH_MODE=stub',
        path: ['JWT_SECRET'],
      });
    }

    // cognito mode requires these variables
    if (data.AUTH_MODE === 'cognito') {
      const required: Array<[keyof typeof data, string]> = [
        ['REDIS_URL', 'REDIS_URL is required when AUTH_MODE=cognito'],
        ['COGNITO_REGION', 'COGNITO_REGION is required when AUTH_MODE=cognito'],
        [
          'COGNITO_USER_POOL_ID',
          'COGNITO_USER_POOL_ID is required when AUTH_MODE=cognito',
        ],
        [
          'COGNITO_WEB_CLIENT_ID',
          'COGNITO_WEB_CLIENT_ID is required when AUTH_MODE=cognito',
        ],
        [
          'COGNITO_WEB_CLIENT_SECRET',
          'COGNITO_WEB_CLIENT_SECRET is required when AUTH_MODE=cognito',
        ],
        [
          'COGNITO_MOBILE_CLIENT_ID',
          'COGNITO_MOBILE_CLIENT_ID is required when AUTH_MODE=cognito',
        ],
        [
          'COGNITO_DOMAIN',
          'COGNITO_DOMAIN is required when AUTH_MODE=cognito',
        ],
        [
          'SESSION_ENCRYPTION_KEY',
          'SESSION_ENCRYPTION_KEY is required when AUTH_MODE=cognito',
        ],
        // The SSO start URL, the callback registered on the Cognito client and
        // the post-sign-in redirects are built from these; the localhost
        // fallbacks only suit stub mode.
        ['WORKSPACE_URL', 'WORKSPACE_URL is required when AUTH_MODE=cognito'],
        ['ADMIN_URL', 'ADMIN_URL is required when AUTH_MODE=cognito'],
        ['API_PUBLIC_URL', 'API_PUBLIC_URL is required when AUTH_MODE=cognito'],
      ];

      for (const [key, message] of required) {
        if (!data[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message,
            path: [key],
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Typed environment accessor. Prefer this over raw `config.get<string>()`.
 *
 * In stub mode, when `SESSION_ENCRYPTION_KEY` is absent, a deterministic
 * dev key is derived from `JWT_SECRET` with a logged warning.
 */
export type AppEnv = Env & {
  /** Resolved (possibly derived) session encryption key. */
  resolvedSessionEncryptionKey: string | undefined;
  /** Derived Cognito issuer URL. */
  resolvedCognitoIssuer: string | undefined;
};

export function resolveAppEnv(env: Env): AppEnv {
  let resolvedSessionEncryptionKey = env.SESSION_ENCRYPTION_KEY;

  // In stub mode, derive a deterministic dev key from JWT_SECRET
  if (!resolvedSessionEncryptionKey && env.AUTH_MODE === 'stub' && env.JWT_SECRET) {
    resolvedSessionEncryptionKey = createHash('sha256')
      .update(env.JWT_SECRET)
      .digest('hex');
     
    console.warn(
      '[env] SESSION_ENCRYPTION_KEY not set; deriving a deterministic dev key from JWT_SECRET. Do NOT use this in production.',
    );
  }

  const resolvedCognitoIssuer =
    env.COGNITO_ISSUER ??
    (env.COGNITO_REGION && env.COGNITO_USER_POOL_ID
      ? `https://cognito-idp.${env.COGNITO_REGION}.amazonaws.com/${env.COGNITO_USER_POOL_ID}`
      : undefined);

  return {
    ...env,
    resolvedSessionEncryptionKey,
    resolvedCognitoIssuer,
  };
}

/**
 * Validation function for NestJS ConfigModule.
 * Returns the raw env object (NestJS expects `Record<string, unknown>`).
 *
 * `envSchema` is a plain `z.object`, so Zod strips every key it does not
 * declare. ConfigModule assigns whatever this function returns back onto
 * `process.env`, and its `validate:` branch - unlike its `validationSchema:`
 * branch - does not merge the stripped keys back in. Returning only the
 * parsed object therefore drops ambient variables that are read straight from
 * `process.env` by libraries rather than through ConfigService, most notably
 * the AWS SDK credential chain (`AWS_PROFILE`, `AWS_ACCESS_KEY_ID`,
 * `AWS_SESSION_TOKEN`). Without them the Cognito admin calls silently fall
 * back to the machine's default profile and fail with a cross-account IAM
 * error. Spreading `config` first keeps those available while the validated
 * and coerced values still win for every declared key.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = envSchema.parse(config);
  const appEnv = resolveAppEnv(parsed);
  return { ...config, ...(appEnv as unknown as Record<string, unknown>) };
}
