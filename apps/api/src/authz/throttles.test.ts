import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  SESSION_THROTTLE,
  SSO_CALLBACK_THROTTLE,
  SSO_START_THROTTLE,
  clientIp,
  sessionTracker,
  ssoStartTracker,
} from './throttles.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('clientIp', () => {
  it('is req.ip, which Express derives from X-Forwarded-For under trust proxy (TRUST_PROXY_HOPS)', () => {
    expect(clientIp({ ip: '198.51.100.7', socket: { remoteAddress: '10.0.0.5' } })).toBe('198.51.100.7');
  });

  it('falls back to the socket address, then to a fixed bucket', () => {
    expect(clientIp({ socket: { remoteAddress: '10.0.0.5' } })).toBe('10.0.0.5');
    expect(clientIp({})).toBe('unknown');
  });

  it('groups IPv6 addresses by /64 and unmaps IPv4, as the default tracker does', () => {
    expect(clientIp({ ip: '2001:db8:1:2::a' })).toBe(clientIp({ ip: '2001:db8:1:2:ffff::b' }));
    expect(clientIp({ ip: '2001:db8:1:2::a' })).not.toBe(clientIp({ ip: '2001:db8:1:3::a' }));
    expect(clientIp({ ip: '::ffff:198.51.100.7' })).toBe('198.51.100.7');
  });
});

describe('ssoStartTracker', () => {
  const start = (ip: string, connection?: unknown) => ({ ip, query: { connection, surface: 'workspace' } });

  it('is the same for the same IP and connection', () => {
    expect(ssoStartTracker(start('198.51.100.7', 'org-acme-oidc'))).toBe(
      ssoStartTracker(start('198.51.100.7', 'org-acme-oidc')),
    );
    expect(ssoStartTracker(start('198.51.100.7', 'org-acme-oidc'))).toBe('198.51.100.7:org-acme-oidc');
  });

  it('differs between connections and between IPs', () => {
    expect(ssoStartTracker(start('198.51.100.7', 'org-acme-oidc'))).not.toBe(
      ssoStartTracker(start('198.51.100.7', 'org-other-saml')),
    );
    expect(ssoStartTracker(start('198.51.100.7', 'org-acme-oidc'))).not.toBe(
      ssoStartTracker(start('198.51.100.8', 'org-acme-oidc')),
    );
  });

  it('bounds the raw connection value to 32 characters', () => {
    const long = `org-${'x'.repeat(60)}-oidc`;
    expect(ssoStartTracker(start('198.51.100.7', long))).toBe(`198.51.100.7:${long.slice(0, 32)}`);
    expect(ssoStartTracker(start('198.51.100.7', long))).toBe(ssoStartTracker(start('198.51.100.7', `${long}-other`)));
  });

  it('copes with a missing or repeated connection parameter', () => {
    expect(ssoStartTracker({ ip: '198.51.100.7' })).toBe('198.51.100.7:');
    expect(ssoStartTracker(start('198.51.100.7', ['a', 'b']))).toBe('198.51.100.7:a,b');
  });
});

describe('sessionTracker', () => {
  it('is the hash of the session id, whatever the address', () => {
    const session = { sessionId: 'sess-raw-1' };
    expect(sessionTracker({ ip: '198.51.100.7', session })).toBe(sha256('sess-raw-1'));
    expect(sessionTracker({ ip: '198.51.100.8', session })).toBe(sessionTracker({ ip: '198.51.100.7', session }));
  });

  it('wins over the token family and the IP', () => {
    expect(
      sessionTracker({ ip: '198.51.100.7', session: { sessionId: 's1' }, principal: { tokenFamily: 'fam-1' } }),
    ).toBe(sha256('s1'));
  });

  it('falls back to the token family of a bearer, then to the client IP', () => {
    expect(sessionTracker({ ip: '198.51.100.7', principal: { tokenFamily: 'fam-1' } })).toBe(sha256('fam-1'));
    expect(sessionTracker({ ip: '198.51.100.7', principal: { tokenFamily: null } })).toBe(sha256('198.51.100.7'));
  });

  it('never carries the raw session id', () => {
    expect(sessionTracker({ session: { sessionId: 'sess-raw-1' } })).not.toContain('sess-raw-1');
  });
});

describe('route throttles (5.9)', () => {
  it('start: 60 a minute per IP and connection', () => {
    expect(SSO_START_THROTTLE).toEqual({ default: { limit: 60, ttl: 60_000, getTracker: ssoStartTracker } });
  });

  it('callback: 120 a minute per IP (the default tracker)', () => {
    expect(SSO_CALLBACK_THROTTLE).toEqual({ default: { limit: 120, ttl: 60_000 } });
  });

  it('session routes: 10 a minute per session', () => {
    expect(SESSION_THROTTLE).toEqual({ default: { limit: 10, ttl: 60_000, getTracker: sessionTracker } });
  });
});
