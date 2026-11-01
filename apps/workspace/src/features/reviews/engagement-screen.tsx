import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Button,
  Card,
  DataList,
  Field,
  Heading,
  Input,
  RadioGroup,
  RadioItem,
  Skeleton,
  Table,
  Td,
  Text,
  Textarea,
  Th,
  useToast,
} from '@nestself/ui';
import {
  ACTIVE_REVIEW_ENGAGEMENT_STATUSES,
  IMPROVEMENT_ACTION_TRANSITIONS,
  can,
  type ImprovementActionStatus,
  type ImprovementActionView,
  type ReviewEngagementResponse,
} from '@nestself/contracts';
import { formatDateTime, localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '../../auth';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { useHeatmap } from '../listening/use-listening';
import { useOrgContext } from '../people/use-org-context';
import { ReportView } from './report-view';
import { ACTION_TONE, ENGAGEMENT_TONE, actionStatusKey, engagementStatusKey, priceLabel, scopeLabel } from './review-labels';
import { sampleEngagement } from './sample-reviews';
import { useBookEngagement, useCancelEngagement, useCreateAction, useEngagement, useReviewRequest, useRevokeSharing, useShareWithReviewer, useUpdateAction } from './use-reviews';

export interface EngagementScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  engagementId: string;
}

/** `date, time` in the given zone, for the participant time zones of a meeting window (spec REV-06). */
export function formatInZone(iso: string, locale: Locale, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(localeMeta[locale].intl, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
  } catch {
    return formatDateTime(iso, locale);
  }
}

/**
 * The engagement (spec REV-04..10): the accepted scope, the meeting (or the
 * proposed windows to book one, in the organization's zone and the viewer's
 * own), what has been shared with the reviewer and can be withdrawn, the
 * shared report rendered as it was released, the actions the organization
 * agrees and completes, the follow-up, and cancellation under the accepted
 * terms. Nothing here changes a survey score.
 */
export function EngagementScreen({ listeningApi, sampleMode, engagementId }: EngagementScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { add: addToast } = useToast();
  const { principal, effectiveActions } = useAuth();
  const { orgId, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useEngagement(listeningApi, apiOrgId, engagementId);
  const data: ReviewEngagementResponse | undefined = sampleMode ? sampleEngagement(engagementId) : query.data;
  const requestQuery = useReviewRequest(listeningApi, sampleMode ? null : apiOrgId, data?.requestId ?? '');
  // The departments that can be shared are the heatmap's rows for the shared result, not whatever earlier grants named.
  const heatmapQuery = useHeatmap(listeningApi, sampleMode ? null : apiOrgId, requestQuery.data?.snapshotIds[0] ?? null);
  const book = useBookEngagement(listeningApi, orgId ?? '', engagementId);
  const cancel = useCancelEngagement(listeningApi, orgId ?? '', engagementId);
  const share = useShareWithReviewer(listeningApi, orgId ?? '', engagementId);
  const revoke = useRevokeSharing(listeningApi, orgId ?? '', engagementId);
  const createAction = useCreateAction(listeningApi, orgId ?? '', engagementId);
  const updateAction = useUpdateAction(listeningApi, orgId ?? '', engagementId);

  const [windowIndex, setWindowIndex] = useState<string>('');
  const [shareScope, setShareScope] = useState<'all' | 'company'>('all');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionTitle, setActionTitle] = useState('');
  const [actionDescription, setActionDescription] = useState('');
  const [actionCheck, setActionCheck] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const allowed = (action: string) => sampleMode || (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canRequest = allowed('workplace_reviews.request');
  const canManageActions = allowed('workplace_reviews.actions.manage');
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const back = (
    <Link to="/listening/reviews" className="type-label text-primary underline">
      {t('listening:reviews.engagement.back')}
    </Link>
  );
  if (!sampleMode && (switchError || query.isError)) {
    return (
      <div className="space-y-6">
        {back}
        <Alert tone="danger">{t(listeningErrorMessageKey(query.error) ?? 'listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton lines={10} label={t('common:state.loading')} />
      </div>
    );
  }

  const fail = (err: unknown) => {
    const key = listeningErrorMessageKey(err);
    if (key) setError(t(key));
  };
  const demo = () => addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
  const active = ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(data.status);
  const snapshotIds = sampleMode ? [] : (requestQuery.data?.snapshotIds ?? []);
  const heatmapDepartments = heatmapQuery.data?.rows.filter((r) => r.kind === 'department').map((r) => r.cohortKey) ?? [];
  const departmentCohorts = heatmapDepartments.length > 0 ? heatmapDepartments : departmentKeys(data);

  const onBook = async () => {
    if (windowIndex === '') return;
    setError(null);
    if (sampleMode) return demo();
    try {
      await book.mutateAsync({ windowIndex: Number(windowIndex) });
      addToast({ title: t('listening:reviews.engagement.booked'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };

  const onShare = async () => {
    setError(null);
    if (sampleMode) return demo();
    if (snapshotIds.length === 0) return;
    try {
      await share.mutateAsync({ snapshotIds, cohortKeys: shareScope === 'all' ? ['company', ...departmentCohorts] : ['company'] });
    } catch (err) {
      fail(err);
    }
  };

  const onRevoke = async (grantId: string) => {
    setError(null);
    if (sampleMode) return demo();
    try {
      await revoke.mutateAsync(grantId);
    } catch (err) {
      fail(err);
    }
  };

  const onCancel = async () => {
    setError(null);
    if (sampleMode) {
      setCancelOpen(false);
      return demo();
    }
    try {
      await cancel.mutateAsync({});
      setCancelOpen(false);
    } catch (err) {
      setCancelOpen(false);
      fail(err);
    }
  };

  const onAction = async (action: ImprovementActionView, status: ImprovementActionStatus) => {
    setActionError(null);
    if (sampleMode) return demo();
    try {
      await updateAction.mutateAsync({ actionId: action.id, body: { status } });
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setActionError(t(key));
    }
  };

  const onCreateAction = async (event: FormEvent) => {
    event.preventDefault();
    setActionError(null);
    if (!actionTitle.trim() || !actionDescription.trim() || !actionCheck.trim()) {
      setActionError(t('listening:reviews.engagement.action.errors.required'));
      return;
    }
    if (sampleMode) return demo();
    try {
      await createAction.mutateAsync({ title: actionTitle.trim(), description: actionDescription.trim(), intendedCheck: actionCheck.trim() });
      setActionTitle('');
      setActionDescription('');
      setActionCheck('');
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setActionError(t(key));
    }
  };

  const zone = data.proposedTimeZone ?? data.appointment?.timeZone ?? viewerZone;

  return (
    <div className="space-y-8">
      {back}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level={1}>{t('listening:reviews.engagement.title')}</Heading>
          <Badge tone={ENGAGEMENT_TONE[data.status]}>{t(engagementStatusKey(data.status))}</Badge>
        </div>
        <Text tone="secondary">
          {scopeLabel(t, data.scopeCohortKey)} · {data.scope.title} · {priceLabel(t, data.scope, locale)}
        </Text>
        <Text tone="secondary" typeRole="metadata">
          {data.reviewerFirstName ? t('listening:reviews.engagement.reviewer', { name: data.reviewerFirstName }) : t('listening:reviews.engagement.noReviewer')}
          {data.coordinatorFirstName ? ` · ${t('listening:reviews.engagement.coordinator', { name: data.coordinatorFirstName })}` : ''}
        </Text>
        {data.completedAt ? <Alert tone="success">{t('listening:reviews.engagement.completed', { date: formatDateTime(data.completedAt, locale) })}</Alert> : null}
        {data.canceledAt ? (
          <Alert tone="info">
            {t('listening:reviews.engagement.canceled', { date: formatDateTime(data.canceledAt, locale) })}
            {data.cancelReason ? ` ${t('listening:reviews.engagement.cancelReason', { reason: data.cancelReason })}` : ''}
          </Alert>
        ) : null}
      </div>
      {sampleMode ? <Alert tone="info">{t('listening:reviews.sampleNote')}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <section aria-labelledby="engagement-scope" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="engagement-scope">
          {t('listening:reviews.engagement.scope')}
        </Heading>
        <DataList
          items={[
            { term: t('listening:reviews.detail.scope.deliverables'), description: data.scope.deliverables },
            { term: t('listening:reviews.detail.scope.participants'), description: data.scope.participants },
            { term: t('listening:reviews.detail.scope.price'), description: priceLabel(t, data.scope, locale), numeric: true },
            { term: t('listening:reviews.detail.scope.cancellation'), description: data.scope.cancellationPolicy },
          ]}
        />
      </section>

      <section aria-labelledby="engagement-meeting" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="engagement-meeting">
          {t('listening:reviews.engagement.meeting')}
        </Heading>
        {data.appointment ? (
          <Text>
            {t('listening:reviews.engagement.meetingAt', { date: formatInZone(data.appointment.startsAt, locale, data.appointment.timeZone), zone: data.appointment.timeZone })} ·{' '}
            <Badge tone={data.appointment.status === 'canceled' ? 'neutral' : 'success'}>{data.appointment.status}</Badge>
          </Text>
        ) : data.proposedWindows && data.proposedWindows.length > 0 && data.status === 'accepted' ? (
          <div className="space-y-3">
            <Text tone="secondary">{t('listening:reviews.engagement.windowsLead', { zone })}</Text>
            <RadioGroup label={t('listening:reviews.engagement.chooseWindow')} value={windowIndex} onValueChange={setWindowIndex}>
              {data.proposedWindows.map((w, i) => (
                <RadioItem key={w.startsAt} value={String(i)}>
                  {t('listening:reviews.engagement.window', { date: formatInZone(w.startsAt, locale, zone), zone, local: formatInZone(w.startsAt, locale, viewerZone) })}
                </RadioItem>
              ))}
            </RadioGroup>
            {canRequest ? (
              <Button variant="primary" onClick={() => void onBook()} disabled={windowIndex === '' || book.isPending}>
                {book.isPending ? t('listening:reviews.engagement.booking') : t('listening:reviews.engagement.book')}
              </Button>
            ) : null}
          </div>
        ) : (
          <Text tone="secondary">{active ? t('listening:reviews.engagement.noWindows') : t('listening:reviews.engagement.noMeeting')}</Text>
        )}
      </section>

      <section aria-labelledby="engagement-sharing" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="engagement-sharing">
          {t('listening:reviews.engagement.sharing')}
        </Heading>
        <Text tone="secondary">{t('listening:reviews.engagement.sharingLead')}</Text>
        {data.sharingGrants.length === 0 ? <Text tone="secondary">{t('listening:reviews.engagement.noSharing')}</Text> : null}
        {data.sharingGrants.map((g) => (
          <Card key={g.id} padding="md" tone="subtle" className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Text>
                {g.revokedAt ? t('listening:reviews.engagement.revoked', { date: formatDateTime(g.revokedAt, locale) }) : t('listening:reviews.engagement.sharedAt', { date: formatDateTime(g.createdAt, locale) })}
              </Text>
              <Text tone="secondary" typeRole="metadata">
                {t('listening:reviews.engagement.sharedCohorts', { list: g.cohortKeys.map((k) => scopeLabel(t, k)).join(', ') })}
              </Text>
            </div>
            {g.active && canRequest && active ? (
              <Button variant="ghost" size="sm" onClick={() => void onRevoke(g.id)} disabled={revoke.isPending}>
                {t('listening:reviews.engagement.revoke')}
              </Button>
            ) : null}
          </Card>
        ))}
        {canRequest && active ? (
          <div className="space-y-3 rounded-card border border-border-subtle p-4">
            <RadioGroup label={t('listening:reviews.engagement.shareCohorts')} value={shareScope} onValueChange={(v) => setShareScope(v as 'all' | 'company')}>
              <RadioItem value="all">{t('listening:reviews.engagement.shareAll')}</RadioItem>
              <RadioItem value="company">{t('listening:reviews.engagement.shareCompany')}</RadioItem>
            </RadioGroup>
            <Button variant="secondary" onClick={() => void onShare()} disabled={share.isPending || (!sampleMode && snapshotIds.length === 0)}>
              {t('listening:reviews.engagement.share')}
            </Button>
            <Text tone="secondary" typeRole="metadata">
              {t('listening:reviews.engagement.revokeNote')}
            </Text>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="engagement-report" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="engagement-report">
          {t('listening:reviews.engagement.report')}
        </Heading>
        {data.sharedReport ? <ReportView report={data.sharedReport} locale={locale} /> : <Text tone="secondary">{t('listening:reviews.engagement.reportNotShared')}</Text>}
      </section>

      <section aria-labelledby="engagement-actions" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="engagement-actions">
          {t('listening:reviews.engagement.actions')}
        </Heading>
        <Text tone="secondary">{t('listening:reviews.engagement.actionsLead')}</Text>
        {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
        {data.actions.length === 0 ? (
          <Text tone="secondary">{t('listening:reviews.engagement.noActions')}</Text>
        ) : (
          <Table caption={t('listening:reviews.engagement.actions')}>
            <thead>
              <tr>
                <Th>{t('listening:reviews.engagement.action.title')}</Th>
                <Th>{t('listening:reviews.engagement.action.owner')}</Th>
                <Th>{t('listening:reviews.engagement.action.due')}</Th>
                <Th>{t('listening:reviews.engagement.action.status')}</Th>
                <Th>{t('listening:reviews.engagement.action.check')}</Th>
              </tr>
            </thead>
            <tbody>
              {data.actions.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <div className="space-y-1">
                      <span className="type-label text-text">{a.title}</span>
                      <Text tone="secondary" typeRole="metadata">
                        {a.description}
                      </Text>
                      <Text tone="secondary" typeRole="metadata">
                        {t(`listening:reviews.engagement.action.proposedBy.${a.proposedBy}`)}
                      </Text>
                    </div>
                  </Td>
                  <Td>{a.ownerFirstName ?? '—'}</Td>
                  <Td>{a.dueDate ? formatDateTime(a.dueDate, locale) : '—'}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ACTION_TONE[a.status]}>{t(actionStatusKey(a.status))}</Badge>
                      {canManageActions && active
                        ? IMPROVEMENT_ACTION_TRANSITIONS[a.status].map((next) => (
                            <Button key={next} variant="ghost" size="sm" onClick={() => void onAction(a, next)} disabled={updateAction.isPending}>
                              {t(`listening:reviews.engagement.action.${next === 'agreed' ? 'agree' : next === 'in_progress' ? 'start' : next === 'completed' ? 'complete' : 'notProceeding'}`)}
                            </Button>
                          ))
                        : null}
                    </div>
                  </Td>
                  <Td>{a.intendedCheck}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {canManageActions && active ? (
          <form onSubmit={(e) => void onCreateAction(e)} noValidate className="space-y-3 rounded-card border border-border-subtle p-4" aria-labelledby="engagement-new-action">
            <Heading level={3} typeRole="sectionTitle" id="engagement-new-action">
              {t('listening:reviews.engagement.action.newTitle')}
            </Heading>
            <Field label={t('listening:reviews.engagement.action.title')} id="action-title" required>
              <Input value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} maxLength={200} />
            </Field>
            <Field label={t('listening:reviews.engagement.action.description')} id="action-description" required>
              <Textarea value={actionDescription} onChange={(e) => setActionDescription(e.target.value)} rows={3} />
            </Field>
            <Field label={t('listening:reviews.engagement.action.check')} id="action-check" required>
              <Input value={actionCheck} onChange={(e) => setActionCheck(e.target.value)} maxLength={1000} />
            </Field>
            <Button variant="secondary" type="submit" disabled={createAction.isPending}>
              {t('listening:reviews.engagement.action.add')}
            </Button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="engagement-follow-up" className="space-y-2">
        <Heading level={2} typeRole="sectionTitle" id="engagement-follow-up">
          {t('listening:reviews.engagement.followUp')}
        </Heading>
        {data.followUp ? (
          <Text>
            {t('listening:reviews.engagement.followUpPlanned', { date: formatDateTime(data.followUp.targetDate, locale) })}
            {data.followUp.ownerFirstName ? ` · ${t('listening:reviews.engagement.followUpOwner', { name: data.followUp.ownerFirstName })}` : ''}
          </Text>
        ) : (
          <Text tone="secondary">{t('listening:reviews.engagement.noFollowUp')}</Text>
        )}
      </section>

      <Text tone="secondary" typeRole="metadata">
        {t('listening:reviews.engagement.neverChanges')}
      </Text>
      {canRequest && active ? (
        <div>
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>
            {t('listening:reviews.engagement.cancel')}
          </Button>
        </div>
      ) : null}
      <AlertDialog open={cancelOpen} onOpenChange={(open) => !open && !cancel.isPending && setCancelOpen(false)}>
        <AlertDialogContent
          title={t('listening:reviews.engagement.cancelTitle')}
          description={t('listening:reviews.engagement.cancelBody')}
          confirmLabel={t('listening:reviews.engagement.cancelConfirm')}
          cancelLabel={t('common:action.cancel')}
          destructive
          onConfirm={() => void onCancel()}
          confirmPending={cancel.isPending}
        />
      </AlertDialog>
    </div>
  );
}

/** Department cohort keys the engagement already names through its grants; the company is always shareable. */
function departmentKeys(engagement: ReviewEngagementResponse): string[] {
  const keys = new Set<string>();
  for (const g of engagement.sharingGrants) for (const k of g.cohortKeys) if (k !== 'company') keys.add(k);
  if (engagement.scopeCohortKey !== 'company') keys.add(engagement.scopeCohortKey);
  return [...keys];
}
