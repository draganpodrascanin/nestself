/**
 * Cookie serialisation and parsing for the BFF session.
 *
 * @see 3.6.2 Cookie attributes, D-06, SESS-R-11
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { parseCookie, stringifySetCookie } from 'cookie';

@Injectable()
export class SessionCookies {
  private readonly logger = new Logger(SessionCookies.name);

  /** Effective session cookie name (may drop __Host- prefix in dev). */
  readonly sessionName: string;
  /** Effective CSRF cookie name. */
  readonly csrfName: string;

  private readonly secure: boolean;
  private warnedInsecure = false;

  constructor(config: ConfigService) {
    const rawSessionName =
      config.get<string>('SESSION_COOKIE_NAME') ?? '__Host-nestself_session';
    const rawCsrfName =
      config.get<string>('CSRF_COOKIE_NAME') ?? '__Host-nestself_csrf';
    const nodeEnv = config.get<string>('NODE_ENV');
    const insecureDev = config.get('SESSION_COOKIE_INSECURE_DEV');

    const isDev = nodeEnv !== 'production';
    // The env schema transforms the string to a boolean, so accept both.
    const useInsecure = isDev && (insecureDev === true || insecureDev === 'true');

    if (useInsecure) {
      this.secure = false;
      this.sessionName = rawSessionName.startsWith('__Host-')
        ? rawSessionName.slice('__Host-'.length)
        : rawSessionName;
      this.csrfName = rawCsrfName.startsWith('__Host-')
        ? rawCsrfName.slice('__Host-'.length)
        : rawCsrfName;
    } else {
      this.secure = true;
      this.sessionName = rawSessionName;
      this.csrfName = rawCsrfName;
    }
  }

  /**
   * Parse the Cookie header and extract session id and CSRF token.
   */
  parse(headers: Record<string, string | undefined>): {
    sessionId: string | null;
    csrfToken: string | null;
  } {
    const raw = headers['cookie'] ?? headers['Cookie'];
    if (!raw) return { sessionId: null, csrfToken: null };
    const cookies = parseCookie(raw);
    return {
      sessionId: cookies[this.sessionName] ?? null,
      csrfToken: cookies[this.csrfName] ?? null,
    };
  }

  /**
   * Serialise the session cookie Set-Cookie header value.
   *
   * @see SESS-R-11
   */
  serializeSession(sessionId: string, absoluteExpiresAt: Date): string {
    this.warnInsecureOnce();
    const maxAge = Math.max(
      0,
      Math.floor((absoluteExpiresAt.getTime() - Date.now()) / 1000),
    );
    return stringifySetCookie({
      name: this.sessionName,
      value: sessionId,
      secure: this.secure,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
  }

  /**
   * Serialise the CSRF double-submit cookie (readable by JavaScript).
   *
   * @see D-06, S-163
   */
  serializeCsrf(token: string, absoluteExpiresAt: Date): string {
    this.warnInsecureOnce();
    const maxAge = Math.max(
      0,
      Math.floor((absoluteExpiresAt.getTime() - Date.now()) / 1000),
    );
    return stringifySetCookie({
      name: this.csrfName,
      value: token,
      secure: this.secure,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
  }

  /**
   * Return Set-Cookie headers that clear both cookies immediately.
   */
  clear(): string[] {
    return [
      stringifySetCookie({
        name: this.sessionName,
        value: '',
        secure: this.secure,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      }),
      stringifySetCookie({
        name: this.csrfName,
        value: '',
        secure: this.secure,
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      }),
    ];
  }

  private warnInsecureOnce(): void {
    if (!this.secure && !this.warnedInsecure) {
      this.warnedInsecure = true;
      this.logger.warn(
        `SESSION_COOKIE_INSECURE_DEV=true: cookies "${this.sessionName}" and ` +
          `"${this.csrfName}" are served without Secure and without the __Host- prefix. ` +
          'This is for local development over HTTP only.',
      );
    }
  }
}
