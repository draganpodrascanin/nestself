import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock expo-secure-store before importing the module under test
// ---------------------------------------------------------------------------

const store: Map<string, string> = new Map();

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => {
    return store.get(key) ?? null;
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

import {
  storeTokens,
  getAccessToken,
  getIdToken,
  getRefreshToken,
  getTokenFamily,
  getLastApiCallAt,
  setLastApiCallAt,
  clearTokens,
  updateAccessToken,
} from './token-store';

beforeEach(() => {
  store.clear();
});

describe('token-store', () => {
  const tokens = {
    accessToken: 'at-123',
    idToken: 'id-456',
    refreshToken: 'rt-789',
    tokenFamily: 'fam-001',
  };

  it('stores and retrieves tokens', async () => {
    await storeTokens(tokens);
    expect(await getAccessToken()).toBe('at-123');
    expect(await getIdToken()).toBe('id-456');
    expect(await getRefreshToken()).toBe('rt-789');
    expect(await getTokenFamily()).toBe('fam-001');
  });

  it('stores and retrieves lastApiCallAt', async () => {
    const ts = Date.now();
    await setLastApiCallAt(ts);
    expect(await getLastApiCallAt()).toBe(ts);
  });

  it('returns null for missing lastApiCallAt', async () => {
    expect(await getLastApiCallAt()).toBeNull();
  });

  it('clears all tokens', async () => {
    await storeTokens(tokens);
    await setLastApiCallAt(Date.now());
    await clearTokens();

    expect(await getAccessToken()).toBeNull();
    expect(await getIdToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(await getTokenFamily()).toBeNull();
    expect(await getLastApiCallAt()).toBeNull();
  });

  it('updateAccessToken updates access and id tokens', async () => {
    await storeTokens(tokens);
    await updateAccessToken('new-at', 'new-id', 'new-fam');

    expect(await getAccessToken()).toBe('new-at');
    expect(await getIdToken()).toBe('new-id');
    expect(await getTokenFamily()).toBe('new-fam');
    // Refresh token unchanged
    expect(await getRefreshToken()).toBe('rt-789');
  });

  it('handles null tokenFamily', async () => {
    await storeTokens({ ...tokens, tokenFamily: null });
    expect(await getTokenFamily()).toBeNull();
  });
});
