import { CalendarPlus, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import {
  FOLLOW_UP_DURATION_MAX_MINUTES,
  FOLLOW_UP_DURATION_MIN_MINUTES,
  FOLLOW_UP_MAX_SUGGESTED_WINDOWS,
  FollowUpProposeRequestSchema,
  FollowUpSuggestTimesRequestSchema,
} from '@nestself/contracts';
import type { FollowUpProposeRequest, FollowUpSuggestTimesRequest } from '@nestself/contracts';
import { Alert, AnimatePresence, Button, Field, IconButton, Input, MotionFeatures, Select, cn, m, useMotionPreset } from '@nestself/ui';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatInZone, zonedDateTimeToIso } from '../time-zone';

/** A proposal as the card shows it; the shape of `FollowUpProposeRequest`. */
export interface FollowUpProposal {
  startsAt: string;
  durationMinutes: number;
  timeZone: string;
}

interface FollowUpCardCommonProps {
  /** The request for the current action is in flight. */
  pending?: boolean;
  /** A failed action, already translated (error-visibility rule). */
  error?: string | null;
  className?: string;
}

export type ExpertFollowUpStatus = 'idle' | 'proposed' | 'confirmed' | 'declined';
export type EmployeeFollowUpStatus = 'no_proposal' | 'proposed' | 'awaiting_approval' | 'confirmed' | 'declined';

export interface ExpertFollowUpCardProps extends FollowUpCardCommonProps {
  variant: 'expert';
  status: ExpertFollowUpStatus;
  /** The appointment's time zone; the picker works in it (D-CW-37). */
  timeZone: string;
  /** This session's duration, the default for the follow-up. */
  defaultDurationMinutes: number;
  /** The proposal once sent, for the proposed and confirmed states. */
  proposal?: FollowUpProposal | null;
  /** `POST /appointments/:id/follow-up` body: `{ startsAt, durationMinutes, timeZone }`. */
  onPropose: (request: FollowUpProposeRequest) => void;
}

export interface EmployeeFollowUpCardProps extends FollowUpCardCommonProps {
  variant: 'employee';
  status: EmployeeFollowUpStatus;
  proposal: FollowUpProposal | null;
  /** The employee already sent alternative windows; the expert picks one. */
  timesSuggested?: boolean;
  onConfirm: () => void;
  /** `POST /appointments/:id/suggest-times` body: one to three `{ startsAt, endsAt }` windows. */
  onSuggestTimes: (request: FollowUpSuggestTimesRequest) => void;
  onDecline: () => void;
}

export type FollowUpCardProps = ExpertFollowUpCardProps | EmployeeFollowUpCardProps;

const DURATION_STEP = 15;

function durationOptions(defaultMinutes: number): number[] {
  const clamped = Math.min(FOLLOW_UP_DURATION_MAX_MINUTES, Math.max(FOLLOW_UP_DURATION_MIN_MINUTES, Math.round(defaultMinutes)));
  const steps: number[] = [];
  for (let minutes = FOLLOW_UP_DURATION_MIN_MINUTES; minutes <= FOLLOW_UP_DURATION_MAX_MINUTES; minutes += DURATION_STEP) steps.push(minutes);
  return [...new Set([...steps, clamped])].sort((a, b) => a - b);
}

function useProposalText(proposal: FollowUpProposal | null | undefined) {
  const { t, i18n } = useTranslation('calls');
  if (!proposal) return null;
  const { date, time } = formatInZone(proposal.startsAt, proposal.timeZone, i18n.resolvedLanguage ?? i18n.language);
  return { date, time, duration: t('followUp.durationOption', { count: proposal.durationMinutes }) };
}

function ExpertBody({ status, timeZone, defaultDurationMinutes, proposal, onPropose, pending }: ExpertFollowUpCardProps) {
  const { t } = useTranslation('calls');
  const options = durationOptions(defaultDurationMinutes);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(String(options.find((value) => value === Math.round(defaultDurationMinutes)) ?? options[0]));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const text = useProposalText(proposal);

  if (status !== 'idle') {
    return (
      <div className="gap-1 flex flex-col">
        {status === 'proposed' && text ? (
          <>
            <p className="type-body text-text">{t('followUp.proposedFor', text)}</p>
            <p className="type-metadata text-text-secondary">{t('followUp.waitingForEmployee')}</p>
          </>
        ) : null}
        {status === 'confirmed' && text ? <p className="type-body text-text">{t('followUp.confirmedFor', text)}</p> : null}
        {status === 'declined' ? <p className="type-body text-text">{t('followUp.declinedByEmployee')}</p> : null}
      </div>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const startsAt = zonedDateTimeToIso(date, time, timeZone);
    if (!startsAt) {
      setFieldError(t('followUp.errors.dateTimeRequired'));
      return;
    }
    if (Date.parse(startsAt) <= Date.now()) {
      setFieldError(t('followUp.errors.past'));
      return;
    }
    const parsed = FollowUpProposeRequestSchema.safeParse({ startsAt, durationMinutes: Number(duration), timeZone });
    if (!parsed.success) {
      setFieldError(t('followUp.errors.dateTimeRequired'));
      return;
    }
    setFieldError(null);
    onPropose(parsed.data);
  };

  return (
    <form noValidate onSubmit={submit} className="gap-4 flex flex-col">
      <p className="type-body text-text">{t('followUp.expertNote')}</p>
      <div className="gap-4 grid sm:grid-cols-3">
        <Field label={t('followUp.date')} error={fieldError ?? undefined}>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </Field>
        <Field label={t('followUp.time')}>
          <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
        </Field>
        <Field label={t('followUp.duration')}>
          <Select
            options={options.map((minutes) => ({ value: String(minutes), label: t('followUp.durationOption', { count: minutes }) }))}
            value={duration}
            onValueChange={(value) => value && setDuration(value)}
          />
        </Field>
      </div>
      <p className="type-metadata text-text-secondary">{t('followUp.timeZoneNote', { timeZone })}</p>
      <div>
        <Button type="submit" loading={pending} loadingLabel={t('followUp.sending')} leadingIcon={<CalendarPlus size={18} />}>
          {t('followUp.send')}
        </Button>
      </div>
    </form>
  );
}

interface WindowDraft {
  id: number;
  date: string;
  from: string;
  to: string;
}

function SuggestTimesForm({ timeZone, pending, onSubmit, onCancel }: { timeZone: string; pending: boolean; onSubmit: (request: FollowUpSuggestTimesRequest) => void; onCancel: () => void }) {
  const { t } = useTranslation('calls');
  const legendId = useId();
  const [windows, setWindows] = useState<WindowDraft[]>([{ id: 1, date: '', from: '', to: '' }]);
  const [nextId, setNextId] = useState(2);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const change = (id: number, patch: Partial<WindowDraft>) =>
    setWindows((current) => current.map((window) => (window.id === id ? { ...window, ...patch } : window)));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<number, string> = {};
    const converted = windows.map((window) => {
      const startsAt = zonedDateTimeToIso(window.date, window.from, timeZone);
      const endsAt = zonedDateTimeToIso(window.date, window.to, timeZone);
      if (!startsAt || !endsAt) nextErrors[window.id] = t('followUp.errors.dateTimeRequired');
      else if (Date.parse(endsAt) <= Date.parse(startsAt)) nextErrors[window.id] = t('followUp.errors.endBeforeStart');
      else if (Date.parse(startsAt) <= Date.now()) nextErrors[window.id] = t('followUp.errors.past');
      return { startsAt: startsAt ?? '', endsAt: endsAt ?? '' };
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const parsed = FollowUpSuggestTimesRequestSchema.safeParse({ windows: converted });
    if (parsed.success) onSubmit(parsed.data);
  };

  return (
    <form noValidate onSubmit={submit}>
      <fieldset aria-labelledby={legendId} className="gap-4 m-0 p-0 flex flex-col border-0">
        <legend id={legendId} className="mb-2 type-label text-text">
          {t('followUp.suggestTitle')}
        </legend>
        {windows.map((window, index) => (
          <fieldset key={window.id} className="gap-3 p-4 m-0 grid rounded-control border border-border-subtle sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <legend className="px-1 type-metadata text-text-secondary">{t('followUp.window', { index: index + 1 })}</legend>
            <Field label={t('followUp.date')} error={errors[window.id]}>
              <Input type="date" value={window.date} onChange={(event) => change(window.id, { date: event.target.value })} />
            </Field>
            <Field label={t('followUp.from')}>
              <Input type="time" value={window.from} onChange={(event) => change(window.id, { from: event.target.value })} />
            </Field>
            <Field label={t('followUp.to')}>
              <Input type="time" value={window.to} onChange={(event) => change(window.id, { to: event.target.value })} />
            </Field>
            {windows.length > 1 ? (
              <IconButton
                label={t('followUp.removeWindow', { index: index + 1 })}
                icon={<Trash size={18} />}
                onClick={() => setWindows((current) => current.filter((item) => item.id !== window.id))}
              />
            ) : null}
          </fieldset>
        ))}
        <p className="type-metadata text-text-secondary">{t('followUp.timeZoneNote', { timeZone })}</p>
        <div className="gap-3 flex flex-wrap">
          {windows.length < FOLLOW_UP_MAX_SUGGESTED_WINDOWS ? (
            <Button
              variant="ghost"
              leadingIcon={<Plus size={18} />}
              onClick={() => {
                setWindows((current) => [...current, { id: nextId, date: '', from: '', to: '' }]);
                setNextId((id) => id + 1);
              }}
            >
              {t('followUp.addWindow')}
            </Button>
          ) : null}
          <Button type="submit" loading={pending} loadingLabel={t('followUp.sending')}>
            {t('followUp.sendSuggestions')}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            {t('followUp.cancel')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function EmployeeBody({ status, proposal, timesSuggested, onConfirm, onSuggestTimes, onDecline, pending = false }: EmployeeFollowUpCardProps) {
  const { t } = useTranslation('calls');
  const [suggesting, setSuggesting] = useState(false);
  const disclosure = useMotionPreset('disclosure');
  const text = useProposalText(proposal);

  if (status === 'awaiting_approval') {
    return (
      <div className="gap-1 flex flex-col">
        <p className="type-label text-text">{t('followUp.awaitingApproval')}</p>
        {text ? <p className="type-body text-text">{t('followUp.proposalDetails', text)}</p> : null}
        <p className="type-metadata text-text-secondary">{t('followUp.awaitingApprovalBody')}</p>
      </div>
    );
  }
  if (status === 'confirmed') return text ? <p className="type-body text-text">{t('followUp.confirmedBody', text)}</p> : null;
  if (status === 'declined') return <p className="type-body text-text">{t('followUp.declinedByYou')}</p>;

  return (
    <div className="gap-4 flex flex-col">
      {text ? <p className="type-body-large text-text">{t('followUp.proposalDetails', text)}</p> : null}
      <p className="type-body text-text-secondary">{t('followUp.employeeNote')}</p>
      {timesSuggested ? <p className="type-metadata text-text">{t('followUp.timesSuggested')}</p> : null}
      <div className="gap-3 flex flex-wrap">
        <Button onClick={onConfirm} loading={pending && !suggesting} loadingLabel={t('followUp.sending')}>
          {t('followUp.confirm')}
        </Button>
        {!timesSuggested ? (
          <Button variant="secondary" aria-expanded={suggesting} onClick={() => setSuggesting((open) => !open)}>
            {t('followUp.suggestTimes')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDecline}>
          {t('followUp.decline')}
        </Button>
      </div>
      <AnimatePresence initial={false}>
        {suggesting && proposal ? (
          <m.div key="suggest" {...disclosure} className="overflow-hidden">
            <SuggestTimesForm timeZone={proposal.timeZone} pending={pending} onSubmit={onSuggestTimes} onCancel={() => setSuggesting(false)} />
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * The post-call follow-up card (D-CW-37). The expert proposes a date and
 * time in the appointment's time zone with a duration (this session's by
 * default) and a fixed, neutral note: there is no free-text field (D-22).
 * The employee confirms, suggests up to three other windows or declines.
 * The card animates in when it appears (a proposal arriving) and out when
 * it goes. Wiring to the API is the app's (T-CW-1.9).
 */
export function FollowUpCard(props: FollowUpCardProps) {
  const { t } = useTranslation('calls');
  const cardMotion = useMotionPreset('dialog');
  const noticeMotion = useMotionPreset('popover');
  const titleId = useId();
  const visible = props.variant === 'expert' || props.status !== 'no_proposal';
  const title =
    props.variant === 'expert'
      ? props.status === 'idle'
        ? t('followUp.expertTitle')
        : t('followUp.proposed')
      : t('followUp.employeeTitle');

  return (
    <MotionFeatures>
      <AnimatePresence>
        {visible ? (
          <m.section
            key={props.variant}
            {...cardMotion}
            aria-labelledby={titleId}
            className={cn('gap-4 p-6 pointer-coarse:p-4 flex w-full max-w-2xl flex-col rounded-card border border-border-subtle bg-surface shadow-low', props.className)}
          >
            <h2 id={titleId} className="type-section-title text-text">
              {title}
            </h2>
            <AnimatePresence>
              {props.error ? (
                <m.div key="error" {...noticeMotion} className="origin-top">
                  <Alert tone="danger">{props.error}</Alert>
                </m.div>
              ) : null}
            </AnimatePresence>
            {props.variant === 'expert' ? <ExpertBody {...props} /> : <EmployeeBody {...props} />}
          </m.section>
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}
