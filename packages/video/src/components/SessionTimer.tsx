import { Clock, X } from '@phosphor-icons/react/dist/ssr';
import { CALL_ROOM_CLOSE_AFTER_MINUTES } from '@nestself/contracts';
import type { CallParticipantRole } from '@nestself/contracts';
import { AnimatePresence, IconButton, LiveRegion, MotionFeatures, cn, m, useMotionPreset } from '@nestself/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock } from './format-clock';

export interface SessionTimerProps {
  /** Scheduled window from the join response (ISO date-times). */
  startsAt: string;
  endsAt: string;
  /** The expert's five-minute cue adds the follow-up reminder (D-CW-37). */
  participantRole: CallParticipantRole;
  /** Called once when the room closes, `CALL_ROOM_CLOSE_AFTER_MINUTES` after `endsAt`. */
  onRoomClose?: () => void;
  className?: string;
}

const MINUTE = 60_000;
/** The five-minute cue (UX-15). */
const CUE_BEFORE_END_MS = 5 * MINUTE;
/** The room-closing warning starts this long before the room closes (CALL-13). */
const CLOSE_WARNING_MS = 5 * MINUTE;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Elapsed and remaining time, a dismissable "five minutes left" cue (UX-15)
 * that also reminds the expert of the post-call follow-up (D-CW-37), the
 * end-of-session notice and the room-closing warning (CALL-13, D-CW-09).
 */
export function SessionTimer({ startsAt, endsAt, participantRole, onRoomClose, className }: SessionTimerProps) {
  const { t } = useTranslation('calls');
  const now = useNow();
  const [dismissed, setDismissed] = useState(false);
  const cueMotion = useMotionPreset('popover');
  const closedRef = useRef(false);

  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const closeAt = end + CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE;
  const remaining = end - now;
  const showCue = !dismissed && remaining > 0 && remaining <= CUE_BEFORE_END_MS;
  const ended = remaining <= 0;
  const closingIn = closeAt - now;
  const closing = closingIn > 0 && closingIn <= CLOSE_WARNING_MS;

  useEffect(() => {
    if (closingIn > 0 || closedRef.current) return;
    closedRef.current = true;
    onRoomClose?.();
  }, [closingIn, onRoomClose]);

  return (
    <div className={cn('gap-2 flex flex-col items-start', className)}>
      <div
        role="timer"
        aria-label={t('timer.label')}
        className="gap-2 px-3 py-1 inline-flex flex-wrap items-center rounded-pill bg-surface text-text type-metadata tabular-nums"
      >
        <Clock size={16} aria-hidden />
        <span>{t('timer.elapsed', { time: formatClock(now - start) })}</span>
        <span aria-hidden>·</span>
        <span className={cn(ended ? 'text-danger' : remaining <= CUE_BEFORE_END_MS && 'text-warning', 'font-[var(--font-weight-label)]')}>
          {t('timer.remaining', { time: formatClock(remaining) })}
        </span>
      </div>
      <LiveRegion politeness="polite">
        <MotionFeatures>
          <AnimatePresence>
            {showCue ? (
              <m.div
                key="cue"
                {...cueMotion}
                className="gap-2 py-2 pl-4 pr-1 flex max-w-96 items-start rounded-control bg-warning-surface text-text shadow-menu origin-top-left"
              >
                <div className="pt-2.5 min-w-0 flex-1">
                  <p className="type-label">{t('consultation.fiveMinutesRemaining')}</p>
                  {participantRole === 'expert' ? <p className="mt-1 type-metadata">{t('timer.followUpHint')}</p> : null}
                </div>
                <IconButton label={t('timer.dismiss')} icon={<X size={18} />} onClick={() => setDismissed(true)} />
              </m.div>
            ) : null}
            {ended && !closing ? (
              <m.p key="ended" {...cueMotion} className="px-4 py-2 rounded-control bg-surface text-text shadow-menu type-label origin-top-left">
                {t('timer.timeEnded')}
              </m.p>
            ) : null}
            {closing ? (
              <m.p key="closing" {...cueMotion} className="px-4 py-2 rounded-control bg-danger-surface text-danger shadow-menu type-label origin-top-left">
                {t('timer.roomClosing', { count: Math.ceil(closingIn / MINUTE) })}
              </m.p>
            ) : null}
          </AnimatePresence>
        </MotionFeatures>
      </LiveRegion>
    </div>
  );
}
