import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Button,
  Heading,
  Skeleton,
  StatusBlock,
  Table,
  Td,
  Text,
  Th,
  useToast,
} from '@nestself/ui';
import type { BadgeTone } from '@nestself/ui';
import { PILOT_PRIVACY_NOTICE, PILOT_QUESTIONNAIRE_DIMENSIONS, can } from '@nestself/contracts';
import type { QuestionnaireDraftRequest, QuestionnaireStatus, QuestionnaireVersionResponse } from '@nestself/contracts';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '../../auth';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { QuestionnaireEditor } from './questionnaire-editor';
import { sampleQuestionnaires } from './sample-listening-ops';
import {
  useArchiveQuestionnaire,
  useCreateQuestionnaire,
  useOperationsContext,
  usePublishQuestionnaire,
  useQuestionnaires,
  useSubmitQuestionnaireReview,
  useUpdateQuestionnaire,
} from './use-listening-ops';

export interface QuestionnairesScreenProps {
  listeningApi: ListeningApi;
  /** Sample mode: fixtures instead of the API, drafts are not saved and nothing is published. */
  sampleMode: boolean;
}

const STATUS_TONE: Record<QuestionnaireStatus, BadgeTone> = {
  draft: 'neutral',
  in_review: 'warning',
  published: 'success',
  archived: 'neutral',
};

type Panel =
  | { mode: 'create'; initial: QuestionnaireDraftRequest }
  | { mode: 'edit'; version: QuestionnaireVersionResponse }
  | { mode: 'view'; version: QuestionnaireVersionResponse };

type Confirm = { action: 'publish' | 'archive'; version: QuestionnaireVersionResponse };

/** A new draft's starting wording: the latest published version (and comparable with it), or the pilot wording. */
export function draftFrom(latestPublished: QuestionnaireVersionResponse | null): QuestionnaireDraftRequest {
  if (!latestPublished) {
    return { dimensions: PILOT_QUESTIONNAIRE_DIMENSIONS.map((d) => ({ ...d })), notice: { ...PILOT_PRIVACY_NOTICE }, comparableWithVersionId: null };
  }
  return {
    dimensions: latestPublished.dimensions.map((d) => ({ ...d })),
    notice: { ...latestPublished.notice },
    comparableWithVersionId: latestPublished.id,
  };
}

/**
 * Questionnaire versions for staff (SUR-01, CFG-03): the list with each
 * version's state, a draft editor with a per-language preview, submit for
 * review, publish (`listening.templates.publish`, administration step-up)
 * and archive. The server enforces the state machine: a conflicting
 * transition answers 409 and renders `errors.conflict`.
 */
export function QuestionnairesScreen({ listeningApi, sampleMode }: QuestionnairesScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { add: addToast } = useToast();
  const { principal, effectiveActions } = useAuth();
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const query = useQuestionnaires(listeningApi, ready);
  const create = useCreateQuestionnaire(listeningApi);
  const update = useUpdateQuestionnaire(listeningApi);
  const submitReview = useSubmitQuestionnaireReview(listeningApi);
  const publish = usePublishQuestionnaire(listeningApi);
  const archive = useArchiveQuestionnaire(listeningApi);

  const [panel, setPanel] = useState<Panel | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canWrite = allowed('listening.templates.write');
  const canPublish = allowed('listening.templates.publish');

  const items: QuestionnaireVersionResponse[] = sampleMode ? sampleQuestionnaires() : (query.data ?? []);
  const published = items.filter((v) => v.status === 'published').sort((a, b) => b.version - a.version);
  const latestPublished = published[0] ?? null;
  const versionLabel = (v: QuestionnaireVersionResponse) => t('listening:questionnaires.version', { version: v.version });
  const comparableLabel = (v: QuestionnaireVersionResponse) => {
    if (!v.comparableWithVersionId) return t('listening:questionnaires.notComparable');
    const other = items.find((o) => o.id === v.comparableWithVersionId);
    return other ? versionLabel(other) : v.comparableWithVersionId;
  };
  const message = (err: unknown) => {
    const key = listeningErrorMessageKey(err);
    return key ? t(key) : null;
  };

  const openPanel = (next: Panel) => {
    setSaveError(null);
    setPanel(next);
    setPanelKey((k) => k + 1);
  };

  const onSave = async (body: QuestionnaireDraftRequest) => {
    if (!panel || panel.mode === 'view') return;
    setSaveError(null);
    if (sampleMode) {
      addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
      setPanel(null);
      return;
    }
    try {
      if (panel.mode === 'create') {
        await create.mutateAsync(body);
        addToast({ title: t('listening:questionnaires.toastCreated'), tone: 'success' });
      } else {
        await update.mutateAsync({ id: panel.version.id, body });
        addToast({ title: t('listening:questionnaires.toastSaved'), tone: 'success' });
      }
      setPanel(null);
    } catch (err) {
      setSaveError(message(err) ?? t('listening:errors.unknown'));
    }
  };

  const run = async (action: 'submitReview' | 'publish' | 'archive', version: QuestionnaireVersionResponse) => {
    setActionError(null);
    try {
      if (action === 'submitReview') {
        await submitReview.mutateAsync(version.id);
        addToast({ title: t('listening:questionnaires.toastSubmitted', { version: version.version }), tone: 'success' });
      } else if (action === 'publish') {
        await publish.mutateAsync(version.id);
        addToast({ title: t('listening:questionnaires.toastPublished', { version: version.version }), tone: 'success' });
      } else {
        await archive.mutateAsync(version.id);
        addToast({ title: t('listening:questionnaires.toastArchived', { version: version.version }), tone: 'success' });
      }
      setConfirm(null);
    } catch (err) {
      const text = message(err);
      // A cancelled step-up is not a failure: the dialog simply stays open.
      if (text) {
        setActionError(text);
        setConfirm(null);
      }
    }
  };

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:questionnaires.title')}</Heading>
      <Text tone="secondary">{t('listening:questionnaires.lead')}</Text>
    </div>
  );

  if (!sampleMode && (switchError || query.isError)) {
    const key = query.isError ? listeningErrorMessageKey(query.error) : null;
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title={key ? t(key) : t('listening:errors.unknown')}>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            {t('common:action.retry')}
          </Button>
        </Alert>
      </div>
    );
  }
  if (!sampleMode && (query.isLoading || !ready)) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={4} label={t('common:state.loading')} />
      </div>
    );
  }

  const confirmPending = publish.isPending || archive.isPending;

  return (
    <div className="space-y-8">
      {header}
      {sampleMode ? <Alert tone="info">{t('listening:questionnaires.sampleNote')}</Alert> : null}
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => openPanel({ mode: 'create', initial: draftFrom(latestPublished) })} disabled={panel?.mode === 'create'}>
            {t('listening:questionnaires.newDraft')}
          </Button>
          <Text tone="secondary" typeRole="metadata">
            {t('listening:questionnaires.newDraftHint')}
          </Text>
        </div>
      ) : null}

      {items.length === 0 ? (
        <StatusBlock state="empty" title={t('listening:questionnaires.empty')} body={t('listening:questionnaires.lead')} />
      ) : (
        <Table caption={t('listening:questionnaires.title')}>
          <thead>
            <tr>
              <Th>{t('listening:questionnaires.columns.version')}</Th>
              <Th>{t('listening:questionnaires.columns.status')}</Th>
              <Th>{t('listening:questionnaires.columns.created')}</Th>
              <Th>{t('listening:questionnaires.columns.published')}</Th>
              <Th>{t('listening:questionnaires.columns.comparable')}</Th>
              <Th>{t('listening:questionnaires.columns.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => {
              const editable = canWrite && (v.status === 'draft' || v.status === 'in_review');
              return (
                <tr key={v.id}>
                  <Td>{versionLabel(v)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[v.status]}>{t(`listening:questionnaires.status.${v.status}`)}</Badge>
                  </Td>
                  <Td>{formatDate(v.createdAt, locale)}</Td>
                  <Td>{v.publishedAt ? formatDate(v.publishedAt, locale) : '—'}</Td>
                  <Td>{comparableLabel(v)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {editable ? (
                        <Button variant="secondary" size="sm" onClick={() => openPanel({ mode: 'edit', version: v })}>
                          {t('listening:questionnaires.actions.edit')}
                        </Button>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={() => openPanel({ mode: 'view', version: v })}>
                          {t('listening:questionnaires.actions.view')}
                        </Button>
                      )}
                      {canWrite && v.status === 'draft' ? (
                        <Button variant="secondary" size="sm" onClick={() => void run('submitReview', v)} disabled={sampleMode || submitReview.isPending}>
                          {t('listening:questionnaires.actions.submitReview')}
                        </Button>
                      ) : null}
                      {canPublish && v.status === 'in_review' ? (
                        <Button variant="primary" size="sm" onClick={() => setConfirm({ action: 'publish', version: v })} disabled={sampleMode}>
                          {t('listening:questionnaires.actions.publish')}
                        </Button>
                      ) : null}
                      {canWrite && v.status !== 'archived' ? (
                        <Button variant="ghost" size="sm" onClick={() => setConfirm({ action: 'archive', version: v })} disabled={sampleMode}>
                          {t('listening:questionnaires.actions.archive')}
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {panel ? (
        <QuestionnaireEditor
          key={panelKey}
          title={
            panel.mode === 'create'
              ? t('listening:questionnaires.editor.createTitle')
              : panel.mode === 'edit'
                ? t('listening:questionnaires.editor.editTitle', { version: panel.version.version })
                : t('listening:questionnaires.editor.viewTitle', { version: panel.version.version })
          }
          initial={panel.mode === 'create' ? panel.initial : { dimensions: panel.version.dimensions, notice: panel.version.notice, comparableWithVersionId: panel.version.comparableWithVersionId }}
          publishedVersions={published.filter((p) => panel.mode === 'create' || p.id !== panel.version.id)}
          readOnly={panel.mode === 'view'}
          pending={create.isPending || update.isPending}
          error={saveError}
          onSave={(body) => void onSave(body)}
          onClose={() => setPanel(null)}
        />
      ) : null}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && !confirmPending && setConfirm(null)}>
        {confirm ? (
          <AlertDialogContent
            title={t(confirm.action === 'publish' ? 'listening:questionnaires.publishTitle' : 'listening:questionnaires.archiveTitle', { version: confirm.version.version })}
            description={t(confirm.action === 'publish' ? 'listening:questionnaires.publishBody' : 'listening:questionnaires.archiveBody')}
            confirmLabel={t(confirm.action === 'publish' ? 'listening:questionnaires.publishConfirm' : 'listening:questionnaires.archiveConfirm')}
            cancelLabel={t('common:action.cancel')}
            destructive={confirm.action === 'archive'}
            onConfirm={() => void run(confirm.action, confirm.version)}
            confirmPending={confirmPending}
          />
        ) : null}
      </AlertDialog>
    </div>
  );
}
