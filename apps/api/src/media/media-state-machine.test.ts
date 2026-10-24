/**
 * Unit tests for media asset state machine.
 */
import { describe, it, expect } from 'vitest';
import { assertTransition, canTransition } from './media-state-machine.js';

describe('media state machine', () => {
  it.each([
    ['uploaded', 'quarantined'],
    ['uploaded', 'rejected'],
    ['quarantined', 'processing'],
    ['quarantined', 'rejected'],
    ['processing', 'ready'],
    ['processing', 'rejected'],
    ['ready', 'expired'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each([
    ['uploaded', 'ready'],
    ['uploaded', 'processing'],
    ['uploaded', 'expired'],
    ['quarantined', 'uploaded'],
    ['quarantined', 'ready'],
    ['quarantined', 'expired'],
    ['processing', 'uploaded'],
    ['processing', 'quarantined'],
    ['processing', 'expired'],
    ['ready', 'uploaded'],
    ['ready', 'quarantined'],
    ['ready', 'processing'],
    ['ready', 'rejected'],
    ['rejected', 'uploaded'],
    ['rejected', 'ready'],
    ['expired', 'ready'],
    ['expired', 'uploaded'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(/Invalid media state transition/);
  });
});
