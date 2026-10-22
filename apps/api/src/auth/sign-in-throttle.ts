import { Inject, Injectable } from '@nestjs/common';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import { throttleKey } from '../redis/redis-keys.js';

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;

@Injectable()
export class SignInThrottle {
  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  async recordFailure(email: string): Promise<void> {
    const key = throttleKey('otp', email);
    const count = await this.store.incr(key);
    if (count === 1) {
      await this.store.expire(key, WINDOW_SECONDS);
    }
  }

  async isLocked(email: string): Promise<boolean> {
    const key = throttleKey('otp', email);
    const raw = await this.store.get(key);
    if (!raw) return false;
    return parseInt(raw, 10) >= MAX_FAILURES;
  }

  async reset(email: string): Promise<void> {
    await this.store.del(throttleKey('otp', email));
  }
}
