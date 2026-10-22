import { describe, it, expect } from 'vitest';
import { type ConfigService } from '@nestjs/config';
import { SessionCookies } from './session-cookie.js';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

describe('SessionCookies', () => {
  describe('production mode', () => {
    const cookies = new SessionCookies(
      makeConfig({ NODE_ENV: 'production' }),
    );

    it('uses __Host- prefixed names by default', () => {
      expect(cookies.sessionName).toBe('__Host-nestself_session');
      expect(cookies.csrfName).toBe('__Host-nestself_csrf');
    });

    it('serializeSession includes Secure, HttpOnly, SameSite=Lax, Path=/', () => {
      const expires = new Date(Date.now() + 3600_000);
      const header = cookies.serializeSession('sid123', expires);
      expect(header).toContain('__Host-nestself_session=sid123');
      expect(header).toContain('Secure');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Path=/');
      expect(header).toMatch(/Max-Age=\d+/);
    });

    it('serializeCsrf does NOT include HttpOnly (readable by JS)', () => {
      const expires = new Date(Date.now() + 3600_000);
      const header = cookies.serializeCsrf('csrf-tok', expires);
      expect(header).toContain('__Host-nestself_csrf=csrf-tok');
      expect(header).toContain('Secure');
      expect(header).not.toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Path=/');
    });

    it('parse extracts session and csrf from Cookie header', () => {
      const { sessionId, csrfToken } = cookies.parse({
        cookie:
          '__Host-nestself_session=abc123; __Host-nestself_csrf=def456; other=val',
      });
      expect(sessionId).toBe('abc123');
      expect(csrfToken).toBe('def456');
    });

    it('parse returns null when Cookie header is missing', () => {
      const { sessionId, csrfToken } = cookies.parse({});
      expect(sessionId).toBeNull();
      expect(csrfToken).toBeNull();
    });

    it('clear returns two expired Set-Cookie strings', () => {
      const headers = cookies.clear();
      expect(headers).toHaveLength(2);
      for (const h of headers) {
        expect(h).toContain('Max-Age=0');
      }
    });
  });

  describe('insecure dev mode', () => {
    const cookies = new SessionCookies(
      makeConfig({
        NODE_ENV: 'development',
        SESSION_COOKIE_INSECURE_DEV: 'true',
      }),
    );

    it('strips __Host- prefix and drops Secure', () => {
      expect(cookies.sessionName).toBe('nestself_session');
      expect(cookies.csrfName).toBe('nestself_csrf');

      const expires = new Date(Date.now() + 3600_000);
      const header = cookies.serializeSession('sid', expires);
      expect(header).toContain('nestself_session=sid');
      expect(header).not.toContain('Secure');
    });

    it('parse uses the unprefixed names', () => {
      const { sessionId, csrfToken } = cookies.parse({
        cookie: 'nestself_session=abc; nestself_csrf=def',
      });
      expect(sessionId).toBe('abc');
      expect(csrfToken).toBe('def');
    });
  });

  describe('custom cookie names', () => {
    const cookies = new SessionCookies(
      makeConfig({
        NODE_ENV: 'production',
        SESSION_COOKIE_NAME: 'my_session',
        CSRF_COOKIE_NAME: 'my_csrf',
      }),
    );

    it('uses the custom names', () => {
      expect(cookies.sessionName).toBe('my_session');
      expect(cookies.csrfName).toBe('my_csrf');
    });
  });
});
