/**
 * Display helpers shared by the access tables, dialogs and lookup.
 */
import type { TFunction } from 'i18next';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import type { GrantResponse, PermissionTemplateDefinition, ScopeType } from '@nestself/contracts';

/** Templates with a translated name under `admin:access.templates.*`. */
const TRANSLATED_TEMPLATES = [
  'platform_owner',
  'client_operations',
  'content_author',
  'content_publisher',
  'service_coordinator',
  'support_operator',
  'nestself_finance',
  'expert',
  'expert_lead',
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

export type AccessT = TFunction<['admin', 'common']>;

/** The translated template name; a grant without a template is delegated access. */
export function templateLabel(t: AccessT, key: string | null): string {
  if (key === null) return t('admin:access.templates.delegated');
  if (isTranslated(key)) return t(`admin:access.templates.${key}`);
  return PERMISSION_TEMPLATES.find((tpl) => tpl.key === key)?.name ?? key;
}

/** The scope of a grant; the operations side has no org-unit names. */
export function scopeLabel(t: AccessT, scopeType: ScopeType): string {
  return t(`admin:access.scope.${scopeType}`);
}

/** Active templates of one workspace, in catalogue order. */
export function assignableTemplates(
  workspace: PermissionTemplateDefinition['workspace'],
): readonly PermissionTemplateDefinition[] {
  return PERMISSION_TEMPLATES.filter((tpl) => tpl.workspace === workspace && tpl.isActive);
}

export type GrantStatus = 'active' | 'revoked' | 'expired' | 'scheduled';

export function grantStatus(grant: GrantResponse, now: number = Date.now()): GrantStatus {
  if (grant.revokedAt) return 'revoked';
  if (grant.validUntil && Date.parse(grant.validUntil) <= now) return 'expired';
  if (grant.validFrom && Date.parse(grant.validFrom) > now) return 'scheduled';
  return 'active';
}

/** A person the screen can name. */
export interface AccessMember {
  userId: string;
  displayName: string;
}

/** Groups `budget.read`, `budget.allocate`, `events.request` by their prefix. */
export function groupByPrefix(actions: readonly string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const action of actions) {
    const prefix = action.split('.')[0] ?? action;
    groups.set(prefix, [...(groups.get(prefix) ?? []), action]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** End of the chosen day in the user's time zone, as an ISO timestamp. */
export function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}
