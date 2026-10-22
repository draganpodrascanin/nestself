/**
 * Secure token storage backed by expo-secure-store.
 *
 * Tokens are stored with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so they
 * are not included in backups and require the device to be unlocked.
 *
 * The "sensitive" token is stored with `requireAuthentication: true`
 * (biometric / passcode). If reading it throws, the caller should
 * treat the tokens as expired and request a fresh sign-in (CLIENT-R-21).
 *
 * @see auth-strategy.md 3.6.3, CLIENT-R-21
 */

import * as SecureStore from 'expo-secure-store';

// ---------------------------------------------------------------------------
// Key constants
// ---------------------------------------------------------------------------

const KEY_ACCESS_TOKEN = 'nestself_access_token';
const KEY_ID_TOKEN = 'nestself_id_token';
const KEY_REFRESH_TOKEN = 'nestself_refresh_token';
const KEY_TOKEN_FAMILY = 'nestself_token_family';
const KEY_LAST_API_CALL_AT = 'nestself_last_api_call_at';
const KEY_SENSITIVE_TOKEN = 'nestself_sensitive_token';

const BASE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const SENSITIVE_OPTIONS: SecureStore.SecureStoreOptions = {
  ...BASE_OPTIONS,
  requireAuthentication: true,
};

// ---------------------------------------------------------------------------
// Stored token set
// ---------------------------------------------------------------------------

export interface StoredTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  tokenFamily: string | null;
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

export async function storeTokens(tokens: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(KEY_ACCESS_TOKEN, tokens.accessToken, BASE_OPTIONS);
  await SecureStore.setItemAsync(KEY_ID_TOKEN, tokens.idToken, BASE_OPTIONS);
  await SecureStore.setItemAsync(KEY_REFRESH_TOKEN, tokens.refreshToken, BASE_OPTIONS);
  if (tokens.tokenFamily) {
    await SecureStore.setItemAsync(KEY_TOKEN_FAMILY, tokens.tokenFamily, BASE_OPTIONS);
  }
  // Also store the access token as the sensitive token
  await SecureStore.setItemAsync(KEY_SENSITIVE_TOKEN, tokens.accessToken, SENSITIVE_OPTIONS);
}

export async function updateAccessToken(
  accessToken: string,
  idToken: string,
  tokenFamily: string | null,
): Promise<void> {
  await SecureStore.setItemAsync(KEY_ACCESS_TOKEN, accessToken, BASE_OPTIONS);
  await SecureStore.setItemAsync(KEY_ID_TOKEN, idToken, BASE_OPTIONS);
  if (tokenFamily) {
    await SecureStore.setItemAsync(KEY_TOKEN_FAMILY, tokenFamily, BASE_OPTIONS);
  }
  await SecureStore.setItemAsync(KEY_SENSITIVE_TOKEN, accessToken, SENSITIVE_OPTIONS);
}

export async function setLastApiCallAt(timestamp: number): Promise<void> {
  await SecureStore.setItemAsync(
    KEY_LAST_API_CALL_AT,
    String(timestamp),
    BASE_OPTIONS,
  );
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_ACCESS_TOKEN, BASE_OPTIONS);
}

export async function getIdToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_ID_TOKEN, BASE_OPTIONS);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_REFRESH_TOKEN, BASE_OPTIONS);
}

export async function getTokenFamily(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_TOKEN_FAMILY, BASE_OPTIONS);
}

export async function getLastApiCallAt(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(KEY_LAST_API_CALL_AT, BASE_OPTIONS);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the sensitive token (requires biometric / passcode).
 * Throws if the user cancels or authentication fails.
 */
export async function getSensitiveToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_SENSITIVE_TOKEN, SENSITIVE_OPTIONS);
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS_TOKEN, BASE_OPTIONS),
    SecureStore.deleteItemAsync(KEY_ID_TOKEN, BASE_OPTIONS),
    SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN, BASE_OPTIONS),
    SecureStore.deleteItemAsync(KEY_TOKEN_FAMILY, BASE_OPTIONS),
    SecureStore.deleteItemAsync(KEY_LAST_API_CALL_AT, BASE_OPTIONS),
    SecureStore.deleteItemAsync(KEY_SENSITIVE_TOKEN, SENSITIVE_OPTIONS),
  ]);
}
