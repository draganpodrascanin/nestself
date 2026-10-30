/**
 * Maps a failed people-management call from the operations workspace to a
 * translation key under `admin:people.errors.*`. The API's own `message` is
 * English and meant for developers, so it is never rendered; an unknown code
 * still gets `unknown`.
 *
 * `null` means the user cancelled step-up: not a failure, nothing to show.
 * `step_up_required` itself is handled by `withStepUp` and has no copy.
 */
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from '../../auth';

export type PeopleErrorKey =
  | 'validation'
  | 'conflict'
  | 'ownerExists'
  | 'subjectNotMember'
  | 'notFound'
  | 'duplicateInvitation'
  | 'alreadyMember'
  | 'cannotEndSelf'
  | 'forbidden'
  | 'rateLimited'
  | 'unknown';

const BY_CODE: Record<string, PeopleErrorKey> = {
  validation: 'validation',
  conflict: 'conflict',
  owner_exists: 'ownerExists',
  subject_not_member: 'subjectNotMember',
  not_found: 'notFound',
  duplicate_invitation: 'duplicateInvitation',
  already_member: 'alreadyMember',
  cannot_end_self: 'cannotEndSelf',
  forbidden: 'forbidden',
  rate_limited: 'rateLimited',
};

export function peopleErrorKey(err: unknown): PeopleErrorKey | null {
  if (err instanceof StepUpCancelledError) return null;
  if (err instanceof ApiError) {
    if (err.status === 429) return 'rateLimited';
    const mapped = BY_CODE[err.code];
    if (mapped) return mapped;
    if (err.status === 409) return 'conflict';
  }
  return 'unknown';
}

/**
 * The request fields a `validation` answer names: the first path segment of
 * each Zod issue (`details.issues[].path`) plus any field the service puts in
 * `details` directly (`{ templateKey }` for a template that cannot be invited).
 */
export function validationFields(err: unknown): string[] {
  if (!(err instanceof ApiError) || err.code !== 'validation' || !err.details) return [];
  const fields = new Set<string>();
  const { issues, ...rest } = err.details as { issues?: unknown } & Record<string, unknown>;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      const path = (issue as { path?: unknown }).path;
      if (Array.isArray(path) && typeof path[0] === 'string') fields.add(path[0]);
    }
  }
  for (const key of Object.keys(rest)) fields.add(key);
  return [...fields];
}

export type ImportReasonKey =
  | 'invalidTemplate'
  | 'duplicateInBatch'
  | 'invalidOrgUnit'
  | 'ownerExists'
  | 'duplicateInvitation'
  | 'alreadyMember'
  | 'unknown';

/**
 * The per-row reasons of `POST .../invitations/import`. Some are codes and
 * some are English sentences from the service; both map to translated copy
 * under `admin:people.import.reasons.*`.
 */
export function importReasonKey(reason: string): ImportReasonKey {
  if (reason === 'owner_exists') return 'ownerExists';
  if (reason === 'duplicate_invitation') return 'duplicateInvitation';
  if (reason === 'already_member') return 'alreadyMember';
  if (reason.startsWith('Invalid template key')) return 'invalidTemplate';
  if (reason === 'Duplicate within batch') return 'duplicateInBatch';
  if (reason.startsWith('Org unit ')) return 'invalidOrgUnit';
  return 'unknown';
}
