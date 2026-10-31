/**
 * StepUpThrottle: wrong step-up codes per user, both kinds (Cognito and
 * NestSelf-issued) together. Five failures within 15 minutes of the first one
 * lock the user's step-up until that window ends; a completed step-up clears
 * the count. Same shape as `SignInThrottle`, keyed by user id instead of
 * address, and in addition to the three tries each challenge allows.
 *
 * @see docs/superpowers/specs/2026-10-30-auth-phase-4-pilot-readiness-design.md section 5.4
 */
import { Inject, Injectable } from '@nestjs/common';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { throttleKey } from '../redis/redis-keys.js';

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;

@Injectable()
export class StepUpThrottle {
  constructor(@Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore) {}

  /** Counts one wrong code; the window starts with the first failure and is never extended. */
  async recordFailure(userId: string): Promise<void> {
    await this.store.incr(throttleKey('step_up', userId), WINDOW_SECONDS);
  }

  async isLocked(userId: string): Promise<boolean> {
    const raw = await this.store.get(throttleKey('step_up', userId));
    return raw !== null && parseInt(raw, 10) >= MAX_FAILURES;
  }

  async reset(userId: string): Promise<void> {
    await this.store.del(throttleKey('step_up', userId));
  }
}
