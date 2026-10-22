import { describe, it, expect } from 'vitest';
import {
  base32Encode,
  base32Decode,
  computeTotp,
  verifyTotp,
  generateTotpSecret,
} from './totp.js';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x42]);
    const encoded = base32Encode(buf);
    const decoded = base32Decode(encoded);
    expect(decoded.equals(buf)).toBe(true);
  });

  it('encodes "Hello!" correctly', () => {
    // "Hello!" = 48 65 6C 6C 6F 21 -> JBSWY3DPEE
    const encoded = base32Encode(Buffer.from('Hello!'));
    expect(encoded).toBe('JBSWY3DPEE');
  });
});

describe('TOTP', () => {
  // RFC 6238 Appendix B test vector adapted to a base32-encoded SHA1 key.
  // The RFC uses the ASCII string "12345678901234567890" as the secret.
  const SECRET_ASCII = '12345678901234567890';
  const SECRET_B32 = base32Encode(Buffer.from(SECRET_ASCII));

  it('generates a known code for t=59 (counter=1)', () => {
    // RFC 6238 Table 1: SHA1, T0=0, X=30, time=59 -> TOTP = 287082
    const code = computeTotp(SECRET_B32, 59_000);
    expect(code).toBe('287082');
  });

  it('generates a known code for t=1111111109 (counter=37037036)', () => {
    // RFC 6238 Table 1: SHA1, time=1111111109 -> TOTP = 081804
    const code = computeTotp(SECRET_B32, 1_111_111_109_000);
    expect(code).toBe('081804');
  });

  it('verifyTotp accepts the correct code within window', () => {
    const code = computeTotp(SECRET_B32, 59_000);
    expect(verifyTotp(SECRET_B32, code, 1, 59_000)).toBe(true);
  });

  it('verifyTotp accepts codes from adjacent time steps', () => {
    // Code for counter=1 should be accepted at counter=2 with window=1
    const code = computeTotp(SECRET_B32, 59_000); // counter=1
    expect(verifyTotp(SECRET_B32, code, 1, 89_000)).toBe(true); // counter=2, window=1
  });

  it('verifyTotp rejects codes outside the window', () => {
    const code = computeTotp(SECRET_B32, 59_000); // counter=1
    // At counter=4 with window=1 (accepts 3,4,5), counter=1 is out
    expect(verifyTotp(SECRET_B32, code, 1, 120_000 + 1000)).toBe(false);
  });

  it('generateTotpSecret returns a valid base32 string', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const decoded = base32Decode(secret);
    expect(decoded.length).toBe(20);
  });
});
