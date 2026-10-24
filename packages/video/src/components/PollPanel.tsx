import { ChartBar, Check } from '@phosphor-icons/react/dist/ssr';
import type { WebinarPoll, WebinarPollResults } from '@nestself/contracts';
import { AnimatePresence, Badge, Button, MotionFeatures, RadioGroup, RadioItem, cn, m, useMotionPreset } from '@nestself/ui';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebinarStage } from '../hooks/useWebinarStage';
import type { UseWebinarStageResult } from '../hooks/useWebinarStage';
import type { WebinarClientApi } from '../webinar/types';
import { Announcer, ErrorStack } from './WebinarStageParts';
import { useChangeAnnouncement, useErrorMessages } from './WebinarStageHooks';

export interface PollPanelProps {
  /** The viewer's webinar client: attendees vote, the moderator opens and closes, presenters watch. */
  client: WebinarClientApi;
  /** A failure from outside (loading the polls), already translated. */
  error?: string | null;
  className?: string;
}

type PollState = 'prepared' | 'open' | 'closed';

function stateOf(poll: WebinarPoll): PollState {
  if (poll.closedAt) return 'closed';
  return poll.openedAt ? 'open' : 'prepared';
}

const sortedOptions = (poll: WebinarPoll) => [...poll.options].sort((a, b) => a.position - b.position);

/** Aggregate results as percentages (WBN-11): counts per option only, never a voter. */
function PollResultsView({ poll, results }: { poll: WebinarPoll; results: WebinarPollResults }) {
  const { t, i18n } = useTranslation('calls');
  const percent = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, { style: 'percent', maximumFractionDigits: 0 });
  const counts = new Map(results.results.map((entry) => [entry.optionId, entry.count]));
  return (
    <div data-testid="webinar-poll-results" className="gap-3 flex flex-col">
      <p className="type-label">{t('webinar.poll.results')}</p>
      <ul className="gap-3 flex flex-col">
        {sortedOptions(poll).map((option) => {
          const share = results.totalVotes > 0 ? (counts.get(option.id) ?? 0) / results.totalVotes : 0;
          return (
            <li key={option.id} className="gap-1 flex flex-col" data-testid="webinar-poll-result">
              <span className="gap-3 flex justify-between type-body">
                <span>{option.label}</span>
                <span className="font-[var(--font-weight-label)]">{percent.format(share)}</span>
              </span>
              <span aria-hidden className="h-2 w-full overflow-hidden rounded-pill bg-border-subtle">
                <span
                  className="block h-full rounded-pill bg-primary transition-[width] duration-[var(--motion-slow)] ease-standard motion-reduce:transition-none"
                  style={{ width: `${Math.round(share * 100)}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="type-metadata text-text-secondary">{t('webinar.poll.totalVotes', { count: results.totalVotes })}</p>
    </div>
  );
}

/** One vote per poll; the button is disabled once this viewer voted (WEB-35: the vote carries no voter). */
function VoteForm({ poll, stage }: { poll: WebinarPoll; stage: UseWebinarStageResult }) {
  const { t } = useTranslation('calls');
  const notice = useMotionPreset('popover');
  const voted = stage.polls.votes[poll.id] ?? null;
  const [choice, setChoice] = useState<string | null>(voted);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const errorId = useId();
  const pending = stage.isPending('poll.vote', poll.id);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!choice) return setFieldError(t('webinar.poll.chooseOption'));
    setFieldError(null);
    void stage.vote(poll.id, choice).catch(() => undefined);
  };

  return (
    <form onSubmit={submit} noValidate className="gap-3 flex flex-col" aria-describedby={fieldError ? errorId : undefined}>
      <RadioGroup
        label={t('webinar.poll.optionsLabel')}
        value={voted ?? choice ?? ''}
        onValueChange={(value) => {
          setChoice(value);
          setFieldError(null);
        }}
        disabled={voted !== null || pending}
      >
        {sortedOptions(poll).map((option) => (
          <RadioItem key={option.id} value={option.id}>
            {option.label}
          </RadioItem>
        ))}
      </RadioGroup>
      {fieldError ? (
        <p id={errorId} className="type-metadata text-danger">
          {fieldError}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={voted !== null}
        loading={pending}
        loadingLabel={t('webinar.chat.sending')}
        leadingIcon={voted ? <Check size={18} /> : undefined}
        className="self-start"
        data-testid="webinar-poll-vote"
      >
        {voted ? t('webinar.poll.votedButton') : t('webinar.poll.vote')}
      </Button>
      <AnimatePresence initial={false}>
        {voted ? (
          <m.p key="voted" {...notice} role="status" data-testid="webinar-poll-voted" className="p-3 rounded-control bg-success-surface text-success type-metadata origin-top">
            {t('webinar.poll.voted')}
          </m.p>
        ) : null}
      </AnimatePresence>
    </form>
  );
}

function PollCard({ poll, stage }: { poll: WebinarPoll; stage: UseWebinarStageResult }) {
  const { t } = useTranslation('calls');
  const state = stateOf(poll);
  const results = stage.polls.results[poll.id] ?? null;
  const anotherOpen = stage.activePoll !== null && stage.activePoll.id !== poll.id;
  return (
    <article data-testid="webinar-poll-card" data-state={state} className="gap-3 p-4 flex flex-col rounded-card border border-border-subtle bg-surface">
      <div className="gap-2 flex flex-wrap items-center justify-between">
        <h3 className="type-label">{poll.question}</h3>
        <Badge tone={state === 'open' ? 'success' : 'neutral'}>
          {state === 'open' ? t('webinar.poll.statusOpen') : state === 'closed' ? t('webinar.poll.statusClosed') : t('webinar.poll.statusPrepared')}
        </Badge>
      </div>
      {state === 'open' && stage.role === 'attendee' ? <VoteForm poll={poll} stage={stage} /> : null}
      {state === 'open' && stage.isHost ? (
        <ul className="gap-1 flex flex-col type-body">
          {sortedOptions(poll).map((option) => (
            <li key={option.id}>{option.label}</li>
          ))}
        </ul>
      ) : null}
      {state === 'closed' && results ? <PollResultsView poll={poll} results={results} /> : null}
      {stage.isModerator && state !== 'closed' ? (
        <div className="gap-2 flex flex-wrap">
          {state === 'prepared' ? (
            <Button size="sm" disabled={anotherOpen} loading={stage.isPending('poll.open', poll.id)} loadingLabel={t('webinar.chat.sending')} onClick={() => void stage.openPoll(poll.id).catch(() => undefined)}>
              {t('webinar.poll.open')}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" loading={stage.isPending('poll.close', poll.id)} loadingLabel={t('webinar.chat.sending')} onClick={() => void stage.closePoll(poll.id).catch(() => undefined)}>
              {t('webinar.poll.close')}
            </Button>
          )}
        </div>
      ) : null}
      {stage.role === 'attendee' ? <p className="type-metadata text-text-secondary">{t('webinar.poll.anonymous')}</p> : null}
    </article>
  );
}

/**
 * Webinar polls (WBN-11, WBN-27). Attendees see the open poll, vote once and
 * see the aggregate as percentages after the close; the moderator opens and
 * closes prepared polls; presenters follow along. Poll cards animate in and
 * out, and opening and closing are announced (WBN-15). No voter id exists
 * anywhere in this state (D-CW-16).
 */
export function PollPanel({ client, error, className }: PollPanelProps) {
  const { t } = useTranslation('calls');
  const stage = useWebinarStage(client);
  const cardMotion = useMotionPreset('popover');
  const titleId = useId();
  const errors = useErrorMessages(error, stage.errorOf('poll'));
  const polls = stage.isModerator ? stage.polls.list : stage.currentPoll ? [stage.currentPoll] : [];

  const current = stage.currentPoll;
  const key = current ? `${current.id}:${stateOf(current)}` : 'none';
  const announcement = useChangeAnnouncement(key, (_, next) => {
    if (!current || next === 'none') return null;
    return stateOf(current) === 'closed' ? t('webinar.poll.closed') : t('webinar.poll.opened', { question: current.question });
  });

  return (
    <MotionFeatures>
      <section aria-labelledby={titleId} className={cn('gap-3 p-4 flex flex-col rounded-card border border-border-subtle bg-surface text-text', className)} data-testid="webinar-poll-panel">
        <h2 id={titleId} className="gap-2 flex items-center type-section-title">
          <ChartBar size={22} aria-hidden />
          {t('webinar.poll.title')}
        </h2>
        <ErrorStack messages={errors} testId="webinar-poll-error" />
        {polls.length === 0 ? (
          <p className="type-body text-text-secondary">{stage.isModerator ? t('webinar.poll.noPolls') : t('webinar.poll.none')}</p>
        ) : null}
        <AnimatePresence initial={false}>
          {polls.map((poll) => (
            <m.div key={poll.id} {...cardMotion} className="origin-top">
              <PollCard poll={poll} stage={stage} />
            </m.div>
          ))}
        </AnimatePresence>
        <Announcer announcement={announcement} testId="webinar-poll-announcer" />
      </section>
    </MotionFeatures>
  );
}
