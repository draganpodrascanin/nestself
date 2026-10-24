/**
 * Display helpers shared by the access table and dialogs.
 */
import type { TFunction } from 'i18next';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import type { GrantResponse } from '@nestself/contracts';

/** Templates with a translated name under `workspace:access.templates.*`. */
const TRANSLATED_TEMPLATES = [
  'employer_owner',
  'hr_admin',
  'team_manager',
  'approver',
  'employer_finance',
  'reporting_user',
  'employee',
  'event_supplier',
] as const;
type TranslatedTemplate = (typeof TRANSLATED_TEMPLATES)[number];

function isTranslated(key: string): key is TranslatedTemplate {
  return (TRANSLATED_TEMPLATES as readonly string[]).includes(key);
}

/** The translated template name; a grant without a template is delegated access. */
export function templateLabel(t: TFunction<['workspace', 'common']>, key: string | null): string {
  if (key === null) return t('workspace:access.templates.delegated');
  if (isTranslated(key)) return t(`workspace:access.templates.${key}`);
  return PERMISSION_TEMPLATES.find((tpl) => tpl.key === key)?.name ?? key;
}

export type GrantStatus = 'active' | 'revoked' | 'expired' | 'scheduled';

export function grantStatus(grant: GrantResponse, now: number = Date.now()): GrantStatus {
  if (grant.revokedAt) return 'revoked';
  if (grant.validUntil && Date.parse(grant.validUntil) <= now) return 'expired';
  if (grant.validFrom && Date.parse(grant.validFrom) > now) return 'scheduled';
  return 'active';
}

/** A person the screen can name: an organization member. */
export interface AccessMember {
  userId: string;
  displayName: string;
}

/** An org unit the screen can name. */
export interface AccessOrgUnit {
  id: string;
  name: string;
}
