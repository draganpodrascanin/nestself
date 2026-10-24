/**
 * assertStepUpFresh: the shared step-up freshness rule (3.6.9, AUTHZ-R-46).
 */
import { describe, it, expect } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { stepUpKey } from '../redis/redis-keys.js';
import { assertStepUpFresh } from './step-up-freshness.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function principal(auth: { time: string | null; lastStepUpAt?: string | null }, tokenFamily?: string): Principal {
  return { userId: 'user_1', auth: { lastStepUpAt: null, ...auth }, tokenFamily } as unknown as Principal;
}

async function failure(promise: Promise<void>): Promise<ApiHttpException | null> {
  return promise.then(
    () => null,
    (e: unknown) => e as ApiHttpException,
  );
}

describe('assertStepUpFresh', () => {
  it('passes a restricted action within 15 minutes of authentication', async () => {
    await expect(
      assertStepUpFresh(principal({ time: ago(14) }), 'records.read.emergency', new MemoryKeyValueStore(), NOW),
    ).resolves.toBeUndefined();
  });

  it('passes when a recent session step-up refreshes an old authentication', async () => {
    await expect(
      assertStepUpFresh(principal({ time: ago(120), lastStepUpAt: ago(2) }), 'records.read.emergency', new MemoryKeyValueStore(), NOW),
    ).resolves.toBeUndefined();
  });

  it('throws 403 step_up_required with the class details when stale', async () => {
    const err = await failure(
      assertStepUpFresh(principal({ time: ago(20) }), 'records.read.emergency', new MemoryKeyValueStore(), NOW),
    );
    expect(err).toBeInstanceOf(ApiHttpException);
    expect(err!.getStatus()).toBe(403);
    expect(err!.code).toBe('step_up_required');
    expect(err!.details).toEqual({ stepUpClass: 'restricted', maxAge: 900, method: 'email_otp' });
  });

  it('ignores actions without a step-up class', async () => {
    await expect(
      assertStepUpFresh(principal({ time: ago(10_000) }), 'audit.read', new MemoryKeyValueStore(), NOW),
    ).resolves.toBeUndefined();
  });

  it("uses the bearer family's step-up record and ignores a malformed one", async () => {
    const store = new MemoryKeyValueStore();
    await store.set(stepUpKey('fam_1'), JSON.stringify({ lastStepUpAt: ago(1) }));
    await expect(
      assertStepUpFresh(principal({ time: ago(60) }, 'fam_1'), 'conversation.read.assigned', store, NOW),
    ).resolves.toBeUndefined();

    await store.set(stepUpKey('fam_2'), 'not json');
    const err = await failure(assertStepUpFresh(principal({ time: ago(60) }, 'fam_2'), 'conversation.read.assigned', store, NOW));
    expect(err?.code).toBe('step_up_required');
  });

  it('treats a principal with no authentication time as stale', async () => {
    const err = await failure(
      assertStepUpFresh(principal({ time: null }), 'access.emergency.approve', new MemoryKeyValueStore(), NOW),
    );
    expect(err?.details).toMatchObject({ stepUpClass: 'emergency', maxAge: 300 });
  });
});
