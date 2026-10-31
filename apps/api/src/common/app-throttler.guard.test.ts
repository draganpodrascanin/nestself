import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Throttle, ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard.js';
import { RedirectOnThrottle } from './redirect-on-throttle.decorator.js';
import { ThrottledRedirect } from './api-error.js';

const ONE_A_MINUTE = { default: { limit: 1, ttl: 60_000 } };

class SignInRoutes {
  @RedirectOnThrottle()
  @Throttle(ONE_A_MINUTE)
  browserRoute() {}

  @Throttle(ONE_A_MINUTE)
  jsonRoute() {}
}

@RedirectOnThrottle()
class BrowserController {
  @Throttle(ONE_A_MINUTE)
  anyRoute() {}
}

function contextFor(controller: new () => object, handler: string): ExecutionContext {
  const req = { ip: '198.51.100.7', headers: {} };
  const res = { header: vi.fn() };
  return {
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[handler],
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

describe('AppThrottlerGuard', () => {
  const storages: ThrottlerStorageService[] = [];

  afterEach(() => {
    for (const storage of storages.splice(0)) storage.onApplicationShutdown();
  });

  async function guardWith(env: Record<string, string | undefined>): Promise<AppThrottlerGuard> {
    const storage = new ThrottlerStorageService();
    storages.push(storage);
    const guard = new AppThrottlerGuard(
      { throttlers: [{ ttl: 60_000, limit: 60 }] },
      storage,
      new Reflector(),
      { get: (key: string) => env[key] } as never,
    );
    await guard.onModuleInit();
    return guard;
  }

  async function refusal(guard: AppThrottlerGuard, context: ExecutionContext): Promise<unknown> {
    await expect(guard.canActivate(context)).resolves.toBe(true);
    return guard.canActivate(context).then(
      () => 'not refused',
      (err: unknown) => err,
    );
  }

  it('sends a throttled @RedirectOnThrottle() route to the workspace sign-in page', async () => {
    const guard = await guardWith({ WORKSPACE_URL: 'https://app.nestself.example/', ADMIN_URL: 'https://admin.nestself.example' });
    const err = await refusal(guard, contextFor(SignInRoutes, 'browserRoute'));
    expect(err).toBeInstanceOf(ThrottledRedirect);
    expect((err as ThrottledRedirect).location).toBe('https://app.nestself.example/sign-in?reason=sso_rate_limited');
  });

  it('uses the stub workspace URL when WORKSPACE_URL is unset', async () => {
    const guard = await guardWith({});
    const err = await refusal(guard, contextFor(SignInRoutes, 'browserRoute'));
    expect((err as ThrottledRedirect).location).toBe('http://localhost:5173/sign-in?reason=sso_rate_limited');
  });

  it('honours the marker on the controller class', async () => {
    const guard = await guardWith({});
    expect(await refusal(guard, contextFor(BrowserController, 'anyRoute'))).toBeInstanceOf(ThrottledRedirect);
  });

  it('keeps the ThrottlerException (JSON 429) on every other route', async () => {
    const guard = await guardWith({});
    const err = await refusal(guard, contextFor(SignInRoutes, 'jsonRoute'));
    expect(err).toBeInstanceOf(ThrottlerException);
    expect(err).not.toBeInstanceOf(ThrottledRedirect);
  });
});
