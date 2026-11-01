import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Heading, RadioGroup, RadioItem, Skeleton, StatusBlock, Text, buttonClassNames } from '@nestself/ui';
import { formatDate, formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { ListeningDimensionKey, MySurveyResponse, QuestionnaireDimension, SurveyAnswers } from '@nestself/contracts';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { sampleMySurvey, sampleOrganizationName } from './sample-listening';
import { useMySurvey, useSaveDraft, useSubmitSurvey } from './use-listening';

type Step = 'intro' | 'question' | 'review' | 'receipt';
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const DRAFT_DEBOUNCE_MS = 600;

export interface SurveyScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  organizationName: string | null;
}

function localized(text: Record<string, string>, locale: Locale): string {
  return text[locale] ?? text.en ?? Object.values(text)[0] ?? '';
}

/**
 * The employee survey (spec EMP-01, EMP-02): introduction with the privacy
 * summary and the full notice, one question per step with 1 to 5 and Skip,
 * a private draft that saves as you go (Saving, Saved, Could not save), a
 * review step, one submission with an idempotency key, and the receipt that
 * links to the separate feedback composer.
 */
export function SurveyScreen({ listeningApi, sampleMode, organizationName }: SurveyScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const query = useMySurvey(listeningApi, !sampleMode);
  const survey: MySurveyResponse | undefined = sampleMode ? sampleMySurvey() : query.data;

  if (!sampleMode && query.isLoading) {
    return (
      <div className="space-y-6">
        <Heading level={1}>{t('listening:nav.survey')}</Heading>
        <Skeleton lines={4} label={t('common:state.loading')} />
      </div>
    );
  }
  if (!sampleMode && query.isError) {
    const key = listeningErrorMessageKey(query.error);
    return (
      <div className="space-y-6">
        <Heading level={1}>{t('listening:nav.survey')}</Heading>
        <Alert tone="danger" title={t('listening:survey.errors.loadTitle')}>
          {key ? t(key) : t('listening:errors.unknown')}
        </Alert>
      </div>
    );
  }
  if (!survey || !survey.cycle) {
    return (
      <div className="space-y-6">
        <Heading level={1}>{t('listening:nav.survey')}</Heading>
        <StatusBlock state="empty" title={t('listening:survey.none.title')} body={t('listening:survey.none.body')} />
      </div>
    );
  }
  return (
    <SurveyFlow
      key={survey.cycle.id}
      survey={survey}
      listeningApi={listeningApi}
      sampleMode={sampleMode}
      locale={locale}
      organizationName={organizationName ?? (sampleMode ? sampleOrganizationName() : '')}
    />
  );
}

function SurveyFlow({
  survey,
  listeningApi,
  sampleMode,
  locale,
  organizationName,
}: {
  survey: Extract<MySurveyResponse, { cycle: object }>;
  listeningApi: ListeningApi;
  sampleMode: boolean;
  locale: Locale;
  organizationName: string;
}) {
  const { t } = useTranslation(['listening', 'common']);
  const dimensions = survey.questionnaire.dimensions as QuestionnaireDimension[];
  const alreadySubmitted = survey.participation.state === 'submitted';
  const [step, setStep] = useState<Step>(alreadySubmitted ? 'receipt' : 'intro');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswers>(survey.participation.draft ?? {});
  const [skipped, setSkipped] = useState<Set<ListeningDimensionKey>>(new Set());
  const [showNotice, setShowNotice] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [submittedAt, setSubmittedAt] = useState<string | null>(survey.participation.submittedAt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const saveDraft = useSaveDraft(listeningApi, survey.cycle.id);
  const submit = useSubmitSurvey(listeningApi, survey.cycle.id);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Autosave the private draft after a pause (EMP-02 "Saving, Saved, Could not save").
  useEffect(() => {
    if (sampleMode || !dirty.current || step === 'receipt') return;
    setSaveState('saving');
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveDraft.mutate(
        { answers },
        { onSuccess: () => setSaveState('saved'), onError: () => setSaveState('failed') },
      );
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mutation object is stable enough; answers drive the save
  }, [answers, sampleMode, step]);

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const current = dimensions[index];

  const rate = (key: ListeningDimensionKey, value: number) => {
    dirty.current = true;
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const skip = (key: ListeningDimensionKey) => {
    dirty.current = true;
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSkipped((prev) => new Set(prev).add(key));
    advance();
  };

  const advance = () => {
    if (index + 1 < dimensions.length) setIndex(index + 1);
    else setStep('review');
  };

  const back = () => {
    if (step === 'review') {
      setStep('question');
      setIndex(dimensions.length - 1);
    } else if (index > 0) setIndex(index - 1);
    else setStep('intro');
  };

  const onSubmit = () => {
    setSubmitError(null);
    if (sampleMode) {
      setSubmittedAt(new Date().toISOString());
      setStep('receipt');
      return;
    }
    submit.mutate(
      { body: { answers, questionnaireVersionId: survey.questionnaire.id }, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: (receipt) => {
          setSubmittedAt(receipt.submittedAt);
          setStep('receipt');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'already_submitted') {
            setSubmittedAt(submittedAt ?? new Date().toISOString());
            setStep('receipt');
            return;
          }
          const key = listeningErrorMessageKey(error);
          setSubmitError(key ? t(key) : t('listening:errors.unknown'));
        },
      },
    );
  };

  const saveStatus =
    saveState === 'idle' ? null : (
      <Text tone={saveState === 'failed' ? 'danger' : 'secondary'} typeRole="metadata" role="status" aria-live="polite">
        {t(`listening:survey.save.${saveState}`)}
        {saveState === 'failed' ? (
          <>
            {' '}
            <button type="button" className="underline" onClick={() => setAnswers((a) => ({ ...a }))}>
              {t('listening:survey.save.retry')}
            </button>
          </>
        ) : null}
      </Text>
    );

  if (step === 'receipt') {
    return (
      <div className="space-y-6">
        <Heading level={1}>{t('listening:survey.receipt.title')}</Heading>
        <Alert tone="success" title={t('listening:survey.receipt.title')}>
          {t('listening:survey.receipt.body', { date: formatDateTime(submittedAt ?? new Date().toISOString(), locale) })}
        </Alert>
        {sampleMode ? <Alert tone="info">{t('common:sample.demoNoop')}</Alert> : null}
        <Card padding="lg" className="space-y-3" as="section" aria-labelledby="survey-feedback-title">
          <Heading level={2} typeRole="sectionTitle" id="survey-feedback-title">
            {t('listening:survey.receipt.feedbackTitle')}
          </Heading>
          <Text>{t('listening:survey.receipt.feedbackBody')}</Text>
          <Link to="/feedback/new" className={buttonClassNames({ variant: 'secondary' })}>
            {t('listening:survey.receipt.feedbackAction')}
          </Link>
        </Card>
      </div>
    );
  }

  if (step === 'intro') {
    return (
      <div className="space-y-6">
        <Heading level={1}>{t('listening:survey.intro.title')}</Heading>
        <Text>{t('listening:survey.intro.lead', { organization: organizationName, minutes: survey.cycle.estimatedMinutes })}</Text>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <Text>{t('listening:survey.intro.voluntary')}</Text>
          </li>
          <li>
            <Text>{t('listening:survey.intro.employerSees', { minimum: 10 })}</Text>
          </li>
          <li>
            <Text>{t('listening:survey.intro.nestselfLink')}</Text>
          </li>
        </ul>
        <Text tone="secondary" typeRole="metadata">
          {t('listening:survey.card.due', { date: formatDate(survey.cycle.closesAt, locale) })}
        </Text>
        <div>
          <Button variant="ghost" onClick={() => setShowNotice((v) => !v)} aria-expanded={showNotice} aria-controls="survey-notice">
            {showNotice ? t('listening:survey.intro.hideNotice') : t('listening:survey.intro.readNotice')}
          </Button>
          {showNotice ? (
            <Card id="survey-notice" padding="md" tone="subtle" className="mt-3" as="section" aria-label={t('listening:survey.intro.noticeTitle')}>
              <Text>{localized(survey.questionnaire.notice, locale)}</Text>
            </Card>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => setStep('question')}>
            {t('listening:survey.intro.start')}
          </Button>
          <Link to="/" className={buttonClassNames({ variant: 'secondary' })}>
            {t('listening:survey.intro.leave')}
          </Link>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="space-y-6">
        <Heading level={1}>{t('listening:survey.submit.title')}</Heading>
        <Text>{t('listening:survey.submit.lead')}</Text>
        <Text tone="secondary" typeRole="metadata">
          {t('listening:survey.submit.answered', { count: answeredCount, total: dimensions.length })}
        </Text>
        <ul className="space-y-2">
          {dimensions.map((d, i) => (
            <li key={d.key}>
              <Card padding="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Text typeRole="label">{t(`listening:dimensions.${d.key}.title`)}</Text>
                  <Text tone="secondary" typeRole="metadata">
                    {answers[d.key] !== undefined ? `${answers[d.key]} / 5` : t('listening:survey.question.skipped')}
                  </Text>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIndex(i);
                    setStep('question');
                  }}
                >
                  {t('listening:survey.submit.change')}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
        {saveStatus}
        {answeredCount === 0 ? <Alert tone="warning">{t('listening:survey.submit.atLeastOne')}</Alert> : null}
        {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={onSubmit} disabled={answeredCount === 0 || submit.isPending}>
            {submit.isPending ? t('listening:survey.submit.submitting') : t('listening:survey.submit.action')}
          </Button>
          <Button variant="secondary" onClick={back}>
            {t('listening:survey.question.back')}
          </Button>
        </div>
      </div>
    );
  }

  if (!current) return null;
  const value = answers[current.key];
  return (
    <div className="space-y-6">
      <Text tone="secondary" typeRole="metadata">
        {t('listening:survey.question.step', { current: index + 1, total: dimensions.length })}
      </Text>
      <Heading level={1} typeRole="sectionTitle" id="survey-question">
        {localized(current.question, locale)}
      </Heading>
      <Text tone="secondary" typeRole="metadata">
        {t('listening:survey.question.scaleHint', { low: localized(current.scaleLow, locale), high: localized(current.scaleHigh, locale) })}
      </Text>
      <RadioGroup
        label={t('listening:survey.question.scale')}
        name={current.key}
        value={value !== undefined ? String(value) : ''}
        onValueChange={(v) => rate(current.key, Number(v))}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <RadioItem key={n} value={String(n)}>
            {n}
            {n === 1 ? ` - ${localized(current.scaleLow, locale)}` : n === 5 ? ` - ${localized(current.scaleHigh, locale)}` : ''}
          </RadioItem>
        ))}
      </RadioGroup>
      {skipped.has(current.key) ? (
        <Text tone="secondary" typeRole="metadata">
          {t('listening:survey.question.skipped')}
        </Text>
      ) : null}
      {saveStatus}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={advance} disabled={value === undefined}>
          {index + 1 < dimensions.length ? t('listening:survey.question.next') : t('listening:survey.question.review')}
        </Button>
        <Button variant="secondary" onClick={() => skip(current.key)}>
          {t('listening:survey.question.skip')}
        </Button>
        <Button variant="ghost" onClick={back}>
          {t('listening:survey.question.back')}
        </Button>
      </div>
    </div>
  );
}
