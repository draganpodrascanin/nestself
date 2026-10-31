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
import { INVITATION_IMPORT_ROW_REASONS } from '@nestself/contracts';
import type { InvitationImportRowReason } from '@nestself/contracts';
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
  | 'ssoDomainClaimed'
  | 'ownerExists'
  | 'duplicateInvitation'
  | 'alreadyMember'
  | 'unknown';

/**
 * One key for every reason of the contract: adding a reason to
 * `INVITATION_IMPORT_ROW_REASONS` fails the type check until it has a key here.
 * (`duplicate_invitation` and `already_member` rows are counted as skipped, not
 * listed as errors, so their copy is not reached from the import table; the
 * keys stay for the single-create 409 answers and for locale parity.)
 */
const IMPORT_REASON_KEYS: Record<InvitationImportRowReason, Exclude<ImportReasonKey, 'unknown'>> = {
  invalid_template: 'invalidTemplate',
  duplicate_in_batch: 'duplicateInBatch',
  org_unit_outside_org: 'invalidOrgUnit',
  sso_domain_claimed: 'ssoDomainClaimed',
  owner_exists: 'ownerExists',
  duplicate_invitation: 'duplicateInvitation',
  already_member: 'alreadyMember',
};

function isImportRowReason(reason: string): reason is InvitationImportRowReason {
  return (INVITATION_IMPORT_ROW_REASONS as readonly string[]).includes(reason);
}

/**
 * The per-row reason codes of `POST .../invitations/import`
 * (`InvitationImportRowReason`), mapped to translated copy under
 * `admin:people.import.reasons.*`; a code without copy gets `unknown`.
 */
export function importReasonKey(reason: string): ImportReasonKey {
  return isImportRowReason(reason) ? IMPORT_REASON_KEYS[reason] : 'unknown';
}
