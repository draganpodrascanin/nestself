import { describe, it, expect, afterEach, vi } from 'vitest';
import { Logger, type ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ThrottledRedirect } from './api-error.js';

const SIGN_IN = 'https://app.nestself.example/sign-in?reason=sso_rate_limited';

function fakeResponse() {
  const headers: Record<string, string> = {};
  const res = {
    headersSent: false,
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
    },
    end() {
      res.ended = true;
    },
  };
  return { res, headers };
}

function hostFor(req: object, res: object): ArgumentsHost {
  return { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ArgumentsHost;
}

const callbackRequest = () => ({
  id: 'req-1',
  headers: {},
  originalUrl: '/api/auth/sso/callback?code=secret-code&state=secret-state',
});

describe('ApiExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a ThrottledRedirect with a bodyless 302 to its location', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { res, headers } = fakeResponse();
    new ApiExceptionFilter().catch(new ThrottledRedirect(SIGN_IN), hostFor(callbackRequest(), res));
    expect(res.statusCode).toBe(302);
    expect(headers).toMatchObject({
      location: SIGN_IN,
      'cache-control': 'no-store',
      'retry-after': '60',
      'x-request-id': 'req-1',
    });
    expect(res.body).toBeUndefined();
    expect(res.ended).toBe(true);
  });

  it('logs the throttled route at warn level, never its query', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { res } = fakeResponse();
    new ApiExceptionFilter().catch(new ThrottledRedirect(SIGN_IN), hostFor(callbackRequest(), res));
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('/api/auth/sso/callback');
    expect(logged).not.toContain('secret-code');
    expect(logged).not.toContain('secret-state');
    expect(error).not.toHaveBeenCalled();
  });

  it('still answers a ThrottlerException with the JSON 429 envelope', () => {
    const { res, headers } = fakeResponse();
    new ApiExceptionFilter().catch(new ThrottlerException(), hostFor({ headers: {} }, res));
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ status: 429, code: 'rate_limited', details: { retryAfter: 60 } });
    expect(headers['retry-after']).toBe('60');
    expect(headers.location).toBeUndefined();
  });
});
