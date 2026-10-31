import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_LIST, isAction, CONFIDENTIAL_ACTIONS, APPROVAL_ACTIONS } from './actions.ts';

describe('actions', () => {
  it('has exactly 113 actions in the catalogue', () => {
    expect(Object.keys(ACTIONS)).toHaveLength(113);
  });

  it('contains the sixteen CMS actions (ACC-R-01)', () => {
    for (const a of [
      'taxonomy.manage', 'home.manage', 'media.upload', 'media.manage',
      'poll.manage', 'poll.respond', 'poll.results.read', 'content.metrics.read',
      'editorial.request.submit', 'editorial.request.manage', 'editorial.brief.manage',
      'intake.queue.view', 'intake.claim', 'intake.reassign', 'intake.respond',
      'intake.permission.request',
    ]) {
      expect(isAction(a), a).toBe(true);
    }
  });

  it('only intake.respond and intake.permission.request join the confidential actions (ACC-R-02)', () => {
    expect(CONFIDENTIAL_ACTIONS).toContain('intake.respond');
    expect(CONFIDENTIAL_ACTIONS).toContain('intake.permission.request');
    for (const a of ['intake.queue.view', 'intake.claim', 'intake.reassign'] as const) {
      expect(CONFIDENTIAL_ACTIONS).not.toContain(a);
    }
    expect(CONFIDENTIAL_ACTIONS).toHaveLength(6);
  });

  it('includes the event actions of NS-CALLS-01 (decision record section 7)', () => {
    expect(isAction('event.present')).toBe(true);
    expect(isAction('event.manage')).toBe(true);
    expect(isAction('event.moderate')).toBe(true);
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
