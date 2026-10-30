import { HandPalm } from '@phosphor-icons/react/dist/ssr';
import { Button, MotionFeatures, cn } from '@nestself/ui';
import { useTranslation } from 'react-i18next';
import { useWebinarStage } from '../hooks/useWebinarStage';
import type { WebinarClientApi } from '../webinar/types';
import { Announcer, ErrorStack } from './WebinarStageParts';
import { useChangeAnnouncement, useErrorMessages } from './WebinarStageHooks';

export interface HandRaiseButtonProps {
  /** An attendee's webinar client: raising posts `POST /webinars/:id/hand`, which reaches the moderation room. */
  client: WebinarClientApi;
  /** Show the label next to the icon; otherwise it is for screen readers only. */
  showLabel?: boolean;
  /** A failure from outside, already translated. */
  error?: string | null;
  className?: string;
}

/**
 * Raise and lower the hand to ask for the floor (WBN-10, UX-27). The label
 * says what pressing does ("Raise hand", "Lower hand"; no `aria-pressed`, so
 * the name and the state never contradict), the raised look is filled, and
 * the change is announced. Raising reaches the hosts only, through the moderation room;
 * other attendees never learn of it (D-CW-15). A failure stays on screen.
 */
export function HandRaiseButton({ client, showLabel = true, error, className }: HandRaiseButtonProps) {
  const { t } = useTranslation('calls');
  const stage = useWebinarStage(client);
  const raised = stage.myHand.raised;
  const pending = stage.isPending('hand.raise') || stage.isPending('hand.lower');
  const errors = useErrorMessages(error, stage.errorOf('hand'));
  const announcement = useChangeAnnouncement(raised, (_, next) => t(next ? 'webinar.hand.raised' : 'webinar.hand.lowered'));
  const label = raised ? t('webinar.hand.lower') : t('webinar.hand.raise');

  return (
    <div className={cn('gap-2 flex flex-col items-center', className)}>
      <Button
        variant={raised ? 'primary' : 'secondary'}
        size="sm"
        data-state={raised ? 'raised' : 'lowered'}
        data-testid="webinar-hand-raise"
        loading={pending}
        loadingLabel={label}
        onClick={() => {
          void stage.toggleHand().catch(() => undefined);
        }}
        className="min-h-11 min-w-11 px-3 pointer-coarse:min-h-12 pointer-coarse:min-w-12"
        leadingIcon={<HandPalm size={22} weight={raised ? 'fill' : 'bold'} />}
      >
        <span className={cn(!showLabel && 'sr-only')}>{label}</span>
      </Button>
      <MotionFeatures>
        <ErrorStack messages={errors} testId="webinar-hand-error" />
      </MotionFeatures>
      <Announcer announcement={announcement} testId="webinar-hand-announcer" />
    </div>
  );
}
