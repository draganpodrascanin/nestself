import { describe, it, expect, beforeEach } from 'vitest';
import { type ConfigService } from '@nestjs/config';
import { TokenCipher } from './token-cipher.js';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

const VALID_KEY =
  'a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1';
const PREV_KEY =
  'f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1';

/** Decode a base64url segment, flip one bit in byte at `byteIndex`, re-encode. */
function flipBit(base64url: string, byteIndex: number): string {
  const buf = Buffer.from(base64url, 'base64url');
  buf[byteIndex % buf.length]! ^= 0x01;
  return buf.toString('base64url');
}

describe('TokenCipher', () => {
  let cipher: TokenCipher;

  beforeEach(() => {
    cipher = new TokenCipher(makeConfig({ SESSION_ENCRYPTION_KEY: VALID_KEY }));
  });

  it('round-trips encrypt and decrypt', () => {
    const plain = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test-token-payload';
    const encrypted = cipher.encrypt(plain);
    expect(encrypted.startsWith('v1.')).toBe(true);
    const { plaintext, usedPreviousKey } = cipher.decrypt(encrypted);
    expect(plaintext).toBe(plain);
    expect(usedPreviousKey).toBe(false);
  });

  it('rejects tampered IV (bit-flip in byte 0)', () => {
    const encrypted = cipher.encrypt('secret data');
    const [prefix, iv, ct, tag] = encrypted.split('.');
    const tampered = `${prefix}.${flipBit(iv!, 0)}.${ct}.${tag}`;
    expect(() => cipher.decrypt(tampered)).toThrow('Decryption failed');
  });

  it('rejects tampered ciphertext (bit-flip in byte 0)', () => {
    const encrypted = cipher.encrypt('secret data');
    const [prefix, iv, ct, tag] = encrypted.split('.');
    const tampered = `${prefix}.${iv}.${flipBit(ct!, 0)}.${tag}`;
    expect(() => cipher.decrypt(tampered)).toThrow('Decryption failed');
  });

  it('rejects tampered auth tag (bit-flip in byte 0)', () => {
    const encrypted = cipher.encrypt('secret data');
    const [prefix, iv, ct, tag] = encrypted.split('.');
    const tampered = `${prefix}.${iv}.${ct}.${flipBit(tag!, 0)}`;
    expect(() => cipher.decrypt(tampered)).toThrow('Decryption failed');
  });

  it('decrypts with the previous key and reports usedPreviousKey', () => {
    const oldCipher = new TokenCipher(
      makeConfig({ SESSION_ENCRYPTION_KEY: PREV_KEY }),
    );
    const encrypted = oldCipher.encrypt('rotated-secret');

    const dualCipher = new TokenCipher(
      makeConfig({
        SESSION_ENCRYPTION_KEY: VALID_KEY,
        SESSION_ENCRYPTION_KEY_PREVIOUS: PREV_KEY,
      }),
    );
    const { plaintext, usedPreviousKey } = dualCipher.decrypt(encrypted);
    expect(plaintext).toBe('rotated-secret');
    expect(usedPreviousKey).toBe(true);
  });

  it('rejects a bad key length at construction', () => {
    expect(
      () => new TokenCipher(makeConfig({ SESSION_ENCRYPTION_KEY: 'tooshort' })),
    ).toThrow('64 hex characters');
  });

  it('derives a dev key from JWT_SECRET when SESSION_ENCRYPTION_KEY absent', () => {
    const devCipher = new TokenCipher(
      makeConfig({ JWT_SECRET: 'local-development-only-secret-that-is-long-enough-32' }),
    );
    const encrypted = devCipher.encrypt('dev-token');
    const { plaintext } = devCipher.decrypt(encrypted);
    expect(plaintext).toBe('dev-token');
  });

  it('rejects invalid format (not four dot-separated segments)', () => {
    expect(() => cipher.decrypt('not-a-valid-format')).toThrow('Invalid ciphertext format');
  });

  it('rejects wrong version prefix', () => {
    const encrypted = cipher.encrypt('data');
    const tampered = 'v2' + encrypted.slice(2);
    expect(() => cipher.decrypt(tampered)).toThrow('Invalid ciphertext format');
  });

  it('rejects auth tag with wrong length', () => {
    const encrypted = cipher.encrypt('data');
    const [prefix, iv, ct] = encrypted.split('.');
    // 8 bytes instead of 16
    const shortTag = Buffer.alloc(8).toString('base64url');
    const tampered = `${prefix}.${iv}.${ct}.${shortTag}`;
    expect(() => cipher.decrypt(tampered)).toThrow('Invalid auth tag length');
  });

  it('rejects three-segment string', () => {
    expect(() => cipher.decrypt('v1.abc.def')).toThrow('Invalid ciphertext format');
  });

  it('rejects five-segment string', () => {
    const encrypted = cipher.encrypt('data');
    expect(() => cipher.decrypt(encrypted + '.extra')).toThrow('Invalid ciphertext format');
  });
});
