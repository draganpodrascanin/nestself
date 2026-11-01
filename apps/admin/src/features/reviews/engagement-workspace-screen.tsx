import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDialog, AlertDialogContent, Badge, Button, Card, Field, Heading, Input, Select, Skeleton, Text, Textarea, useToast } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import { ContentEditor } from '@nestself/content/editor';
import type { ContentDocument } from '@nestself/content/schema';
import {
  ACTIVE_REVIEW_ENGAGEMENT_STATUSES,
  LISTENING_DIMENSION_KEYS,
  REPORT_SECTION_KEYS,
  can,
  type DimensionCell,
  type ListeningDimensionKey,
  type ReportSectionKey,
  type ReviewEngagementResponse,
  type ReviewPackResponse,
  type ReviewReportView,
} from '@nestself/contracts';
import { formatDate, formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '../../auth';
import { useEditorLabels } from '../cms/editor-labels';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorKey, listeningErrorMessageKey } from '../listening/listening-errors';
import { ACTION_TONE, ENGAGEMENT_TONE, actionStatusKey, engagementStatusKey, scopeLabel } from './review-labels';
import { sampleMyEngagement, samplePack, sampleReport } from './sample-reviews-ops';
import { scoreTone, statusKey } from './score-tone';
import {
  useAddNote,
  useCompleteEngagement,
  useEngagementNotes,
  useEngagementPack,
  useExpertContext,
  useMyActions,
  useMyEngagement,
  useMyReport,
  usePlanFollowUp,
  useProposeAction,
  useSaveReport,
  useShareReport,
  useSubmitReportReview,
} from './use-reviews-ops';

export interface EngagementWorkspaceScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  engagementId: string;
}

type Sections = Partial<Record<ReportSectionKey, ContentDocument>>;

/** The report's sections as editor documents; a section that is not a document is left empty. */
export function sectionsOf(report: ReviewReportView | null | undefined): Sections {
  const out: Sections = {};
  if (!report) return out;
  for (const key of REPORT_SECTION_KEYS) {
    const value = report.sections[key];
    if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'doc') out[key] = value as ContentDocument;
  }
  return out;
}

/**
 * The reviewer's workspace (spec REV-04, REV-07..09): the shared aggregate
 * pack with the same hidden cells the employer sees, the report in five
 * sections written by the reviewer (nothing is prepopulated from a score),
 * internal notes that never leave this screen, proposed actions, the
 * follow-up and completion, which is independent of the survey colour.
 */
export function EngagementWorkspaceScreen({ listeningApi, sampleMode, engagementId }: EngagementWorkspaceScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { ready, error: switchError } = useExpertContext(sampleMode);
  const id = ready ? engagementId : null;
  const query = useMyEngagement(listeningApi, id);
  const packQuery = useEngagementPack(listeningApi, id);
  const reportQuery = useMyReport(listeningApi, id);
  const engagement: ReviewEngagementResponse | undefined = sampleMode ? sampleMyEngagement(engagementId) : query.data;
  const pack: ReviewPackResponse | null | undefined = sampleMode ? samplePack(engagementId) : packQuery.isError ? null : packQuery.data;
  const report: ReviewReportView | null | undefined = sampleMode ? sampleReport(engagementId) : reportQuery.isError ? null : reportQuery.data;

  const back = (
    <Link to="/reviews/engagements" className="type-label text-primary underline">
      {t('listening:reviewOps.reviewer.back')}
    </Link>
  );
  if (!sampleMode && (switchError || query.isError)) {
    const key = query.isError ? listeningErrorMessageKey(query.error) : switchError ? (`listening:errors.${switchError}` as const) : null;
    return (
      <div className="space-y-6">
        {back}
        <Alert tone="danger">{t(key ?? 'listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!engagement || (!sampleMode && (packQuery.isPending || reportQuery.isPending))) {
    return (
      <div className="space-y-6">
        {back}
        {sampleMode ? <Alert tone="danger">{t('listening:errors.notFound')}</Alert> : <Skeleton lines={10} label={t('common:state.loading')} />}
      </div>
    );
  }
  const active = ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status);
  return (
    <div className="space-y-8">
      {back}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Heading level={1}>{engagement.scope.title}</Heading>
          <Badge tone={ENGAGEMENT_TONE[engagement.status]}>{t(engagementStatusKey(engagement.status))}</Badge>
        </div>
        <Text tone="secondary">
          {scopeLabel(t, engagement.scopeCohortKey)} · {engagement.dimensionKeys.map((k) => t(`listening:dimensions.${k}.title`)).join(', ')}
        </Text>
        <Text tone="secondary" typeRole="metadata">
          {engagement.appointment
            ? t('listening:reviews.engagement.meetingAt', { date: formatDateTime(engagement.appointment.startsAt, locale), zone: engagement.appointment.timeZone })
            : t('listening:reviewOps.engagement.noMeeting')}
          {engagement.coordinatorFirstName ? ` · ${t('listening:reviews.engagement.coordinator', { name: engagement.coordinatorFirstName })}` : ''}
        </Text>
      </div>
      {sampleMode ? <Alert tone="info">{t('listening:reviewOps.reviewer.sampleNote')}</Alert> : null}

      <PackSection pack={pack ?? null} locale={locale} />
      <ReportSection listeningApi={listeningApi} sampleMode={sampleMode} engagement={engagement} report={report ?? null} pack={pack ?? null} locale={locale} active={active} />
      <NotesSection listeningApi={listeningApi} sampleMode={sampleMode} engagementId={engagementId} ready={ready} locale={locale} />
      <ActionsSection listeningApi={listeningApi} sampleMode={sampleMode} engagement={engagement} ready={ready} active={active} />
      <ClosingSection listeningApi={listeningApi} sampleMode={sampleMode} engagement={engagement} locale={locale} active={active} />
    </div>
  );
}

function PackSection({ pack, locale }: { pack: ReviewPackResponse | null; locale: Locale }) {
  const { t } = useTranslation(['listening']);
  const cellValue = (cell: DimensionCell) => (cell.score !== null ? `${cell.score}%` : t('listening:heatmap.hidden'));
  return (
    <section aria-labelledby="reviewer-pack" className="space-y-3">
      <Heading level={2} typeRole="sectionTitle" id="reviewer-pack">
        {t('listening:reviewOps.reviewer.pack')}
      </Heading>
      <Text tone="secondary">{t('listening:reviewOps.reviewer.packLead')}</Text>
      {!pack || pack.snapshots.length === 0 ? (
        <Text tone="secondary">{t('listening:reviewOps.reviewer.noPack')}</Text>
      ) : (
        pack.snapshots.map((snapshot) => (
          <div key={snapshot.snapshotId} className="space-y-2">
            <Text typeRole="label">
              {t('listening:reviewOps.reviewer.packCycle', { from: formatDate(snapshot.cycleOpensAt, locale), to: formatDate(snapshot.cycleClosesAt, locale), version: snapshot.questionnaireVersion })}
            </Text>
            <div className="overflow-x-auto rounded-card border border-border-subtle">
              <table className="w-full min-w-[40rem] border-collapse type-table" data-testid="review-pack">
                <caption className="sr-only">{t('listening:reviewOps.reviewer.pack')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left type-label border-b border-border-subtle">
                      {t('listening:heatmap.cohort')}
                    </th>
                    {LISTENING_DIMENSION_KEYS.map((key) => (
                      <th key={key} scope="col" className="bg-tint px-3 py-2 text-left type-label border-b border-border-subtle">
                        {t(`listening:dimensions.${key}.short`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rows.map((row) => (
                    <tr key={row.cohortKey}>
                      <th scope="row" className="px-3 py-2 text-left type-label border-b border-border-subtle">
                        {row.kind === 'company' ? t('listening:heatmap.company') : row.kind === 'unassigned' ? t('listening:heatmap.unassigned') : row.name}
                      </th>
                      {LISTENING_DIMENSION_KEYS.map((key) => {
                        const cell = row.cells.find((c) => c.key === key);
                        return (
                          <td key={key} className="border-b border-border-subtle px-3 py-2 align-top">
                            {cell ? (
                              <div className="flex flex-col gap-1">
                                <span className="type-label text-text">{cellValue(cell)}</span>
                                <Badge tone={scoreTone(cell)}>{t(statusKey(cell))}</Badge>
                              </div>
                            ) : (
                              <Badge tone="neutral">{t('listening:status.not_measured')}</Badge>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

interface ReportSectionProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  engagement: ReviewEngagementResponse;
  report: ReviewReportView | null;
  pack: ReviewPackResponse | null;
  locale: Locale;
  active: boolean;
}

function ReportSection({ listeningApi, sampleMode, engagement, report, pack, locale, active }: ReportSectionProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { add: addToast } = useToast();
  const { principal, effectiveActions } = useAuth();
  const labels = useEditorLabels();
  const save = useSaveReport(listeningApi, engagement.id);
  const submit = useSubmitReportReview(listeningApi, engagement.id);
  const share = useShareReport(listeningApi, engagement.id);
  const [sections, setSections] = useState<Sections>(() => sectionsOf(report));
  const [invalidSection, setInvalidSection] = useState<ReportSectionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const canShare = sampleMode || (principal ? can(principal, 'workplace_reviews.report.publish', undefined, effectiveActions) : false);
  const demo = () => addToast({ title: t('common:sample.demoNoop'), tone: 'info' });

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'validation' && typeof err.details?.['section'] === 'string') {
      const section = err.details['section'] as ReportSectionKey;
      setInvalidSection(section);
      const first = Array.isArray(err.details['errors']) ? (err.details['errors'] as unknown[])[0] : null;
      const message = first && typeof first === 'object' && 'message' in first ? String((first as { message: unknown }).message) : t('listening:errors.validation');
      setError(t('listening:reviewOps.reviewer.invalidSection', { section: t(`listening:reviewOps.reviewer.section.${section}`), message }));
      return;
    }
    const key = listeningErrorMessageKey(err);
    if (key) setError(t(key));
  };

  const onSave = async () => {
    setError(null);
    setInvalidSection(null);
    if (sampleMode) return demo();
    const body = Object.fromEntries(REPORT_SECTION_KEYS.map((key) => [key, sections[key] ?? emptyDocument()])) as Record<ReportSectionKey, ContentDocument>;
    try {
      await save.mutateAsync({ sections: body, evidenceSnapshotIds: pack?.snapshots.map((s) => s.snapshotId) ?? [] });
      addToast({ title: t('listening:reviewOps.reviewer.saved'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };
  const onSubmit = async () => {
    setError(null);
    if (sampleMode) return demo();
    try {
      await submit.mutateAsync();
      addToast({ title: t('listening:reviewOps.reviewer.submitted'), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };
  const onShare = async () => {
    setError(null);
    if (sampleMode) {
      setShareOpen(false);
      return demo();
    }
    try {
      await share.mutateAsync();
      setShareOpen(false);
      addToast({ title: t('listening:reviewOps.reviewer.shared'), tone: 'success' });
    } catch (err) {
      setShareOpen(false);
      fail(err);
    }
  };

  return (
    <section aria-labelledby="reviewer-report" className="space-y-3">
      <Heading level={2} typeRole="sectionTitle" id="reviewer-report">
        {t('listening:reviewOps.reviewer.report')}
      </Heading>
      <Text tone="secondary">{t('listening:reviewOps.reviewer.reportLead')}</Text>
      <Text tone="secondary" typeRole="metadata">
        {report ? t('listening:reviewOps.reviewer.version', { version: report.version, status: report.status }) : t('listening:reviewOps.reviewer.noReport')}
        {report?.sharedAt ? ` · ${t('listening:reviews.engagement.sharedAt', { date: formatDateTime(report.sharedAt, locale) })}` : ''}
      </Text>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {REPORT_SECTION_KEYS.map((key) => (
        <Card key={key} as="section" padding="md" className={invalidSection === key ? 'space-y-2 border-danger' : 'space-y-2'} aria-labelledby={`report-section-${key}`} aria-invalid={invalidSection === key || undefined}>
          <Heading level={3} typeRole="sectionTitle" id={`report-section-${key}`}>
            {t(`listening:reviewOps.reviewer.section.${key}`)}
          </Heading>
          <ContentEditor
            key={`${report?.id ?? 'new'}-${key}`}
            initialDocument={sections[key]}
            onChange={(doc) => setSections((s) => ({ ...s, [key]: doc }))}
            editable={active}
            placeholder={t(`listening:reviewOps.reviewer.section.${key}`)}
            labels={labels}
          />
        </Card>
      ))}
      {active ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => void onSave()} disabled={save.isPending}>
            {save.isPending ? t('listening:reviewOps.reviewer.saving') : t('listening:reviewOps.reviewer.saveDraft')}
          </Button>
          {report && report.status === 'draft' ? (
            <Button variant="secondary" onClick={() => void onSubmit()} disabled={submit.isPending}>
              {t('listening:reviewOps.reviewer.submitReview')}
            </Button>
          ) : null}
          {report && report.status !== 'shared' && canShare ? (
            <Button variant="secondary" onClick={() => setShareOpen(true)} disabled={share.isPending}>
              {t('listening:reviewOps.reviewer.share')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <AlertDialog open={shareOpen} onOpenChange={(open) => !open && !share.isPending && setShareOpen(false)}>
        <AlertDialogContent
          title={t('listening:reviewOps.reviewer.shareTitle')}
          description={t('listening:reviewOps.reviewer.shareBody')}
          confirmLabel={t('listening:reviewOps.reviewer.shareConfirm')}
          cancelLabel={t('common:action.cancel')}
          onConfirm={() => void onShare()}
          confirmPending={share.isPending}
        />
      </AlertDialog>
    </section>
  );
}

function emptyDocument(): ContentDocument {
  return { type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [] }] } as ContentDocument;
}

interface NotesSectionProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  engagementId: string;
  ready: boolean;
  locale: Locale;
}

function NotesSection({ listeningApi, sampleMode, engagementId, ready, locale }: NotesSectionProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { add: addToast } = useToast();
  const query = useEngagementNotes(listeningApi, ready ? engagementId : null);
  const add = useAddNote(listeningApi, engagementId);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const notes = sampleMode ? [] : (query.data?.items ?? []);

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!body.trim()) return;
    if (sampleMode) {
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      await add.mutateAsync({ body: body.trim() });
      setBody('');
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setError(t(key));
    }
  };

  return (
    <section aria-labelledby="reviewer-notes" className="space-y-3">
      <Heading level={2} typeRole="sectionTitle" id="reviewer-notes">
        {t('listening:reviewOps.reviewer.notes')}
      </Heading>
      <Text tone="secondary">{t('listening:reviewOps.reviewer.notesLead')}</Text>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notes.length === 0 ? (
        <Text tone="secondary">{t('listening:reviewOps.reviewer.noNotes')}</Text>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id}>
              <Card padding="md" tone="subtle" className="space-y-1" data-internal="true">
                <Text className="whitespace-pre-line">{note.body}</Text>
                <Text tone="secondary" typeRole="metadata">
                  {formatDateTime(note.createdAt, locale)}
                </Text>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void onAdd(e)} noValidate className="space-y-2">
        <Field label={t('listening:reviewOps.reviewer.noteBody')} id="reviewer-note-body">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
        </Field>
        <Button variant="secondary" type="submit" disabled={!body.trim() || add.isPending}>
          {t('listening:reviewOps.reviewer.noteAdd')}
        </Button>
      </form>
    </section>
  );
}

interface ActionsSectionProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  engagement: ReviewEngagementResponse;
  ready: boolean;
  active: boolean;
}

function ActionsSection({ listeningApi, sampleMode, engagement, ready, active }: ActionsSectionProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { add: addToast } = useToast();
  const idPrefix = useId();
  const query = useMyActions(listeningApi, ready ? engagement.id : null);
  const propose = useProposeAction(listeningApi, engagement.id);
  const actions = sampleMode ? engagement.actions : (query.data?.items ?? []);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [check, setCheck] = useState('');
  const [dimension, setDimension] = useState<ListeningDimensionKey | ''>('');
  const [error, setError] = useState<string | null>(null);

  const onPropose = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!title.trim() || !description.trim() || !check.trim()) {
      setError(t('listening:reviews.engagement.action.errors.required'));
      return;
    }
    if (sampleMode) {
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      return;
    }
    try {
      await propose.mutateAsync({ title: title.trim(), description: description.trim(), intendedCheck: check.trim(), ...(dimension ? { dimensionKey: dimension } : {}) });
      setTitle('');
      setDescription('');
      setCheck('');
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setError(t(key));
    }
  };

  return (
    <section aria-labelledby={`${idPrefix}-actions`} className="space-y-3">
      <Heading level={2} typeRole="sectionTitle" id={`${idPrefix}-actions`}>
        {t('listening:reviewOps.reviewer.actions')}
      </Heading>
      <Text tone="secondary">{t('listening:reviewOps.reviewer.actionsLead')}</Text>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {actions.length === 0 ? (
        <Text tone="secondary">{t('listening:reviews.engagement.noActions')}</Text>
      ) : (
        <ul className="space-y-2">
          {actions.map((a) => (
            <li key={a.id}>
              <Card padding="md" tone="subtle" className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="type-label text-text">{a.title}</span>
                  <Badge tone={ACTION_TONE[a.status]}>{t(actionStatusKey(a.status))}</Badge>
                  <Text tone="secondary" typeRole="metadata">
                    {t(`listening:reviews.engagement.action.proposedBy.${a.proposedBy}`)}
                  </Text>
                </div>
                <Text tone="secondary" typeRole="metadata">
                  {a.description}
                </Text>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {active ? (
        <form onSubmit={(e) => void onPropose(e)} noValidate className="space-y-3 rounded-card border border-border-subtle p-4" aria-labelledby={`${idPrefix}-propose`}>
          <Heading level={3} typeRole="sectionTitle" id={`${idPrefix}-propose`}>
            {t('listening:reviewOps.reviewer.propose')}
          </Heading>
          <Field label={t('listening:reviews.engagement.action.title')} id={`${idPrefix}-title`} required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t('listening:reviews.engagement.action.description')} id={`${idPrefix}-description`} required>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
          <Field label={t('listening:reviews.engagement.action.check')} id={`${idPrefix}-check`} required>
            <Input value={check} onChange={(e) => setCheck(e.target.value)} maxLength={1000} />
          </Field>
          <Field label={t('listening:reviews.request.dimensions')} id={`${idPrefix}-dimension`}>
            <Select
              options={LISTENING_DIMENSION_KEYS.map((key) => ({ value: key, label: t(`listening:dimensions.${key}.title`) }))}
              placeholder={t('common:form.optional')}
              value={dimension}
              onValueChange={(v) => setDimension((v as ListeningDimensionKey | null) ?? '')}
            />
          </Field>
          <Button variant="secondary" type="submit" disabled={propose.isPending}>
            {t('listening:reviewOps.reviewer.propose')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

interface ClosingSectionProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  engagement: ReviewEngagementResponse;
  locale: Locale;
  active: boolean;
}

function ClosingSection({ listeningApi, sampleMode, engagement, locale, active }: ClosingSectionProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { add: addToast } = useToast();
  const plan = usePlanFollowUp(listeningApi, engagement.id);
  const complete = useCompleteEngagement(listeningApi, engagement.id);
  const [targetDate, setTargetDate] = useState('');
  const [owner, setOwner] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demo = () => addToast({ title: t('common:sample.demoNoop'), tone: 'info' });

  const onPlan = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!targetDate) {
      setError(t('listening:reviewOps.request.errors.required'));
      return;
    }
    if (sampleMode) return demo();
    try {
      await plan.mutateAsync({ targetDate: `${targetDate}T09:00:00.000Z`, ...(owner.trim() ? { ownerUserId: owner.trim() } : {}) });
      addToast({ title: t('listening:reviewOps.reviewer.followUpPlanned'), tone: 'success' });
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setError(t(key));
    }
  };
  const onComplete = async () => {
    setError(null);
    if (sampleMode) {
      setCompleteOpen(false);
      return demo();
    }
    try {
      await complete.mutateAsync();
      setCompleteOpen(false);
      addToast({ title: t('listening:reviewOps.reviewer.completed'), tone: 'success' });
    } catch (err) {
      setCompleteOpen(false);
      const key = listeningErrorKey(err);
      if (key) setError(t(`listening:errors.${key}`));
    }
  };

  return (
    <section aria-labelledby="reviewer-closing" className="space-y-3">
      <Heading level={2} typeRole="sectionTitle" id="reviewer-closing">
        {t('listening:reviewOps.reviewer.followUp')}
      </Heading>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {engagement.followUp ? (
        <Text>
          {t('listening:reviews.engagement.followUpPlanned', { date: formatDate(engagement.followUp.targetDate, locale) })}
          {engagement.followUp.ownerFirstName ? ` · ${t('listening:reviews.engagement.followUpOwner', { name: engagement.followUp.ownerFirstName })}` : ''}
        </Text>
      ) : (
        <Text tone="secondary">{t('listening:reviews.engagement.noFollowUp')}</Text>
      )}
      {engagement.completedAt ? <Alert tone="success">{t('listening:reviews.engagement.completed', { date: formatDateTime(engagement.completedAt, locale) })}</Alert> : null}
      {active ? (
        <>
          <form onSubmit={(e) => void onPlan(e)} noValidate className="flex flex-wrap items-end gap-3">
            <Field label={t('listening:reviewOps.reviewer.followUpDate')} id="follow-up-date" required>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
            <Field label={t('listening:reviewOps.reviewer.followUpOwner')} id="follow-up-owner">
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
            </Field>
            <Button variant="secondary" type="submit" disabled={plan.isPending}>
              {t('listening:reviewOps.reviewer.planFollowUp')}
            </Button>
          </form>
          <div>
            <Button variant="primary" onClick={() => setCompleteOpen(true)} disabled={complete.isPending}>
              {t('listening:reviewOps.reviewer.complete')}
            </Button>
          </div>
          <AlertDialog open={completeOpen} onOpenChange={(open) => !open && !complete.isPending && setCompleteOpen(false)}>
            <AlertDialogContent
              title={t('listening:reviewOps.reviewer.completeTitle')}
              description={t('listening:reviewOps.reviewer.completeBody')}
              confirmLabel={t('listening:reviewOps.reviewer.completeConfirm')}
              cancelLabel={t('common:action.cancel')}
              onConfirm={() => void onComplete()}
              confirmPending={complete.isPending}
            />
          </AlertDialog>
        </>
      ) : null}
    </section>
  );
}
