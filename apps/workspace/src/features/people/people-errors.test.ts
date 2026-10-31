import { describe, it, expect } from 'vitest';
import { ApiError } from '@nestself/api-client';
import { INVITATION_IMPORT_ROW_REASONS } from '@nestself/contracts';
import { locales, resources } from '@nestself/i18n';
import { StepUpCancelledError } from '../../auth';
import { importReasonKey, peopleErrorKey, validationFields } from './people-errors';

function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, details });
}

describe('peopleErrorKey', () => {
  it.each([
    [apiError(400, 'validation'), 'validation'],
    [apiError(409, 'conflict'), 'conflict'],
    [apiError(409, 'owner_exists'), 'ownerExists'],
    [apiError(400, 'subject_not_member'), 'subjectNotMember'],
    [apiError(404, 'not_found'), 'notFound'],
    [apiError(409, 'duplicate_invitation'), 'duplicateInvitation'],
    [apiError(409, 'already_member'), 'alreadyMember'],
    [apiError(409, 'cannot_end_self'), 'cannotEndSelf'],
    [apiError(403, 'forbidden'), 'forbidden'],
    [apiError(403, 'context_mismatch'), 'contextMismatch'],
    [apiError(429, 'anything'), 'rateLimited'],
    [apiError(409, 'something_new'), 'conflict'],
    [apiError(500, 'internal'), 'unknown'],
    [new Error('boom'), 'unknown'],
  ])('maps %s', (err, key) => {
    expect(peopleErrorKey(err)).toBe(key);
  });

  it('a cancelled step-up is not a failure', () => {
    expect(peopleErrorKey(new StepUpCancelledError())).toBeNull();
  });
});

describe('validationFields', () => {
  it('reads Zod issue paths and direct detail fields', () => {
    expect(
      validationFields(apiError(400, 'validation', { issues: [{ path: ['email'], message: 'x', code: 'y' }] })),
    ).toEqual(['email']);
    expect(validationFields(apiError(400, 'validation', { templateKey: 'platform_admin' }))).toEqual(['templateKey']);
  });

  it('is empty for other errors or no details', () => {
    expect(validationFields(apiError(400, 'validation'))).toEqual([]);
    expect(validationFields(apiError(409, 'conflict', { templateKey: 'x' }))).toEqual([]);
  });
});

describe('importReasonKey', () => {
  it.each([
    ['owner_exists', 'ownerExists'],
    ['duplicate_invitation', 'duplicateInvitation'],
    ['already_member', 'alreadyMember'],
    ['invalid_template', 'invalidTemplate'],
    ['duplicate_in_batch', 'duplicateInBatch'],
    ['org_unit_outside_org', 'invalidOrgUnit'],
    ['sso_domain_claimed', 'ssoDomainClaimed'],
    ['something else', 'unknown'],
  ])('maps %s', (reason, key) => {
    expect(importReasonKey(reason)).toBe(key);
  });

  it.each(['constructor', 'toString', '__proto__', ''])('gives the fallback to %j, not something from Object.prototype', (reason) => {
    expect(importReasonKey(reason)).toBe('unknown');
  });

  it('gives every reason of the contract its own copy, never the fallback', () => {
    const keys = INVITATION_IMPORT_ROW_REASONS.map(importReasonKey);
    expect(keys).not.toContain('unknown');
    expect(new Set(keys).size).toBe(INVITATION_IMPORT_ROW_REASONS.length);
  });

  it.each(locales)('has copy in %s for every reason of the contract and for the fallback', (locale) => {
    const copy: Record<string, unknown> = resources[locale].workspace.people.import.reasons;
    for (const key of [...INVITATION_IMPORT_ROW_REASONS.map(importReasonKey), 'unknown']) {
      expect(copy[key], `${locale}: people.import.reasons.${key}`).toEqual(expect.any(String));
      expect(copy[key]).not.toBe('');
    }
  });
});
