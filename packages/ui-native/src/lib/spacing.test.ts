import { describe, it, expect } from 'vitest';
import { space, radius } from './spacing.js';

describe('space', () => {
  it('returns 0 for key 0', () => {
    expect(space(0)).toBe(0);
  });

  it('returns 8 for key 8', () => {
    expect(space(8)).toBe(8);
  });

  it('returns 16 for key 16', () => {
    expect(space(16)).toBe(16);
  });

  it('returns 48 for key 48', () => {
    expect(space(48)).toBe(48);
  });

  it('returns 96 for key 96', () => {
    expect(space(96)).toBe(96);
  });
});

describe('radius', () => {
  it('returns a number for small', () => {
    expect(typeof radius('small')).toBe('number');
    expect(radius('small')).toBeGreaterThan(0);
  });

  it('returns a number for control', () => {
    expect(typeof radius('control')).toBe('number');
    expect(radius('control')).toBeGreaterThan(0);
  });

  it('returns a number for card', () => {
    expect(typeof radius('card')).toBe('number');
    expect(radius('card')).toBeGreaterThan(0);
  });

  it('returns a number for pill', () => {
    expect(typeof radius('pill')).toBe('number');
    expect(radius('pill')).toBeGreaterThan(0);
  });
});
