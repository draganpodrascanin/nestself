/**
 * Unit tests for `contextOptions` and `sameContext`.
 *
 * The picker was rewritten to read from the API's `availableContexts` array
 * instead of deriving from `principal.memberships`. These tests verify:
 *
 * 1. An employee with two personal entries gets two options (multi-org switch).
 * 2. An HR admin with personal + organization gets both, correctly keyed.
 * 3. Expert and operations entries are included.
 * 4. `sameContext` matches personal contexts by orgId.
 * 5. `sameContext` handles missing orgId (legacy) gracefully.
 */
import { describe, it, expect } from 'vitest';
import type { AvailableContextEntry } from '@nestself/contracts';
import { contextOptions, sameContext } from './context-options';

describe('contextOptions', () => {
  it('builds two personal options for a multi-org employee', () => {
    const available: AvailableContextEntry[] = [
      { kind: 'personal', orgId: 'org_a', orgName: 'Alpha d.o.o.' },
      { kind: 'personal', orgId: 'org_b', orgName: 'Beta kft.' },
    ];
    const options = contextOptions(available);
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({
      key: 'personal:org_a',
      context: { kind: 'personal', orgId: 'org_a' },
      orgName: 'Alpha d.o.o.',
    });
    expect(options[1]).toEqual({
      key: 'personal:org_b',
      context: { kind: 'personal', orgId: 'org_b' },
      orgName: 'Beta kft.',
    });
  });

  it('builds personal + organization options for an HR admin', () => {
    const available: AvailableContextEntry[] = [
      { kind: 'personal', orgId: 'org_a', orgName: 'Alpha d.o.o.' },
      { kind: 'organization', orgId: 'org_a', orgName: 'Alpha d.o.o.' },
    ];
    const options = contextOptions(available);
    expect(options).toHaveLength(2);
    expect(options[0]!.key).toBe('personal:org_a');
    expect(options[0]!.context).toEqual({ kind: 'personal', orgId: 'org_a' });
    expect(options[1]!.key).toBe('organization:org_a');
    expect(options[1]!.context).toEqual({ kind: 'organization', orgId: 'org_a' });
  });

  it('includes expert and operations entries', () => {
    const available: AvailableContextEntry[] = [
      { kind: 'expert' },
      { kind: 'operations' },
    ];
    const options = contextOptions(available);
    expect(options).toEqual([
      { key: 'expert', context: { kind: 'expert' } },
      { key: 'operations', context: { kind: 'operations' } },
    ]);
  });

  it('returns empty array for no available contexts', () => {
    expect(contextOptions([])).toEqual([]);
  });

  it('uses orgId as fallback when orgName is missing', () => {
    const available: AvailableContextEntry[] = [
      { kind: 'personal', orgId: 'org_x' },
    ];
    const options = contextOptions(available);
    expect(options[0]).toEqual({
      key: 'personal:org_x',
      context: { kind: 'personal', orgId: 'org_x' },
      orgName: 'org_x',
    });
  });
});

describe('sameContext', () => {
  it('matches identical personal contexts with orgId', () => {
    expect(sameContext(
      { kind: 'personal', orgId: 'org_a' },
      { kind: 'personal', orgId: 'org_a' },
    )).toBe(true);
  });

  it('rejects personal contexts with different orgIds', () => {
    expect(sameContext(
      { kind: 'personal', orgId: 'org_a' },
      { kind: 'personal', orgId: 'org_b' },
    )).toBe(false);
  });

  it('matches organization contexts by orgId', () => {
    expect(sameContext(
      { kind: 'organization', orgId: 'org_a' },
      { kind: 'organization', orgId: 'org_a' },
    )).toBe(true);
  });

  it('rejects organization contexts with different orgIds', () => {
    expect(sameContext(
      { kind: 'organization', orgId: 'org_a' },
      { kind: 'organization', orgId: 'org_b' },
    )).toBe(false);
  });

  it('rejects different kinds', () => {
    expect(sameContext(
      { kind: 'personal', orgId: 'org_a' },
      { kind: 'organization', orgId: 'org_a' },
    )).toBe(false);
  });

  it('matches expert with expert', () => {
    expect(sameContext({ kind: 'expert' }, { kind: 'expert' })).toBe(true);
  });

  it('matches operations with operations', () => {
    expect(sameContext({ kind: 'operations' }, { kind: 'operations' })).toBe(true);
  });

  it('handles personal context without orgId (legacy)', () => {
    // A session that predates multi-org: context is { kind: 'personal' }
    // without an orgId. sameContext treats undefined === undefined.
    expect(sameContext(
      { kind: 'personal' },
      { kind: 'personal' },
    )).toBe(true);

    // Legacy personal (no orgId) does NOT match a personal with orgId.
    expect(sameContext(
      { kind: 'personal' },
      { kind: 'personal', orgId: 'org_a' },
    )).toBe(false);
  });
});
