import { describe, it, expect } from 'vitest';
import { decodeJwtClaims } from './jwt';

// A real-ish JWT with payload {"sub":"user_1","exp":1729999999,"jti":"abc123","origin_jti":"oj456","token_use":"access","iat":1729996399}
const PAYLOAD = {
  sub: 'user_1',
  exp: 1729999999,
  jti: 'abc123',
  origin_jti: 'oj456',
  token_use: 'access',
  iat: 1729996399,
};
const PAYLOAD_B64 = btoa(JSON.stringify(PAYLOAD))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
const VALID_JWT = `eyJhbGciOiJSUzI1NiJ9.${PAYLOAD_B64}.fake-signature`;

describe('decodeJwtClaims', () => {
  it('decodes a valid JWT payload', () => {
    const claims = decodeJwtClaims(VALID_JWT);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('user_1');
    expect(claims!.exp).toBe(1729999999);
    expect(claims!.jti).toBe('abc123');
    expect(claims!.origin_jti).toBe('oj456');
    expect(claims!.token_use).toBe('access');
  });

  it('returns null for a malformed token (not 3 parts)', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull();
    expect(decodeJwtClaims('one.two')).toBeNull();
    expect(decodeJwtClaims('a.b.c.d')).toBeNull();
  });

  it('returns null for invalid base64 payload', () => {
    expect(decodeJwtClaims('a.!!!invalid!!!.c')).toBeNull();
  });

  it('returns null for non-JSON payload', () => {
    const notJson = btoa('this is not json')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeJwtClaims(`a.${notJson}.c`)).toBeNull();
  });

  it('handles base64url padding correctly', () => {
    // Payload that requires padding
    const short = { a: 1 };
    const b64 = btoa(JSON.stringify(short))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const claims = decodeJwtClaims(`h.${b64}.s`);
    expect(claims).not.toBeNull();
    expect(claims!.a).toBe(1);
  });
});
