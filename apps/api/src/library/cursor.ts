/**
 * Cursor encryption helpers (RTE-R-06: AES-256-GCM encrypted opaque cursors).
 *
 * The cursor payload is encrypted, not merely signed. This prevents enumeration
 * and makes the keyset structure an implementation detail. The GCM auth tag
 * provides authentication in constant time (the symmetric decrypt rejects
 * tampered ciphertexts without a separate comparison step).
 *
 * @internal — exported only for unit testing.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { ApiHttpException } from '../common/api-error.js';

// ---------------------------------------------------------------------------
// Keyset shapes
// ---------------------------------------------------------------------------

export interface ListCursorKeyset { s: string; p: number; id: string }
export interface SavedCursorKeyset { t: string; id: string }

// ---------------------------------------------------------------------------
// Range constants
// ---------------------------------------------------------------------------

/** PostgreSQL int4 range. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/** PostgreSQL timestamp range (very generous). */
const PG_DATE_MIN = new Date('0001-01-01T00:00:00Z');
const PG_DATE_MAX = new Date('9999-12-31T23:59:59Z');

/** UUID / content-id pattern. */
const CURSOR_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

export function encodeCursor(keyset: Record<string, unknown>, key: Buffer): string {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = JSON.stringify(keyset);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64url');
}

export function decodeCursorRaw(raw: string, key: Buffer): Record<string, unknown> {
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64url');
  } catch {
    throw cursorError();
  }
  if (buf.length < GCM_IV_BYTES + GCM_TAG_BYTES + 1) throw cursorError();

  const iv = buf.subarray(0, GCM_IV_BYTES);
  const tag = buf.subarray(buf.length - GCM_TAG_BYTES);
  const ciphertext = buf.subarray(GCM_IV_BYTES, buf.length - GCM_TAG_BYTES);

  let plaintext: string;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = decipher.update(ciphertext) + decipher.final('utf8');
  } catch {
    throw cursorError();
  }

  try {
    const json = JSON.parse(plaintext);
    if (typeof json !== 'object' || json === null) throw 0;
    return json as Record<string, unknown>;
  } catch {
    throw cursorError();
  }
}

// ---------------------------------------------------------------------------
// Typed decoders with range checks
// ---------------------------------------------------------------------------

export function decodeListCursor(raw: string, key: Buffer): ListCursorKeyset {
  const json = decodeCursorRaw(raw, key);
  const { s, p, id } = json as { s: unknown; p: unknown; id: unknown };
  if (typeof s !== 'string' || typeof p !== 'number' || typeof id !== 'string') throw cursorError();

  if (!Number.isSafeInteger(p) || p < INT4_MIN || p > INT4_MAX) throw cursorError();
  const d = new Date(s);
  if (isNaN(d.getTime()) || d < PG_DATE_MIN || d > PG_DATE_MAX) throw cursorError();
  if (!CURSOR_ID_RE.test(id)) throw cursorError();

  return { s, p, id };
}

export function decodeSavedCursor(raw: string, key: Buffer): SavedCursorKeyset {
  const json = decodeCursorRaw(raw, key);
  const { t, id } = json as { t: unknown; id: unknown };
  if (typeof t !== 'string' || typeof id !== 'string') throw cursorError();

  const d = new Date(t);
  if (isNaN(d.getTime()) || d < PG_DATE_MIN || d > PG_DATE_MAX) throw cursorError();
  if (!CURSOR_ID_RE.test(id)) throw cursorError();

  return { t, id };
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

function cursorError(): ApiHttpException {
  return new ApiHttpException({
    status: HttpStatus.BAD_REQUEST,
    code: 'validation',
    message: 'Invalid cursor',
  });
}
