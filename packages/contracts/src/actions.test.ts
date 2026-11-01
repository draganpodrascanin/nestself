import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_LIST, isAction, CONFIDENTIAL_ACTIONS, APPROVAL_ACTIONS } from './actions.ts';

describe('actions', () => {
  it('has exactly 132 actions in the catalogue', () => {
    expect(Object.keys(ACTIONS)).toHaveLength(132);
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
    expect(CONFIDENTIAL_ACTIONS).toHaveLength(11);
  });

  it('includes the employee listening, feedback case and workplace review actions (ADR 0002)', () => {
    for (const a of [
      'listening.configure', 'listening.templates.write', 'listening.templates.publish',
      'listening.cycles.manage', 'listening.respond.self', 'listening.reports.read', 'listening.reports.export',
      'feedback_case.create.self', 'feedback_case.read.self', 'feedback_case.reply.self',
      'feedback_case.handle', 'feedback_case.assign',
      'workplace_reviews.request', 'workplace_reviews.coordinate', 'workplace_reviews.scope.accept',
      'workplace_reviews.engagement.read', 'workplace_reviews.report.write',
      'workplace_reviews.report.publish', 'workplace_reviews.actions.manage',
    ]) {
      expect(isAction(a), a).toBe(true);
    }
  });

  it('every feedback case action is confidential and no listening or review action is', () => {
    for (const a of ['feedback_case.create.self', 'feedback_case.read.self', 'feedback_case.reply.self', 'feedback_case.handle', 'feedback_case.assign'] as const) {
      expect(CONFIDENTIAL_ACTIONS).toContain(a);
    }
    for (const a of CONFIDENTIAL_ACTIONS) {
      expect(a.startsWith('listening.') || a.startsWith('workplace_reviews.')).toBe(false);
    }
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
