/**
 * ChallengeStore — stores and retrieves challenge records in Redis. Every read
 * consumes the record; an email-code challenge may be handed back with `put`.
 *
 * challengeToken = 32 random bytes base64url
 * Stored at `challenge:{sha256(token)}` with 5 min TTL. A record handed back
 * with `put` keeps the deadline it was created with: a retry never extends it.
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
  /** Set on step-up challenges: only this user may verify it, and sign-in refuses it. */
  stepUp?: { userId: string };
  /** Wrong codes answered on this challenge so far (email OTP retry, §21). */
  attempts?: number;
  /** Epoch ms after which the challenge is dead. Set by `create`, kept by `put`. */
  expiresAt?: number;
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
    const stored: ChallengeRecord = {
      ...record,
      expiresAt: Date.now() + CHALLENGE_TTL * 1000,
    };
    await this.store.set(
      challengeKey(hash),
      JSON.stringify(stored),
      { ttlSeconds: CHALLENGE_TTL },
    );
    return token;
  }

  /**
   * Store a consumed record again under the same token, for the time it had
   * left. `consume` deletes the key, so the deadline comes from the record's
   * `expiresAt`; a record past it is not stored and the token stays dead.
   */
  async put(token: string, record: ChallengeRecord): Promise<void> {
    const deadline = record.expiresAt ?? Date.now() + CHALLENGE_TTL * 1000;
    const ttlSeconds = Math.ceil((deadline - Date.now()) / 1000);
    if (ttlSeconds <= 0) return;
    const hash = createHash('sha256').update(token).digest('hex');
    await this.store.set(
      challengeKey(hash),
      JSON.stringify({ ...record, expiresAt: deadline }),
      { ttlSeconds: Math.min(ttlSeconds, CHALLENGE_TTL) },
    );
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
