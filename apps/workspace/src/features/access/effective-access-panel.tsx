import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Heading, Text } from '@nestself/ui';
import type { OrgAdminApi } from '@nestself/api-client';
import { accessErrorKey } from './access-errors';
import type { AccessMember } from './access-labels';
import { MemberPicker } from './member-picker';
import { sampleEffectiveActions } from './sample-access';
import { usePreviewAccess } from './use-org-admin';

/** Groups `budget.read`, `budget.allocate`, `events.request` by their prefix. */
function groupByPrefix(actions: readonly string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const action of actions) {
    const prefix = action.split('.')[0] ?? action;
    groups.set(prefix, [...(groups.get(prefix) ?? []), action]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export interface EffectiveAccessPanelProps {
  adminApi: OrgAdminApi;
  orgId: string;
  /** Sample mode: the members to choose from; otherwise they are searched through the API. */
  sampleMembers: readonly AccessMember[];
  sampleMode: boolean;
}

/** What a chosen member can do in the organization, from `previewAccess`. */
export function EffectiveAccessPanel({ adminApi, orgId, sampleMembers, sampleMode }: EffectiveAccessPanelProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const headingId = useId();
  const [userId, setUserId] = useState<string | null>(null);
  const preview = usePreviewAccess(adminApi, sampleMode ? null : orgId, userId);

  const actions = sampleMode
    ? userId
      ? sampleEffectiveActions(orgId, userId)
      : undefined
    : preview.data;
  const errorKey = !sampleMode && preview.isError ? accessErrorKey(preview.error) : null;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <Heading level={2} id={headingId}>
        {t('workspace:access.preview.title')}
      </Heading>
      <Text tone="secondary">{t('workspace:access.preview.lead')}</Text>
      <div className="max-w-md">
        <MemberPicker
          adminApi={adminApi}
          orgId={sampleMode ? null : orgId}
          sampleMembers={sampleMembers}
          label={t('workspace:access.preview.member')}
          placeholder={t('workspace:access.assign.choose')}
          onValueChange={setUserId}
        />
      </div>
      {errorKey ? (
        <Alert tone="danger">{t(`workspace:access.errors.${errorKey}`)}</Alert>
      ) : userId && !sampleMode && preview.isPending ? (
        <Text tone="secondary">{t('workspace:access.preview.loading')}</Text>
      ) : actions && actions.length === 0 ? (
        <Text tone="secondary">{t('workspace:access.preview.empty')}</Text>
      ) : actions ? (
        <div className="space-y-3">
          {groupByPrefix(actions).map(([prefix, group]) => (
            <div key={prefix} className="space-y-1">
              <Text typeRole="label">{prefix}</Text>
              <ul aria-label={prefix} className="flex flex-wrap gap-2">
                {group.map((action) => (
                  <li key={action}>
                    <Badge>{action}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
