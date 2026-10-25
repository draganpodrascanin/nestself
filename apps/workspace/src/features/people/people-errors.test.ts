import { describe, it, expect } from 'vitest';
import { ApiError } from '@nestself/api-client';
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
    ['Invalid template key: platform_admin', 'invalidTemplate'],
    ['Duplicate within batch', 'duplicateInBatch'],
    ['Org unit ou_x does not belong to this organization', 'invalidOrgUnit'],
    ['something else', 'unknown'],
  ])('maps %s', (reason, key) => {
    expect(importReasonKey(reason)).toBe(key);
  });
});
