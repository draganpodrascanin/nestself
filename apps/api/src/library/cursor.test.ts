/**
 * Unit tests for cursor encode/decode (RTE-R-06, item 7).
 *
 * Calls the real encode/decode functions with a deterministic key,
 * not hand-built objects.
 */
import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursorRaw,
  decodeListCursor,
  decodeSavedCursor,
} from './cursor.js';

const TEST_KEY = Buffer.from(
  'a'.repeat(64), // 32 bytes when decoded from hex
  'hex',
);

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('cursor -- round-trip', () => {
  it('encodeCursor + decodeCursorRaw preserves payload', () => {
    const payload = { s: '2026-10-01T00:00:00Z', p: 42, id: 'res_abc' };
    const token = encodeCursor(payload, TEST_KEY);
    const decoded = decodeCursorRaw(token, TEST_KEY);
    expect(decoded).toEqual(payload);
  });

  it('each call produces a different token (random IV)', () => {
    const payload = { x: 1 };
    const t1 = encodeCursor(payload, TEST_KEY);
    const t2 = encodeCursor(payload, TEST_KEY);
    expect(t1).not.toBe(t2);
    // Both decode to the same payload
    expect(decodeCursorRaw(t1, TEST_KEY)).toEqual(payload);
    expect(decodeCursorRaw(t2, TEST_KEY)).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// Tamper resistance
// ---------------------------------------------------------------------------

describe('cursor -- tamper resistance', () => {
  it('bit-flip in ciphertext throws', () => {
    const token = encodeCursor({ a: 1 }, TEST_KEY);
    const buf = Buffer.from(token, 'base64url');
    const mid = Math.floor(buf.length / 2);
    buf[mid] = buf[mid]! ^ 0xff;
    const tampered = buf.toString('base64url');

    expect(() => decodeCursorRaw(tampered, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('bit-flip in IV throws', () => {
    const token = encodeCursor({ a: 1 }, TEST_KEY);
    const buf = Buffer.from(token, 'base64url');
    buf[0] = buf[0]! ^ 0x01;
    const tampered = buf.toString('base64url');

    expect(() => decodeCursorRaw(tampered, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('bit-flip in auth tag throws', () => {
    const token = encodeCursor({ a: 1 }, TEST_KEY);
    const buf = Buffer.from(token, 'base64url');
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0x01;
    const tampered = buf.toString('base64url');

    expect(() => decodeCursorRaw(tampered, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('truncated token throws', () => {
    const token = encodeCursor({ a: 1 }, TEST_KEY);
    const truncated = Buffer.from(token, 'base64url').subarray(0, 8).toString('base64url');
    expect(() => decodeCursorRaw(truncated, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('random noise throws', () => {
    const noise = randomBytes(64).toString('base64url');
    expect(() => decodeCursorRaw(noise, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('wrong key throws', () => {
    const wrongKey = Buffer.from('b'.repeat(64), 'hex');
    const token = encodeCursor({ a: 1 }, TEST_KEY);
    expect(() => decodeCursorRaw(token, wrongKey)).toThrow('Invalid cursor');
  });

  it('empty string throws', () => {
    expect(() => decodeCursorRaw('', TEST_KEY)).toThrow('Invalid cursor');
  });

  it('non-base64url string throws', () => {
    // Note: Buffer.from with 'base64url' is lenient, but the GCM decrypt will fail
    expect(() => decodeCursorRaw('not valid base64url !!!', TEST_KEY)).toThrow('Invalid cursor');
  });
});

// ---------------------------------------------------------------------------
// decodeListCursor range checks
// ---------------------------------------------------------------------------

describe('cursor -- decodeListCursor', () => {
  it('accepts a valid list keyset', () => {
    const keyset = { s: '2026-10-01T00:00:00Z', p: 100, id: 'res_abc' };
    const token = encodeCursor(keyset, TEST_KEY);
    const decoded = decodeListCursor(token, TEST_KEY);
    expect(decoded).toEqual(keyset);
  });

  it('rejects non-integer priority', () => {
    const token = encodeCursor({ s: '2026-10-01T00:00:00Z', p: 1.5, id: 'res_abc' }, TEST_KEY);
    expect(() => decodeListCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects priority outside int4 range (too large)', () => {
    const token = encodeCursor({ s: '2026-10-01T00:00:00Z', p: 3_000_000_000, id: 'res_abc' }, TEST_KEY);
    expect(() => decodeListCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects priority outside int4 range (too small)', () => {
    const token = encodeCursor({ s: '2026-10-01T00:00:00Z', p: -3_000_000_000, id: 'res_abc' }, TEST_KEY);
    expect(() => decodeListCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects invalid date', () => {
    const token = encodeCursor({ s: 'not-a-date', p: 1, id: 'res_abc' }, TEST_KEY);
    expect(() => decodeListCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects id with forbidden characters', () => {
    const token = encodeCursor({ s: '2026-10-01T00:00:00Z', p: 1, id: 'res abc; DROP TABLE' }, TEST_KEY);
    expect(() => decodeListCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects id that is too long', () => {
    const token = encodeCursor({ s: '2026-10-01T00:00:00Z', p: 1, id: 'x'.repeat(200) }, TEST_KEY);
    expect(() => decodeListCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects missing fields', () => {
    const token = encodeCursor({ s: '2026-10-01T00:00:00Z' }, TEST_KEY);
    expect(() => decodeListCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('accepts negative priority within int4 range', () => {
    const keyset = { s: '2026-10-01T00:00:00Z', p: -1000, id: 'res_abc' };
    const token = encodeCursor(keyset, TEST_KEY);
    expect(decodeListCursor(token, TEST_KEY)).toEqual(keyset);
  });

  it('accepts boundary int4 values', () => {
    const min = { s: '2026-10-01T00:00:00Z', p: -2_147_483_648, id: 'res_min' };
    const max = { s: '2026-10-01T00:00:00Z', p: 2_147_483_647, id: 'res_max' };
    expect(decodeListCursor(encodeCursor(min, TEST_KEY), TEST_KEY)).toEqual(min);
    expect(decodeListCursor(encodeCursor(max, TEST_KEY), TEST_KEY)).toEqual(max);
  });
});

// ---------------------------------------------------------------------------
// decodeSavedCursor range checks
// ---------------------------------------------------------------------------

describe('cursor -- decodeSavedCursor', () => {
  it('accepts a valid saved keyset', () => {
    const keyset = { t: '2026-10-01T00:00:00Z', id: 'saved_abc' };
    const token = encodeCursor(keyset, TEST_KEY);
    expect(decodeSavedCursor(token, TEST_KEY)).toEqual(keyset);
  });

  it('rejects invalid date', () => {
    const token = encodeCursor({ t: 'not-a-date', id: 'saved_abc' }, TEST_KEY);
    expect(() => decodeSavedCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects id with forbidden characters', () => {
    const token = encodeCursor({ t: '2026-10-01T00:00:00Z', id: 'id with spaces' }, TEST_KEY);
    expect(() => decodeSavedCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects missing t field', () => {
    const token = encodeCursor({ id: 'saved_abc' }, TEST_KEY);
    expect(() => decodeSavedCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });

  it('rejects non-string t field', () => {
    const token = encodeCursor({ t: 12345, id: 'saved_abc' }, TEST_KEY);
    expect(() => decodeSavedCursor(token, TEST_KEY)).toThrow('Invalid cursor');
  });
});
