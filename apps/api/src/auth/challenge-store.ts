/**
 * ChallengeStore — stores and retrieves single-use challenge records in Redis.
 *
 * challengeToken = 32 random bytes base64url
 * Stored at `challenge:{sha256(token)}` with 5 min TTL.
 *
 * @see API-R-02, API-R-03, API-R-05
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import { challengeKey, CHALLENGE_TTL } from '../redis/redis-keys.js';

export interface ChallengeRecord {
  kind: 'email_otp' | 'password' | 'totp' | 'new_password' | 'totp_enrol';
  username: string;
  email: string;
  session: string;
  surface?: string;
  dummy?: boolean;
}

@Injectable()
export class ChallengeStore {
  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  /** Create a new challenge token and store the record. */
  async create(record: ChallengeRecord): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await this.store.set(
      challengeKey(hash),
      JSON.stringify(record),
      { ttlSeconds: CHALLENGE_TTL },
    );
    return token;
  }

  /**
   * Consume a challenge (single-use via GETDEL).
   * Returns null if expired or already consumed.
   */
  async consume(token: string): Promise<ChallengeRecord | null> {
    const hash = createHash('sha256').update(token).digest('hex');
    const raw = await this.store.getDel(challengeKey(hash));
    if (!raw) return null;
    return JSON.parse(raw) as ChallengeRecord;
  }

  /** Delete a challenge record explicitly. */
  async remove(token: string): Promise<void> {
    const hash = createHash('sha256').update(token).digest('hex');
    await this.store.del(challengeKey(hash));
  }
}
