import { describe, it, expect } from 'vitest';
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from '../../auth';
import { importReasonKey, peopleErrorKey, validationFields } from './people-errors';

const err = (status: number, code: string, details?: Record<string, unknown>) =>
  new ApiError({ status, code, message: 'English', requestId: null, ...(details ? { details } : {}) });

describe('peopleErrorKey (operations)', () => {
  it.each([
    [err(400, 'validation'), 'validation'],
    [err(409, 'owner_exists'), 'ownerExists'],
    [err(409, 'subject_not_member'), 'subjectNotMember'],
    [err(404, 'not_found'), 'notFound'],
    [err(409, 'duplicate_invitation'), 'duplicateInvitation'],
    [err(409, 'already_member'), 'alreadyMember'],
    [err(403, 'forbidden'), 'forbidden'],
    [err(409, 'cannot_end_self'), 'cannotEndSelf'],
    [err(429, 'anything'), 'rateLimited'],
    [err(409, 'something_new'), 'conflict'],
    [err(500, 'internal_error'), 'unknown'],
    [new Error('network'), 'unknown'],
  ])('maps %o to %s', (error, key) => {
    expect(peopleErrorKey(error)).toBe(key);
  });

  it('returns null for a cancelled step-up', () => {
    expect(peopleErrorKey(new StepUpCancelledError())).toBeNull();
  });

  it('reads the fields of a validation answer', () => {
    expect(validationFields(err(400, 'validation', { issues: [{ path: ['email'] }], templateKey: 'x' }))).toEqual(['email', 'templateKey']);
    expect(validationFields(err(409, 'conflict'))).toEqual([]);
  });

  it('maps import row reasons, unknown ones included', () => {
    expect(importReasonKey('owner_exists')).toBe('ownerExists');
    expect(importReasonKey('invalid_template')).toBe('invalidTemplate');
    expect(importReasonKey('duplicate_in_batch')).toBe('duplicateInBatch');
    expect(importReasonKey('org_unit_outside_org')).toBe('invalidOrgUnit');
    expect(importReasonKey('something else')).toBe('unknown');
  });
});
