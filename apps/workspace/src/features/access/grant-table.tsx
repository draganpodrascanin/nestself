import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Table, Td, Th } from '@nestself/ui';
import type { BadgeTone } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { GrantResponse } from '@nestself/contracts';
import { grantStatus, templateLabel } from './access-labels';
import type { AccessMember, AccessOrgUnit, GrantStatus } from './access-labels';

const STATUS_TONE: Record<GrantStatus, BadgeTone> = {
  active: 'success',
  scheduled: 'info',
  expired: 'warning',
  revoked: 'neutral',
};

export interface GrantTableProps {
  grants: readonly GrantResponse[];
  members: readonly AccessMember[];
  orgUnits: readonly AccessOrgUnit[];
  /** The signed-in user: delegation is offered on their own grants only. */
  currentUserId: string;
  canRevoke: boolean;
  canDelegate: boolean;
  /** Sample mode: actions stay visible but cannot be used. */
  actionsDisabled: boolean;
  onRevoke: (grant: GrantResponse) => void;
  onDelegate: (grant: GrantResponse) => void;
}

export function GrantTable({
  grants,
  members,
  orgUnits,
  currentUserId,
  canRevoke,
  canDelegate,
  actionsDisabled,
  onRevoke,
  onDelegate,
}: GrantTableProps) {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  // Statuses are computed against the time the table first rendered.
  const [now] = useState(() => Date.now());

  const nameOf = (userId: string) =>
    members.find((m) => m.userId === userId)?.displayName ?? userId;

  const scopeOf = (grant: GrantResponse) => {
    if (grant.scopeType !== 'org_unit') return t('workspace:access.scope.organization');
    const name =
      orgUnits.find((u) => u.id === grant.scopeOrgUnitId)?.name ??
      t('workspace:access.scope.unknownUnit');
    return grant.includeDescendants
      ? t('workspace:access.scope.unitWithDescendants', { name })
      : t('workspace:access.scope.unit', { name });
  };

  const validityOf = (grant: GrantResponse) => {
    const from = grant.validFrom ? formatDate(grant.validFrom, locale) : null;
    const until = grant.validUntil ? formatDate(grant.validUntil, locale) : null;
    if (from && until) return t('workspace:access.validity.range', { from, until });
    if (until) return t('workspace:access.validity.until', { date: until });
    if (from) return t('workspace:access.validity.from', { date: from });
    return t('workspace:access.validity.noEnd');
  };

  const showActions = canRevoke || canDelegate;
  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle';

  return (
    <Table caption={t('workspace:access.tableCaption')}>
      <thead>
        <tr>
          <Th className={headerClass}>{t('workspace:access.columns.template')}</Th>
          <Th className={headerClass}>{t('workspace:access.columns.subject')}</Th>
          <Th className={headerClass}>{t('workspace:access.columns.scope')}</Th>
          <Th className={headerClass}>{t('workspace:access.columns.validity')}</Th>
          <Th className={headerClass}>{t('workspace:access.columns.status')}</Th>
          {showActions ? <Th className={headerClass}>{t('workspace:access.columns.actions')}</Th> : null}
        </tr>
      </thead>
      <tbody>
        {grants.map((grant) => {
          const status = grantStatus(grant, now);
          const template = templateLabel(t, grant.templateKey);
          const subject = nameOf(grant.subjectUserId);
          const revocable = canRevoke && status !== 'revoked';
          const delegable =
            canDelegate && status === 'active' && grant.subjectUserId === currentUserId;
          return (
            <tr key={grant.id}>
              <Td className={cellClass}>{template}</Td>
              <Td className={cellClass}>{subject}</Td>
              <Td className={cellClass}>{scopeOf(grant)}</Td>
              <Td className={`${cellClass} type-metadata text-text-secondary`}>{validityOf(grant)}</Td>
              <Td className={cellClass}>
                <Badge tone={STATUS_TONE[status]}>{t(`workspace:access.status.${status}`)}</Badge>
              </Td>
              {showActions ? (
                <Td className={cellClass}>
                  <div className="flex flex-wrap gap-2">
                    {delegable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actionsDisabled}
                        aria-label={t('workspace:access.delegate.openFor', { template })}
                        onClick={() => onDelegate(grant)}
                      >
                        {t('workspace:access.delegate.open')}
                      </Button>
                    ) : null}
                    {revocable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actionsDisabled}
                        aria-label={t('workspace:access.revoke.openFor', { template, subject })}
                        onClick={() => onRevoke(grant)}
                      >
                        {t('workspace:access.revoke.open')}
                      </Button>
                    ) : null}
                  </div>
                </Td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
