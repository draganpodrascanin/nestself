import { HandPalm, MicrophoneStage, Record, StopCircle, UsersThree } from '@phosphor-icons/react/dist/ssr';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTrigger,
  AnimatePresence,
  Badge,
  Button,
  MotionFeatures,
  cn,
  m,
  useMotionPreset,
} from '@nestself/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebinarStage } from '../hooks/useWebinarStage';
import type { UseWebinarStageResult } from '../hooks/useWebinarStage';
import type { WebinarClientApi, WebinarHand, WebinarSpeaker } from '../webinar/types';
import { ModerationMessageCard } from './ChatPanelMessage';
import { useChangeAnnouncement, useErrorMessages, useShortTime } from './WebinarStageHooks';
import { Announcer, ErrorStack } from './WebinarStageParts';

export interface ModeratorQueueProps {
  /**
   * A host's webinar client. The moderator sees names, gives the floor and
   * reviews messages; a presenter sees how many hands are raised and who has
   * the floor (by participant, never by name) and can take the floor back.
   */
  client: WebinarClientApi;
  /** A failure from outside (loading the queue), already translated. */
  error?: string | null;
  className?: string;
}

function messageBusy(stage: UseWebinarStageResult, messageId: string): 'publish' | 'answer' | 'dismiss' | null {
  if (stage.isPending('message.publish', messageId)) return 'publish';
  if (stage.isPending('message.answer', messageId)) return 'answer';
  if (stage.isPending('message.dismiss', messageId)) return 'dismiss';
  return null;
}

function HandItem({ hand, stage }: { hand: WebinarHand; stage: UseWebinarStageResult }) {
  const { t } = useTranslation('calls');
  const time = useShortTime();
  const textId = useId();
  const who = hand.name ?? t('webinar.handRaisedPresenter');
  return (
    <div data-testid="webinar-queue-hand" className="gap-3 p-3 flex flex-wrap items-center justify-between rounded-card border border-border-subtle bg-surface">
      <p id={textId} className="gap-0.5 flex flex-col">
        <span className="gap-2 flex items-center type-body font-[var(--font-weight-label)]">
          <HandPalm size={18} weight="fill" aria-hidden />
          {who}
        </span>
        <span className="type-metadata text-text-secondary">{t('webinar.moderation.raisedAt', { time: time(hand.raisedAt) })}</span>
      </p>
      <Button
        size="sm"
        leadingIcon={<MicrophoneStage size={18} />}
        aria-label={hand.name ? t('webinar.moderation.giveFloorTo', { name: hand.name }) : undefined}
        aria-describedby={hand.name ? undefined : textId}
        loading={stage.isPending('floor.give', hand.participantId)}
        loadingLabel={t('webinar.chat.sending')}
        onClick={() => void stage.giveFloor(hand.participantId).catch(() => undefined)}
      >
        {t('webinar.moderation.giveFloor')}
      </Button>
    </div>
  );
}

function SpeakerItem({ speaker, stage }: { speaker: WebinarSpeaker; stage: UseWebinarStageResult }) {
  const { t } = useTranslation('calls');
  const name = speaker.name ?? t('webinar.chat.participant');
  return (
    <div data-testid="webinar-queue-speaker" className="gap-3 p-3 flex flex-wrap items-center justify-between rounded-card bg-info-surface text-info">
      <span className="gap-2 flex items-center type-body font-[var(--font-weight-label)]">
        <MicrophoneStage size={18} weight="fill" aria-hidden />
        {name}
      </span>
      <Button
        size="sm"
        variant="secondary"
        aria-label={t('webinar.moderation.takeFloorFrom', { name })}
        loading={stage.isPending('floor.take', speaker.participantId)}
        loadingLabel={t('webinar.chat.sending')}
        onClick={() => void stage.takeFloor(speaker.participantId).catch(() => undefined)}
      >
        {t('webinar.moderation.takeFloor')}
      </Button>
    </div>
  );
}

/** The moderator's early stop (D-CW-18, WBN-28): confirm first; start is automatic, so there is no restart. */
function StopRecording({ stage }: { stage: UseWebinarStageResult }) {
  const { t } = useTranslation('calls');
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button size="sm" variant="secondary" leadingIcon={<StopCircle size={18} />} loading={stage.isPending('recording.stop')} loadingLabel={t('webinar.chat.sending')}>
          {t('webinar.moderation.stopRecording')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        title={t('webinar.moderation.stopRecordingTitle')}
        description={t('webinar.moderation.stopRecordingBody')}
        confirmLabel={t('webinar.moderation.stopRecording')}
        cancelLabel={t('webinar.moderation.keepRecording')}
        destructive
        confirmPending={stage.isPending('recording.stop')}
        onConfirm={() => void stage.stopRecording().catch(() => undefined)}
      >
        <span hidden data-testid="webinar-stop-recording-dialog" />
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The hosts' queue (WBN-10, WBN-19, WBN-23 to WBN-25, WBN-28): the attendance
 * count (a number, never names), the recording state with the moderator's
 * early stop, attendees speaking now with "take the floor back", raised
 * hands (the moderator sees the registration name and gives the floor; a
 * presenter, who never receives names, sees "a participant asked to speak"
 * and the count), and for the moderator the messages waiting for review with
 * publish, edit, answer and dismiss. Items animate in and out; arrivals and
 * actions are announced (WBN-15).
 */
export function ModeratorQueue({ client, error, className }: ModeratorQueueProps) {
  const { t } = useTranslation('calls');
  const stage = useWebinarStage(client);
  const itemMotion = useMotionPreset('popover');
  const titleId = useId();
  const errors = useErrorMessages(error, stage.errorOf('moderation'), stage.errorOf('floor'), stage.errorOf('recording'));

  const pendingIds = stage.pendingMessages.map((message) => message.id);
  const handKeys = stage.isModerator ? stage.hands.map((hand) => hand.participantId) : Array.from({ length: stage.raisedHandCount }, (_, i) => `hand-${i}`);
  const key = [pendingIds.join(','), handKeys.join(','), stage.speakers.map((s) => s.participantId).join(',')].join('|');
  const announcement = useChangeAnnouncement(key, (previous, next) => {
    const parse = (value: string) => value.split('|').map((part) => part.split(',').filter(Boolean));
    const [prevPending = [], prevHands = [], prevSpeakers = []] = parse(previous);
    const [nextPending = [], nextHands = [], nextSpeakers = []] = parse(next);
    const added = (before: string[], after: string[]) => after.filter((id) => !before.includes(id));
    if (added(prevSpeakers, nextSpeakers).length > 0) return t('webinar.moderation.announce.floorGiven');
    if (added(nextSpeakers, prevSpeakers).length > 0) return t('webinar.moderation.announce.floorTaken');
    const reviewed = added(nextPending, prevPending).at(-1);
    const status = stage.moderationMessages.find((message) => message.id === reviewed)?.status;
    if (status === 'published') return t('webinar.moderation.announce.published');
    if (status === 'answered') return t('webinar.moderation.announce.answered');
    if (status === 'dismissed') return t('webinar.moderation.announce.dismissed');
    if (added(prevPending, nextPending).length > 0) return t('webinar.moderation.announce.submitted');
    if (added(prevHands, nextHands).length > 0) return t('webinar.moderation.announce.handRaised');
    return null;
  });

  if (!stage.isHost) return null;
  const attendance = stage.attendanceCount ?? '–';

  return (
    <MotionFeatures>
      <section aria-labelledby={titleId} className={cn('gap-4 p-4 flex flex-col rounded-card border border-border-subtle bg-raised text-text', className)} data-testid="webinar-moderator-queue">
        <div className="gap-3 flex flex-wrap items-center justify-between">
          <h2 id={titleId} className="type-section-title">
            {t('webinar.moderation.title')}
          </h2>
          <div className="gap-2 flex flex-wrap items-center">
            <Badge>
              <UsersThree size={16} aria-hidden />
              <span data-testid="webinar-queue-attendance">{t('webinar.attendance', { count: attendance })}</span>
            </Badge>
            {stage.isRecording ? (
              <Badge tone="danger">
                <Record size={16} weight="fill" aria-hidden />
                {t('webinar.recording')}
              </Badge>
            ) : (
              <Badge>{t('webinar.moderation.recordingOff')}</Badge>
            )}
            {stage.isModerator && stage.isRecording ? <StopRecording stage={stage} /> : null}
          </div>
        </div>

        <ErrorStack messages={errors} testId="webinar-queue-error" />

        <AnimatePresence initial={false}>
          {stage.speakers.length > 0 ? (
            <m.section key="speakers" {...itemMotion} aria-label={t('webinar.moderation.speakingTitle')} className="gap-2 flex flex-col origin-top" data-testid="webinar-queue-speakers">
              <h3 className="type-label">{t('webinar.moderation.speakingTitle')}</h3>
              {stage.speakers.map((speaker) => (
                <SpeakerItem key={speaker.participantId} speaker={speaker} stage={stage} />
              ))}
            </m.section>
          ) : null}
        </AnimatePresence>

        <section aria-label={t('webinar.moderation.handsTitle')} className="gap-2 flex flex-col">
          <h3 className="type-label">{t('webinar.moderation.handsTitle')}</h3>
          {stage.raisedHandCount === 0 ? <p className="type-metadata text-text-secondary">{t('webinar.moderation.handsEmpty')}</p> : null}
          {stage.isModerator ? (
            <ul className="gap-2 flex flex-col">
              <AnimatePresence initial={false}>
                {stage.hands.map((hand) => (
                  <m.li key={hand.participantId} {...itemMotion} className="origin-top">
                    <HandItem hand={hand} stage={stage} />
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
          ) : (
            <AnimatePresence initial={false}>
              {stage.raisedHandCount > 0 ? (
                <m.p
                  key="hand-count"
                  {...itemMotion}
                  data-testid="webinar-queue-hand-count"
                  className="gap-2 p-3 flex flex-wrap items-center justify-between rounded-card border border-border-subtle bg-surface origin-top"
                >
                  <span className="gap-2 flex items-center type-body font-[var(--font-weight-label)]">
                    <HandPalm size={18} weight="fill" aria-hidden />
                    {t('webinar.handRaisedPresenter')}
                  </span>
                  <Badge>{t('webinar.handCount', { count: stage.raisedHandCount })}</Badge>
                </m.p>
              ) : null}
            </AnimatePresence>
          )}
        </section>

        {stage.isModerator ? (
          <section aria-label={t('webinar.moderation.pendingTitle')} className="gap-2 flex flex-col">
            <h3 className="type-label">{t('webinar.moderation.pendingTitle')}</h3>
            {stage.pendingMessages.length === 0 ? <p className="type-metadata text-text-secondary">{t('webinar.moderation.pendingEmpty')}</p> : null}
            <ul className="gap-2 flex flex-col">
              <AnimatePresence initial={false}>
                {stage.pendingMessages.map((message) => (
                  <m.li key={message.id} {...itemMotion} className="origin-top">
                    <ModerationMessageCard
                      message={message}
                      busy={messageBusy(stage, message.id)}
                      onPublish={(text) => stage.publish(message.id, text)}
                      onAnswer={(answerText) => stage.answer(message.id, answerText)}
                      onDismiss={() => stage.dismiss(message.id)}
                    />
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ) : null}

        <Announcer announcement={announcement} testId="webinar-queue-announcer" />
      </section>
    </MotionFeatures>
  );
}
