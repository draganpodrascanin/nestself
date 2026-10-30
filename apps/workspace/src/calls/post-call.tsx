/**
 * The employee's post-call screen pieces: the private feedback form
 * (CALL-15) and "Report a technical problem" (CALL-16), which sends a fixed
 * category and the call's connection summary to
 * `POST /calls/:sessionId/problem-report`.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTrigger,
  Field,
  FormErrorSummary,
  Heading,
  RadioGroup,
  RadioItem,
  Textarea,
} from '@nestself/ui';
import type { FormError, FormErrorSummaryHandle } from '@nestself/ui';
import {
  CALL_FEEDBACK_COMMENT_MAX_LENGTH,
  CALL_FEEDBACK_SCORE_MAX,
  CALL_FEEDBACK_SCORE_MIN,
  CALL_PROBLEM_CATEGORIES,
} from '@nestself/contracts';
import type { CallProblemCategory } from '@nestself/contracts';
import { classifyQuality } from '@nestself/video';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import type { ClientEventSummary, ClientEventSummaryRecorder } from './client-event-summary';
import { mapCallError } from './map-call-error';
import { Reveal } from './reveal';

const SCORES = Array.from({ length: CALL_FEEDBACK_SCORE_MAX - CALL_FEEDBACK_SCORE_MIN + 1 }, (_, index) => String(CALL_FEEDBACK_SCORE_MIN + index));

const RATING_ID = 'feedback-rating';
const COMMENT_ID = 'feedback-comment';

/**
 * A 1 to 5 rating and an optional comment, private to NestSelf: the
 * employer never sees it (UX-22). Skipping is as prominent as sending.
 */
export function FeedbackForm({ appointmentId }: { appointmentId: string }) {
  const { t } = useTranslation('calls');
  const summaryRef = useRef<FormErrorSummaryHandle>(null);
  const [score, setScore] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | 'skipped' | 'sample' | null>(null);

  const ratingError = errors.find((error) => error.id === RATING_ID)?.message;
  const commentError = errors.find((error) => error.id === COMMENT_ID)?.message;

  const fail = (next: FormError[]) => {
    setErrors(next);
    queueMicrotask(() => summaryRef.current?.focus());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const comment = String(new FormData(event.currentTarget).get('comment') ?? '').trim();
    const next: FormError[] = [];
    if (!score) next.push({ id: RATING_ID, label: t('feedback.rating'), message: t('feedback.errors.ratingRequired') });
    if (comment.length > CALL_FEEDBACK_COMMENT_MAX_LENGTH) {
      next.push({ id: COMMENT_ID, label: t('feedback.comment'), message: t('feedback.errors.commentTooLong', { max: CALL_FEEDBACK_COMMENT_MAX_LENGTH }) });
    }
    if (next.length > 0) {
      fail(next);
      return;
    }
    setErrors([]);
    if (isSampleDataMode) {
      setOutcome('sample');
      return;
    }
    setPending(true);
    try {
      await callsApi.submitFeedback(appointmentId, { score: Number(score), comment: comment || null });
      setOutcome('sent');
    } catch (err) {
      fail([{ id: RATING_ID, label: t('feedback.title'), message: mapCallError(err, t) }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card as="section" className="gap-4 flex flex-col">
      <Heading level={2} typeRole="sectionTitle">
        {t('feedback.title')}
      </Heading>
      {outcome ? (
        <Reveal show>
          <Alert tone={outcome === 'sent' ? 'success' : 'info'}>
            {outcome === 'sent' ? t('feedback.thanks') : outcome === 'skipped' ? t('feedback.skipped') : t('sample.actionNoop')}
          </Alert>
        </Reveal>
      ) : (
        <form noValidate onSubmit={(event) => void submit(event)} className="gap-5 flex flex-col">
          <p className="type-body text-text-secondary">{t('feedback.privacy')}</p>
          <Reveal show={errors.length > 0}>
            <FormErrorSummary ref={summaryRef} title={t('feedback.errorSummary')} errors={errors} />
          </Reveal>
          <div id={RATING_ID} tabIndex={-1} className="gap-1.5 flex flex-col">
            <span className="type-label text-text" aria-hidden>
              {t('feedback.rating')}
            </span>
            <RadioGroup label={t('feedback.rating')} name="score" value={score} onValueChange={setScore} className="gap-x-6 flex flex-wrap">
              {SCORES.map((value) => (
                <RadioItem key={value} value={value}>
                  {t('feedback.ratingOption', { score: value })}
                </RadioItem>
              ))}
            </RadioGroup>
            {ratingError ? <p className="type-metadata text-danger">{ratingError}</p> : null}
          </div>
          <Field id={COMMENT_ID} label={t('feedback.comment')} optionalLabel={t('location.optional')} error={commentError}>
            <Textarea name="comment" rows={3} />
          </Field>
          <div className="gap-3 flex flex-wrap">
            <Button type="submit" loading={pending} loadingLabel={t('feedback.submit')}>
              {t('feedback.submit')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOutcome('skipped')} disabled={pending}>
              {t('feedback.skip')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function formatQuality(t: TFunction<'calls'>, summary: ClientEventSummary): string {
  if (!summary.metrics) return t('report.notMeasured');
  return t(`connection.${classifyQuality(summary.metrics)}`);
}

/**
 * Sends this call's connection details to NestSelf support (CALL-16): what
 * kind of problem it was (a fixed choice) and the call length,
 * reconnections, the last connection aggregate, browser and OS. Nothing
 * said, no names, no device labels, no free text.
 */
export function ReportProblemDialog({ sessionId, recorder }: { sessionId: string | null; recorder: ClientEventSummaryRecorder }) {
  const { t } = useTranslation('calls');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<'sent' | 'sample' | null>(null);
  const [category, setCategory] = useState<CallProblemCategory | ''>('');
  const summary = recorder.summary();
  const notMeasured = t('report.notMeasured');

  const rows = [
    {
      term: t('report.duration'),
      description: summary.durationMs === null ? notMeasured : t('report.minutes', { count: Math.max(1, Math.round(summary.durationMs / 60_000)) }),
    },
    { term: t('report.reconnects'), description: String(summary.reconnects) },
    { term: t('report.quality'), description: formatQuality(t, summary) },
    { term: t('report.browser'), description: summary.browser ?? notMeasured },
    { term: t('report.os'), description: summary.os ?? notMeasured },
  ];

  const send = async () => {
    setError(null);
    if (!category) {
      setError(t('report.categoryRequired'));
      return;
    }
    if (isSampleDataMode || !sessionId) {
      setSent('sample');
      setOpen(false);
      return;
    }
    setPending(true);
    try {
      await callsApi.reportProblem(sessionId, { category, summary: recorder.problemSummary() });
      setSent('sent');
      setOpen(false);
    } catch (err) {
      setError(mapCallError(err, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="gap-3 flex flex-col items-start">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>
          <Button variant="secondary" disabled={sent !== null}>
            {t('report.open')}
          </Button>
        </DialogTrigger>
        <DialogContent title={t('report.title')} description={t('report.body')} closeLabel={t('report.cancel')}>
          <RadioGroup
            label={t('report.category')}
            name="category"
            value={category}
            onValueChange={(value) => setCategory(value as CallProblemCategory)}
            className="mb-4 gap-2 flex flex-col"
          >
            {CALL_PROBLEM_CATEGORIES.map((value) => (
              <RadioItem key={value} value={value}>
                {t(`report.categories.${value}`)}
              </RadioItem>
            ))}
          </RadioGroup>
          <h3 className="mb-2 type-label text-text">{t('report.attached')}</h3>
          <dl className="gap-x-6 gap-y-2 m-0 grid grid-cols-[max-content_1fr]">
            {rows.map((row) => (
              <div key={row.term} className="contents">
                <dt className="type-metadata text-text-secondary">{row.term}</dt>
                <dd className="m-0 type-body text-text">{row.description}</dd>
              </div>
            ))}
          </dl>
          <Reveal show={error !== null} className="mt-4">
            <Alert tone="danger">{error}</Alert>
          </Reveal>
          <DialogActions>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              {t('report.cancel')}
            </Button>
            <Button onClick={() => void send()} loading={pending} loadingLabel={t('report.send')}>
              {t('report.send')}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
      <Reveal show={sent !== null}>
        <Alert tone={sent === 'sent' ? 'success' : 'info'}>{sent === 'sent' ? t('report.sent') : t('sample.actionNoop')}</Alert>
      </Reveal>
    </div>
  );
}
