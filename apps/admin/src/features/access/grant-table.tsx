import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Table, Td, Th } from '@nestself/ui';
import type { BadgeTone } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { GrantResponse } from '@nestself/contracts';
import { grantStatus, scopeLabel, templateLabel } from './access-labels';
import type { AccessMember, GrantStatus } from './access-labels';

const STATUS_TONE: Record<GrantStatus, BadgeTone> = {
  active: 'success',
  scheduled: 'info',
  expired: 'warning',
  revoked: 'neutral',
};

export interface GrantTableProps {
  caption: string;
  grants: readonly GrantResponse[];
  /** Names for subjects; an unnamed subject is shown by user id. */
  members: readonly AccessMember[];
  /** Absent: the table is read-only (platform grants have no revoke route). */
  onRevoke?: (grant: GrantResponse) => void;
  /** Sample mode: actions stay visible but cannot be used. */
  actionsDisabled?: boolean;
}

export function GrantTable({ caption, grants, members, onRevoke, actionsDisabled = false }: GrantTableProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  // Statuses are computed against the time the table first rendered.
  const [now] = useState(() => Date.now());

  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.displayName ?? userId;

  const validityOf = (grant: GrantResponse) => {
    const from = grant.validFrom ? formatDate(grant.validFrom, locale) : null;
    const until = grant.validUntil ? formatDate(grant.validUntil, locale) : null;
    if (from && until) return t('admin:access.validity.range', { from, until });
    if (until) return t('admin:access.validity.until', { date: until });
    if (from) return t('admin:access.validity.from', { date: from });
    return t('admin:access.validity.noEnd');
  };

  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle';

  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th className={headerClass}>{t('admin:access.columns.template')}</Th>
          <Th className={headerClass}>{t('admin:access.columns.subject')}</Th>
          <Th className={headerClass}>{t('admin:access.columns.scope')}</Th>
          <Th className={headerClass}>{t('admin:access.columns.validity')}</Th>
          <Th className={headerClass}>{t('admin:access.columns.status')}</Th>
          {onRevoke ? <Th className={headerClass}>{t('admin:access.columns.actions')}</Th> : null}
        </tr>
      </thead>
      <tbody>
        {grants.map((grant) => {
          const status = grantStatus(grant, now);
          const template = templateLabel(t, grant.templateKey);
          const subject = nameOf(grant.subjectUserId);
          return (
            <tr key={grant.id}>
              <Td className={cellClass}>{template}</Td>
              <Td className={cellClass}>{subject}</Td>
              <Td className={cellClass}>{scopeLabel(t, grant.scopeType)}</Td>
              <Td className={`${cellClass} type-metadata text-text-secondary`}>{validityOf(grant)}</Td>
              <Td className={cellClass}>
                <Badge tone={STATUS_TONE[status]}>{t(`admin:access.status.${status}`)}</Badge>
              </Td>
              {onRevoke ? (
                <Td className={cellClass}>
                  {status !== 'revoked' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={actionsDisabled}
                      aria-label={t('admin:access.revoke.openFor', { template, subject })}
                      onClick={() => onRevoke(grant)}
                    >
                      {t('admin:access.revoke.open')}
                    </Button>
                  ) : null}
                </Td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
