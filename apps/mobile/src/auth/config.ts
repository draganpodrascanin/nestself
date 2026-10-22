/**
 * Cognito configuration read from Expo public env vars.
 *
 * All values are required in api mode. In sample mode (the default for
 * development) they are unused and may be absent.
 */

export interface CognitoConfig {
  readonly region: string;
  readonly userPoolId: string;
  readonly clientId: string;
  /** Hosted-UI domain, e.g. "https://nestself-dev.auth.eu-central-1.amazoncognito.com" */
  readonly domain: string;
}

let cached: CognitoConfig | null = null;

/**
 * Returns the Cognito config or throws if any env var is missing.
 * The result is cached after the first successful call.
 */
export function getCognitoConfig(): CognitoConfig {
  if (cached) return cached;

  const region = process.env.EXPO_PUBLIC_COGNITO_REGION;
  const userPoolId = process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID;
  const clientId = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID;
  const domain = process.env.EXPO_PUBLIC_COGNITO_DOMAIN;

  if (!region || !userPoolId || !clientId || !domain) {
    const missing = [
      !region && 'EXPO_PUBLIC_COGNITO_REGION',
      !userPoolId && 'EXPO_PUBLIC_COGNITO_USER_POOL_ID',
      !clientId && 'EXPO_PUBLIC_COGNITO_CLIENT_ID',
      !domain && 'EXPO_PUBLIC_COGNITO_DOMAIN',
    ].filter(Boolean);
    throw new Error(
      `Missing Cognito configuration: ${missing.join(', ')}. ` +
        'Set these environment variables or run in sample mode.',
    );
  }

  cached = { region, userPoolId, clientId, domain };
  return cached;
}

/** Reset the cache (for testing). */
export function resetConfigCache(): void {
  cached = null;
}
