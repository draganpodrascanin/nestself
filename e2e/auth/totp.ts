/**
 * Minimal RFC 6238 TOTP implementation for e2e tests.
 *
 * Mirrors the API's `apps/api/src/identity/totp.ts` (HMAC-SHA1, 30-second
 * step, 6 digits, base32 secret). Uses only `node:crypto`; no external deps.
 */
import { createHmac } from 'node:crypto';

// ---------------------------------------------------------------------------
// Base32 (RFC 4648)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode a base32-encoded string to a Buffer. */
export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

// ---------------------------------------------------------------------------
// HOTP (RFC 4226)
// ---------------------------------------------------------------------------

function hotp(secret: Buffer, counter: bigint): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);

  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(code % 1_000_000).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238)
// ---------------------------------------------------------------------------

const STEP_SECONDS = 30;

/**
 * Compute the current TOTP code for a base32-encoded secret.
 *
 * @param secret Base32-encoded secret string.
 * @param timeMs Unix time in milliseconds (defaults to `Date.now()`).
 */
export function computeTotp(secret: string, timeMs?: number): string {
  const key = base32Decode(secret);
  const time = timeMs ?? Date.now();
  const counter = BigInt(Math.floor(time / 1000 / STEP_SECONDS));
  return hotp(key, counter);
}
