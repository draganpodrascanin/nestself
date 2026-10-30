import { ArrowsOutCardinal, CircleNotch, Eye, EyeSlash, UserCircle, VideoCameraSlash } from '@phosphor-icons/react/dist/ssr';
import {
  Alert,
  AnimatePresence,
  Button,
  MotionFeatures,
  MotionLayoutFeatures,
  cn,
  m,
  motionDuration,
  motionEase,
  reducedMotionPresets,
  useMotionPreset,
} from '@nestself/ui';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useCallSession } from '../hooks/useCallSession';
import { useVideoTiles } from '../hooks/useVideoTiles';
import type { CallSessionControllerApi } from '../types';

export type SelfViewCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface CallStageProps {
  controller: CallSessionControllerApi;
  /** The other participant's first name, for the video label (UX-09). */
  remoteName?: string;
  /** The other participant is in the call (from the call room events); without a video tile it means their camera is off. */
  remotePresent?: boolean;
  /** Top overlay: session timer, connection badge, crisis resources. */
  header?: ReactNode;
  /** Bottom overlay: the control bar. */
  controls?: ReactNode;
  /** Calls the join endpoint again after a failure (CALL-10). */
  onRejoin?: () => void;
  rejoinPending?: boolean;
  supportHref?: string;
  /** A failed rejoin, already translated (for example a closed join window). */
  error?: string | null;
  /**
   * What the stage says while the other participant has not joined. By
   * default the employee reads "Your expert will join shortly"
   * (`consultation.waiting`, CALL-05) and the expert a neutral sentence
   * (`consultation.waitingExpert`); `null` keeps the icon only, for a screen
   * that states the waiting status in its own panel.
   */
  waitingMessage?: string | null;
  /** The stage element. */
  ref?: Ref<HTMLElement>;
  /**
   * The document is fullscreen (`useFullscreen().isFullscreen`): the stage
   * pins itself to the viewport, and popups that portal to the body stay visible.
   */
  fullscreen?: boolean;
  className?: string;
}

/** Clockwise from the default: the button moves the self-view one corner on. */
const NEXT_CORNER: Record<SelfViewCorner, SelfViewCorner> = {
  'bottom-right': 'bottom-left',
  'bottom-left': 'top-left',
  'top-left': 'top-right',
  'top-right': 'bottom-right',
};

/** Corners leave room for the header and the control bar. */
const CORNER_CLASSES: Record<SelfViewCorner, string> = {
  'top-left': 'top-20 left-3',
  'top-right': 'top-20 right-3',
  'bottom-left': 'bottom-32 left-3',
  'bottom-right': 'bottom-32 right-3',
};

function TileVideo({ controller, tileId, label, className }: { controller: CallSessionControllerApi; tileId: number; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    controller.bindVideoTile(tileId, element);
    return () => controller.unbindVideoTile(tileId);
  }, [controller, tileId]);
  return <video ref={ref} aria-label={label} autoPlay muted playsInline className={className} />;
}

/**
 * Speaker view for a consultation (D-CW-22): the other participant's video
 * (or shared content) fills the stage, the self-view floats in a corner and
 * can be moved (drag, or the move button) and hidden (UX-10). At 390 px the
 * remote video fills the screen and the self-view floats (UX-20). Overlays
 * for connecting, failures with rejoin (CALL-10) and the end of the session
 * animate in and out.
 */
export function CallStage({
  controller,
  remoteName,
  remotePresent = false,
  header,
  controls,
  onRejoin,
  rejoinPending = false,
  supportHref,
  error,
  waitingMessage,
  ref,
  fullscreen = false,
  className,
}: CallStageProps) {
  const { t } = useTranslation('calls');
  const call = useCallSession(controller);
  const tiles = useVideoTiles(controller);
  const stageMotion = useMotionPreset('backdrop');
  const overlayMotion = useMotionPreset('dialog');
  const pipMotion = useMotionPreset('popover');
  const reduced = pipMotion === reducedMotionPresets.popover;
  const [corner, setCorner] = useState<SelfViewCorner>('bottom-right');
  const [selfViewHidden, setSelfViewHidden] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useImperativeHandle(ref, () => stageRef.current as HTMLElement, []);

  useEffect(() => {
    controller.bindAudio(audioRef.current);
    return () => controller.bindAudio(null);
  }, [controller]);

  const { status, failure, endReason } = call;
  const live = status === 'connected' || status === 'reconnecting';
  const waitingCopy = waitingMessage === undefined ? (call.role === 'employee' ? t('consultation.waiting') : t('consultation.waitingExpert')) : waitingMessage;
  const primaryLabel =
    tiles.contentTileId !== null
      ? t('stage.sharedScreen')
      : remoteName
        ? t('stage.remoteVideoNamed', { name: remoteName })
        : t('stage.remoteVideo');
  const overlay =
    status === 'joining'
      ? 'connecting'
      : status === 'failed'
        ? 'failed'
        : status === 'left' && endReason && endReason !== 'left'
          ? 'ended'
          : null;

  const failureCopy =
    failure === 'reconnect_timeout'
      ? { title: t('stage.reconnectFailedTitle'), body: t('stage.reconnectFailedBody') }
      : failure === 'connection_failed'
        ? { title: t('stage.connectionFailedTitle'), body: t('stage.connectionFailedBody') }
        : { title: t('stage.joinFailedTitle'), body: t('stage.joinFailedBody') };
  const endedCopy =
    endReason === 'removed' ? t('stage.removed') : endReason === 'joined_elsewhere' ? t('stage.joinedElsewhere') : t('consultation.sessionEnded');

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!start || !rect || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 12) return;
    const vertical = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
    const horizontal = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    setCorner(`${vertical}-${horizontal}`);
  };

  return (
    <MotionFeatures>
      <m.section
        {...stageMotion}
        ref={stageRef}
        aria-label={t('stage.label')}
        data-fullscreen={fullscreen || undefined}
        className={cn(
          'isolate overflow-hidden bg-canvas text-text',
          fullscreen ? 'fixed inset-0 z-[var(--z-sticky)] h-dvh w-screen' : 'relative h-full min-h-96 w-full',
          className,
        )}
      >
        {/* Live call audio; live captions are out of scope for this epic (D-CW-23). */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} autoPlay className="hidden" />

        {tiles.primaryTileId !== null ? (
          <TileVideo
            controller={controller}
            tileId={tiles.primaryTileId}
            label={primaryLabel}
            className={cn('absolute inset-0 h-full w-full bg-tint', tiles.contentTileId !== null ? 'object-contain' : 'object-cover md:object-contain')}
          />
        ) : live ? (
          <div className="gap-3 p-6 absolute inset-0 flex flex-col items-center justify-center text-center text-text-secondary">
            {remotePresent ? <VideoCameraSlash size={48} aria-hidden /> : <UserCircle size={48} aria-hidden />}
            {remotePresent ? (
              <p className="type-body-large">{t('stage.remoteCameraOff')}</p>
            ) : waitingCopy ? (
              <p className="type-body-large">{waitingCopy}</p>
            ) : null}
          </div>
        ) : null}

        <MotionLayoutFeatures>
          <AnimatePresence>
            {tiles.localTileId !== null && live ? (
              <m.div
                key="self-view"
                data-testid="self-view"
                data-corner={corner}
                layout={!reduced}
                transition={{ layout: { duration: motionDuration.standard, ease: motionEase } }}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                className={cn('absolute z-10 touch-none', CORNER_CLASSES[corner])}
              >
                {/* The self-view pops in and out with the popover preset; `propagate` runs its exit when the whole picture-in-picture leaves. */}
                <AnimatePresence mode="wait" propagate>
                  {selfViewHidden ? (
                    <m.div key="hidden" {...pipMotion} className="origin-center">
                      <Button variant="secondary" size="sm" leadingIcon={<Eye size={18} />} onClick={() => setSelfViewHidden(false)}>
                        {t('stage.showSelfView')}
                      </Button>
                    </m.div>
                  ) : (
                    <m.div
                      key="shown"
                      {...pipMotion}
                      className="relative w-28 overflow-hidden rounded-control border border-border-subtle bg-tint shadow-modal sm:w-44 origin-center"
                    >
                      <TileVideo controller={controller} tileId={tiles.localTileId} label={t('stage.selfView')} className="aspect-[3/4] w-full -scale-x-100 object-cover sm:aspect-video" />
                      <div className="gap-1 p-1 absolute inset-x-0 bottom-0 flex justify-end">
                        <button
                          type="button"
                          aria-label={t('stage.moveSelfView')}
                          onClick={() => setCorner(NEXT_CORNER[corner])}
                          className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-control bg-surface text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          <ArrowsOutCardinal size={18} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={t('stage.hideSelfView')}
                          onClick={() => setSelfViewHidden(true)}
                          className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-control bg-surface text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          <EyeSlash size={18} aria-hidden />
                        </button>
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>
              </m.div>
            ) : null}
          </AnimatePresence>
        </MotionLayoutFeatures>

        {header ? <div className="gap-2 p-3 absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between">{header}</div> : null}
        {controls ? (
          <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] absolute inset-x-0 bottom-0 z-20 flex justify-center">{controls}</div>
        ) : null}

        <AnimatePresence>
          {overlay === 'connecting' ? (
            <m.div
              key="connecting"
              role="status"
              {...overlayMotion}
              className="gap-3 p-6 absolute inset-0 z-30 m-auto flex h-fit w-[min(calc(100%-2rem),24rem)] items-center justify-center rounded-card bg-surface shadow-modal"
            >
              <CircleNotch size={24} className="motion-safe:animate-spin" aria-hidden />
              <p className="type-body">{t('stage.connecting')}</p>
            </m.div>
          ) : null}
          {overlay === 'failed' ? (
            <m.div
              key="failed"
              role="alert"
              {...overlayMotion}
              className="gap-4 p-6 absolute inset-0 z-30 m-auto flex h-fit w-[min(calc(100%-2rem),28rem)] flex-col rounded-card bg-surface shadow-modal"
            >
              <p className="type-section-title">{failureCopy.title}</p>
              <p className="type-body text-text-secondary">{failureCopy.body}</p>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <div className="gap-3 flex flex-wrap items-center">
                {onRejoin ? (
                  <Button onClick={onRejoin} loading={rejoinPending} loadingLabel={t('stage.connecting')}>
                    {t('stage.rejoin')}
                  </Button>
                ) : null}
                {supportHref ? (
                  <a
                    href={supportHref}
                    className="min-h-11 inline-flex items-center type-body underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {t('stage.contactSupport')}
                  </a>
                ) : null}
              </div>
            </m.div>
          ) : null}
          {overlay === 'ended' ? (
            <m.div
              key="ended"
              role="status"
              {...overlayMotion}
              className="p-6 absolute inset-0 z-30 m-auto h-fit w-[min(calc(100%-2rem),28rem)] rounded-card bg-surface text-center shadow-modal"
            >
              <p className="type-section-title">{endedCopy}</p>
            </m.div>
          ) : null}
        </AnimatePresence>
      </m.section>
    </MotionFeatures>
  );
}
