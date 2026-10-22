/**
 * Tests for session-policy lifetime resolution and override capping.
 *
 * @see SESS-R-13
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolveLifetimes, resetOverridesCache } from './session-policy.js';

afterEach(() => {
  resetOverridesCache();
});

describe('resolveLifetimes', () => {
  it('returns employee:personal defaults', () => {
    const result = resolveLifetimes('employee', { kind: 'personal' }, false);
    expect(result).toEqual({ idleSeconds: 1_800, absoluteSeconds: 43_200 });
  });

  it('applies remember-device override for employee:personal', () => {
    const result = resolveLifetimes('employee', { kind: 'personal' }, true);
    expect(result.idleSeconds).toBe(2_592_000); // 30 days
  });

  it('does not apply remember-device for non-employee', () => {
    const result = resolveLifetimes('expert', { kind: 'personal' }, true);
    expect(result.idleSeconds).toBe(28_800); // expert default, not 30d
  });

  it('accepts valid overrides JSON', () => {
    const overrides = JSON.stringify({
      'employee:personal': { idleSeconds: 3600, absoluteSeconds: 86400 },
    });
    const result = resolveLifetimes('employee', { kind: 'personal' }, false, overrides);
    expect(result).toEqual({ idleSeconds: 3600, absoluteSeconds: 86400 });
  });

  it('rejects overrides where idleSeconds exceeds 30-day cap', () => {
    const overrides = JSON.stringify({
      'employee:personal': { idleSeconds: 2_592_001, absoluteSeconds: 3_000_000 },
    });
    expect(() =>
      resolveLifetimes('employee', { kind: 'personal' }, false, overrides),
    ).toThrow(/idleSeconds.*exceeds the 30-day cap/);
  });

  it('rejects overrides where absoluteSeconds exceeds 90-day cap', () => {
    const overrides = JSON.stringify({
      'employee:personal': { idleSeconds: 1800, absoluteSeconds: 7_776_001 },
    });
    expect(() =>
      resolveLifetimes('employee', { kind: 'personal' }, false, overrides),
    ).toThrow(/absoluteSeconds.*exceeds the 90-day cap/);
  });

  it('rejects overrides where idle exceeds absolute', () => {
    const overrides = JSON.stringify({
      'employee:personal': { idleSeconds: 7200, absoluteSeconds: 3600 },
    });
    expect(() =>
      resolveLifetimes('employee', { kind: 'personal' }, false, overrides),
    ).toThrow(/idleSeconds.*must not exceed absoluteSeconds/);
  });

  it('returns fallback for unknown population/context', () => {
    const result = resolveLifetimes(
      'unknown' as never,
      { kind: 'unknown' as never },
      false,
    );
    expect(result).toEqual({ idleSeconds: 1_800, absoluteSeconds: 28_800 });
  });
});
