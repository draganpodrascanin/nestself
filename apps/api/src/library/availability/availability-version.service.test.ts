/**
 * Unit tests for AvailabilityVersionService with MemoryKeyValueStore.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryKeyValueStore } from '../../redis/memory-key-value-store.js';
import { AvailabilityVersionService } from './availability-version.service.js';
import {
  availabilityVersionKey,
  availabilityVersionGlobalKey,
} from '../../redis/redis-keys.js';

describe('AvailabilityVersionService', () => {
  let kv: MemoryKeyValueStore;
  let svc: AvailabilityVersionService;

  beforeEach(() => {
    kv = new MemoryKeyValueStore();
    svc = new AvailabilityVersionService(kv);
  });

  afterEach(async () => {
    await kv.close();
  });

  it('current() returns 0 when no version exists', async () => {
    expect(await svc.current('org_1')).toBe(0);
  });

  it('currentGlobal() returns 0 when no version exists', async () => {
    expect(await svc.currentGlobal()).toBe(0);
  });

  it('bump(orgIds) increments each org version', async () => {
    await svc.bump(['org_a', 'org_b']);
    expect(await svc.current('org_a')).toBe(1);
    expect(await svc.current('org_b')).toBe(1);

    await svc.bump(['org_a']);
    expect(await svc.current('org_a')).toBe(2);
    expect(await svc.current('org_b')).toBe(1);
  });

  it('bump("global") increments the global counter', async () => {
    await svc.bump('global');
    expect(await svc.currentGlobal()).toBe(1);

    await svc.bump('global');
    expect(await svc.currentGlobal()).toBe(2);
  });

  it('bump("global") does not affect per-org versions', async () => {
    await svc.bump('global');
    expect(await svc.current('org_x')).toBe(0);
  });

  it('per-org bump does not affect global version', async () => {
    await svc.bump(['org_x']);
    expect(await svc.currentGlobal()).toBe(0);
  });

  it('uses the correct Redis key patterns', async () => {
    await svc.bump(['org_1']);
    const raw = await kv.get(availabilityVersionKey('org_1'));
    expect(raw).toBe('1');

    await svc.bump('global');
    const rawGlobal = await kv.get(availabilityVersionGlobalKey());
    expect(rawGlobal).toBe('1');
  });
});
