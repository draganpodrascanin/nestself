/**
 * RFC 6238 TOTP and RFC 4226 HOTP implementation.
 *
 * Used by the FakeIdentityProvider for local development
 * and tests without AWS. HMAC-SHA1, 30-second step, 6 digits.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Base32
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode a Buffer to base32 (RFC 4648). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = '';

  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

/** Decode a base32 string to a Buffer (RFC 4648). */
export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]!);
    if (idx === -1) throw new Error(`Invalid base32 character: ${cleaned[i]}`);
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

/**
 * Compute a 6-digit HOTP code.
 *
 * @param secret  Raw secret bytes.
 * @param counter 8-byte big-endian counter.
 */
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
 * Compute the TOTP code for a given time.
 *
 * @param secret  Base32-encoded secret.
 * @param timeMs  Unix time in milliseconds (defaults to now).
 */
export function computeTotp(secret: string, timeMs?: number): string {
  const key = base32Decode(secret);
  const time = timeMs ?? Date.now();
  const counter = BigInt(Math.floor(time / 1000 / STEP_SECONDS));
  return hotp(key, counter);
}

/**
 * Verify a TOTP code against the secret with a configurable window.
 *
 * @param secret Base32-encoded secret.
 * @param code   The 6-digit code to verify.
 * @param window Number of steps in each direction to accept (default 1).
 * @param timeMs Unix time in milliseconds (defaults to now).
 * @returns `true` if the code matches within the window.
 */
export function verifyTotp(
  secret: string,
  code: string,
  window = 1,
  timeMs?: number,
): boolean {
  const key = base32Decode(secret);
  const time = timeMs ?? Date.now();
  const counter = BigInt(Math.floor(time / 1000 / STEP_SECONDS));

  // Check every slot and compare in constant time so neither the matching
  // slot nor the matching prefix is observable through timing.
  let matched = false;
  for (let i = -window; i <= window; i++) {
    const expected = hotp(key, counter + BigInt(i));
    if (codesEqual(expected, code)) matched = true;
  }
  return matched;
}

/** Constant-time equality for short numeric codes. */
export function codesEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Generate a random 20-byte TOTP secret, base32-encoded.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}
