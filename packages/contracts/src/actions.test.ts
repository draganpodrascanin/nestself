import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_LIST, isAction, CONFIDENTIAL_ACTIONS, APPROVAL_ACTIONS } from './actions.ts';

describe('actions', () => {
  it('has exactly 88 actions in the catalogue', () => {
    expect(Object.keys(ACTIONS)).toHaveLength(95);
  });

  it('ACTION_LIST length matches ACTIONS keys', () => {
    expect(ACTION_LIST).toHaveLength(Object.keys(ACTIONS).length);
  });

  it('every action key equals its value (self-referencing const)', () => {
    for (const [key, value] of Object.entries(ACTIONS)) {
      expect(key).toBe(value);
    }
  });

  it('no duplicate actions exist', () => {
    const keys = Object.keys(ACTIONS);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it('isAction returns true for valid actions', () => {
    expect(isAction('access.grant')).toBe(true);
    expect(isAction('preferences.manage')).toBe(true);
    expect(isAction('records.read.emergency')).toBe(true);
  });

  it('isAction returns false for invalid strings', () => {
    expect(isAction('not.an.action')).toBe(false);
    expect(isAction('')).toBe(false);
    expect(isAction('ACCESS.GRANT')).toBe(false);
  });

  it('CONFIDENTIAL_ACTIONS are all valid actions', () => {
    for (const a of CONFIDENTIAL_ACTIONS) {
      expect(isAction(a)).toBe(true);
    }
  });

  it('APPROVAL_ACTIONS are all valid actions', () => {
    for (const a of APPROVAL_ACTIONS) {
      expect(isAction(a)).toBe(true);
    }
  });

  it('ACTION_LIST contains all keys in insertion order', () => {
    const keys = Object.keys(ACTIONS);
    expect([...ACTION_LIST]).toEqual(keys);
  });
});
