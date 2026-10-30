import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Field, Heading, Select, StatusBlock, Table, Td, Text, Th } from '@nestself/ui';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { can } from '@nestself/contracts';
import type { EmergencyAccessResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { useOperationsContext } from '../access/use-ops-admin';
import { DecisionDialog } from './decision-dialog';
import { emergencyErrorKey } from './emergency-errors';
import { EMERGENCY_STATUSES, EMERGENCY_STATUS_TONE, emergencyStatus, remaining } from './emergency-status';
import type { EmergencyStatus } from './emergency-status';
import { RecordViewerDialog } from './record-viewer-dialog';
import { RequestAccessDialog } from './request-access-dialog';
import { SAMPLE_EMERGENCY_ROWS } from './sample-emergency';
import { useEmergencyAccessList } from './use-emergency';
import type { EmergencyDecision } from './use-emergency';
import { useNow } from './use-now';

const FILTER_ID = 'emergency-status-filter';
type StatusFilter = EmergencyStatus | 'all';

export interface EmergencyScreenProps {
  opsApi: OpsAdminApi;
  /** Sample mode: the sample records, every action disabled. */
  sampleMode: boolean;
}

/**
 * Emergency access (auth-strategy.md section 4.7): requests, approvals and
 * active windows, with a read-only, audited view of one record at a time.
 *
 * Shown to principals holding `audit.read` (the list route's action);
 * Approve, Deny and Revoke to `access.emergency.approve`, Request to
 * `access.emergency.request`. All of it is convenience: the server enforces
 * each action, refuses self-approval and checks every record read.
 */
export function EmergencyScreen({ opsApi, sampleMode }: EmergencyScreenProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { principal, effectiveActions } = useAuth();
  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canList = allowed('audit.read');
  const canRequest = allowed('access.emergency.request');
  const canDecide = allowed('access.emergency.approve');
  const { ready, error: switchError } = useOperationsContext(sampleMode || !canList);
  const list = useEmergencyAccessList(opsApi, ready && canList);
  const now = useNow();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const [decision, setDecision] = useState<{ kind: EmergencyDecision; row: EmergencyAccessResponse } | null>(null);
  const [viewing, setViewing] = useState<EmergencyAccessResponse | null>(null);
  const [viewerKey, setViewerKey] = useState(0);

  if (!principal || !canList) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  const rows = sampleMode ? SAMPLE_EMERGENCY_ROWS : list.data;
  const listError = !sampleMode && list.isError ? emergencyErrorKey(list.error) ?? 'unknown' : null;
  const shown = rows?.filter((row) => filter === 'all' || emergencyStatus(row, now) === filter);

  const who = (userId: string) => (userId === principal.userId ? t('admin:emergency.you', { userId }) : userId);

  const expiry = (row: EmergencyAccessResponse, status: EmergencyStatus) => {
    if (status === 'pending') return t('admin:emergency.expiry.pending', { minutes: row.durationMinutes });
    if (status === 'active') {
      const left = remaining(row.expiresAt, now);
      return left
        ? t('admin:emergency.expiry.remaining', { ...left, time: formatDateTime(row.expiresAt, locale) })
        : t('admin:emergency.expiry.expired', { time: formatDateTime(row.expiresAt, locale) });
    }
    if (status === 'expired') return t('admin:emergency.expiry.expired', { time: formatDateTime(row.expiresAt, locale) });
    return t('admin:emergency.expiry.revoked', { time: formatDateTime(row.revokedAt ?? row.expiresAt, locale) });
  };

  const actions = (row: EmergencyAccessResponse, status: EmergencyStatus) => {
    const mine = row.userId === principal.userId;
    const buttons = [];
    if (status === 'pending' && canDecide && !mine) {
      buttons.push(
        <Button key="approve" size="sm" variant="secondary" disabled={sampleMode} onClick={() => setDecision({ kind: 'approve', row })}>
          {t('admin:emergency.approve.open')}
        </Button>,
        <Button key="deny" size="sm" variant="secondary" disabled={sampleMode} onClick={() => setDecision({ kind: 'deny', row })}>
          {t('admin:emergency.deny.open')}
        </Button>,
      );
    }
    if (status === 'pending' && mine) {
      buttons.push(
        <Text key="waiting" tone="secondary" typeRole="metadata">
          {t('admin:emergency.waiting')}
        </Text>,
      );
    }
    if (status === 'active' && mine) {
      buttons.push(
        <Button
          key="open"
          size="sm"
          disabled={sampleMode}
          onClick={() => {
            setViewerKey((k) => k + 1);
            setViewing(row);
          }}
        >
          {t('admin:emergency.record.open')}
        </Button>,
      );
    }
    if (status === 'active' && canDecide) {
      buttons.push(
        <Button key="revoke" size="sm" variant="danger" disabled={sampleMode} onClick={() => setDecision({ kind: 'revoke', row })}>
          {t('admin:emergency.revoke.open')}
        </Button>,
      );
    }
    return buttons.length > 0 ? <div className="flex flex-wrap items-center gap-2">{buttons}</div> : null;
  };

  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle align-top';

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Heading level={1}>{t('admin:emergency.title')}</Heading>
        <Text tone="secondary">{t('admin:emergency.intro')}</Text>
      </div>

      {sampleMode ? <Alert tone="info">{t('admin:emergency.sampleNote')}</Alert> : null}

      {!sampleMode && switchError ? (
        <Alert tone="danger" title={t('admin:emergency.errors.loadTitle')}>
          {t(`admin:access.errors.${switchError}`)}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-48">
          <Field id={FILTER_ID} label={t('admin:emergency.filter')}>
            <Select
              options={[
                { value: 'all', label: t('admin:emergency.statuses.all') },
                ...EMERGENCY_STATUSES.map((s) => ({ value: s, label: t(`admin:emergency.statuses.${s}`) })),
              ]}
              value={filter}
              onValueChange={(value) => setFilter((value ?? 'all') as StatusFilter)}
            />
          </Field>
        </div>
        {canRequest ? (
          <Button
            disabled={sampleMode || !ready}
            onClick={() => {
              setRequestKey((k) => k + 1);
              setRequestOpen(true);
            }}
          >
            {t('admin:emergency.request.open')}
          </Button>
        ) : null}
      </div>

      {listError ? (
        <Alert tone="danger" title={t('admin:emergency.errors.loadTitle')}>
          {t(`admin:emergency.errors.${listError}`)}
        </Alert>
      ) : shown === undefined ? (
        switchError ? null : <Text tone="secondary">{t('admin:emergency.loading')}</Text>
      ) : shown.length === 0 ? (
        <Text tone="secondary">{filter === 'all' ? t('admin:emergency.empty') : t('admin:emergency.noMatch')}</Text>
      ) : (
        <Table caption={t('admin:emergency.title')}>
          <thead>
            <tr>
              <Th className={headerClass}>{t('admin:emergency.columns.status')}</Th>
              <Th className={headerClass}>{t('admin:emergency.columns.requester')}</Th>
              <Th className={headerClass}>{t('admin:emergency.columns.approver')}</Th>
              <Th className={headerClass}>{t('admin:emergency.columns.scope')}</Th>
              <Th className={headerClass}>{t('admin:emergency.columns.purpose')}</Th>
              <Th className={headerClass}>{t('admin:emergency.columns.expiry')}</Th>
              <Th className={headerClass}>{t('admin:emergency.columns.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const status = emergencyStatus(row, now);
              return (
                <tr key={row.id} data-testid={`emergency-row-${row.id}`}>
                  <Td className={cellClass}>
                    <Badge tone={EMERGENCY_STATUS_TONE[status]}>{t(`admin:emergency.statuses.${status}`)}</Badge>
                  </Td>
                  <Td className={cellClass}>{who(row.userId)}</Td>
                  <Td className={`${cellClass} text-text-secondary`}>
                    {row.approvedByUserId ? who(row.approvedByUserId) : t('admin:emergency.notApproved')}
                  </Td>
                  <Td className={cellClass}>
                    <span className="block">{t(`admin:emergency.scopeKinds.${row.scopeKind}`)}</span>
                    <span className="type-metadata text-text-secondary">{row.scopeId}</span>
                  </Td>
                  <Td className={`${cellClass} max-w-80`}>{row.purpose}</Td>
                  <Td className={`${cellClass} type-metadata text-text-secondary`}>{expiry(row, status)}</Td>
                  <Td className={cellClass}>{actions(row, status)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {!sampleMode && canRequest ? (
        <RequestAccessDialog key={`request-${requestKey}`} open={requestOpen} onOpenChange={setRequestOpen} opsApi={opsApi} />
      ) : null}
      {!sampleMode && canDecide ? (
        <DecisionDialog
          key={decision ? `${decision.kind}-${decision.row.id}` : 'none'}
          decision={decision?.kind ?? 'approve'}
          row={decision?.row ?? null}
          onClose={() => setDecision(null)}
          opsApi={opsApi}
        />
      ) : null}
      {!sampleMode ? (
        <RecordViewerDialog key={`viewer-${viewerKey}`} access={viewing} onClose={() => setViewing(null)} opsApi={opsApi} />
      ) : null}
    </div>
  );
}
