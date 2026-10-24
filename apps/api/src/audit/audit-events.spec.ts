import { describe, it, expect } from 'vitest';
import { AUDIT_ACTIONS, categoryFor } from './audit-events.js';

describe('audit-events', () => {
  it('every action has a category', () => {
    for (const action of AUDIT_ACTIONS) {
      const cat = categoryFor(action);
      expect(cat).toBeTruthy();
      expect(['SECURITY', 'ADMIN', 'AUTHORIZATION', 'CONTENT_ACCESS', 'FINANCIAL']).toContain(cat);
    }
  });

  it('auth actions map to SECURITY', () => {
    for (const action of AUDIT_ACTIONS.filter((a) => a.startsWith('auth.'))) {
      expect(categoryFor(action)).toBe('SECURITY');
    }
  });

  it('identity/invitation/membership/user actions map to ADMIN', () => {
    const prefixes = ['identity.', 'invitation.', 'membership.', 'user.', 'org_unit.'];
    for (const action of AUDIT_ACTIONS.filter(
      (a) => prefixes.some((p) => a.startsWith(p)) && a !== 'user.suspended',
    )) {
      expect(categoryFor(action)).toBe('ADMIN');
    }
  });

  it('user.suspended maps to SECURITY (API-R-27)', () => {
    expect(categoryFor('user.suspended')).toBe('SECURITY');
  });

  it('grant and access actions map to AUTHORIZATION', () => {
    const authzActions = AUDIT_ACTIONS.filter(
      (a) =>
        a.startsWith('grant.') ||
        a === 'approval_authority.changed' ||
        a === 'access.denied' ||
        a.startsWith('emergency_access.'),
    );
    for (const action of authzActions) {
      expect(categoryFor(action)).toBe('AUTHORIZATION');
    }
  });

  it('grant.adjusted and emergency_access.revoked are catalogued as AUTHORIZATION', () => {
    expect(AUDIT_ACTIONS).toContain('grant.adjusted');
    expect(AUDIT_ACTIONS).toContain('emergency_access.revoked');
    expect(categoryFor('grant.adjusted')).toBe('AUTHORIZATION');
    expect(categoryFor('emergency_access.revoked')).toBe('AUTHORIZATION');
  });

  it('content and export actions map to CONTENT_ACCESS', () => {
    for (const action of AUDIT_ACTIONS.filter(
      (a) => a.startsWith('content.') || a === 'export.generated',
    )) {
      expect(categoryFor(action)).toBe('CONTENT_ACCESS');
    }
  });

  it('sso_connection actions map to ADMIN', () => {
    for (const action of AUDIT_ACTIONS.filter((a) => a.startsWith('sso_connection.'))) {
      expect(categoryFor(action)).toBe('ADMIN');
    }
  });

  it('data.erasure.requested maps to ADMIN', () => {
    expect(categoryFor('data.erasure.requested')).toBe('ADMIN');
  });
});
