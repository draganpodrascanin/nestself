import { HandPalm, PhoneDisconnect, PlayCircle, Record, UserCircle, UsersThree } from '@phosphor-icons/react/dist/ssr';
import { AnimatePresence, Badge, Button, MotionFeatures, cn, m, useMotionPreset } from '@nestself/ui';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useCallSession } from '../hooks/useCallSession';
import { useFullscreen } from '../hooks/useFullscreen';
import { useVideoTiles } from '../hooks/useVideoTiles';
import { useWebinarStage } from '../hooks/useWebinarStage';
import { formatInZone } from '../time-zone';
import type { CallSessionControllerApi } from '../types';
import type { WebinarClientApi } from '../webinar/types';
import { FloorGrantedDialog, FloorTakenNotice } from './FloorGrantedDialog';
import { formatClock } from './format-clock';
import { WebinarStageAttendeeControls } from './WebinarStageAttendeeControls';
import { WebinarStageHostControls } from './WebinarStageHostControls';
import { useChangeAnnouncement, useErrorMessages } from './WebinarStageHooks';
import { Announcer, ErrorStack } from './WebinarStageParts';

export interface WebinarStageProps {
  /** The call controller of this viewer's meeting session. */
  controller: CallSessionControllerApi;
  /** The webinar client; its role picks the attendee or the host stage. */
  client: WebinarClientApi;
  /** The occurrence title in the viewer's locale. */
  title: string;
  /** Presenter display names for the lobby (WBN-06). */
  presenterNames?: readonly string[];
  /** Scheduled start, for the lobby countdown. */
  startsAt: string;
  /** The occurrence's time zone for the start time; defaults to the viewer's. */
  timeZone?: string;
  onLeave: () => void;
  /** Hosts in the lobby: `POST /webinars/:id/start` (WBN-16, WBN-17); the button shows only when given. */
  onStart?: () => void;
  startPending?: boolean;
  /** Extra top-bar content, for example the session timer or the connection badge. */
  header?: ReactNode;
  /** A failure from outside (start, join), already translated. */
  error?: string | null;
  className?: string;
}

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

/** Ticks once a second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * The live webinar stage (WBN-06 to WBN-08, WBN-16 to WBN-19, WBN-28).
 *
 * Attendees see the presenter's video and shared screen only: no roster, no
 * names, no counts, no tiles of other attendees, and no camera control
 * (D-CW-15, D-CW-35). Their controls are the webinar sound, the hand,
 * fullscreen and leave, and the microphone only while they have the floor.
 * Hosts see their self-view, the attendance count (a number), raised hands
 * and published messages, and control their media through `ControlBar`.
 *
 * Before the start the lobby shows the title, presenters, start time,
 * countdown, the recording notice and, for attendees, the lobby notice; hosts
 * get "Start webinar". A persistent REC indicator shows while recording
 * (UX-45). Start, end, recording and floor changes are announced (WBN-15).
 * When the webinar ends the stage leaves the meeting (CW-R-36b).
 */
export function WebinarStage({
  controller,
  client,
  title,
  presenterNames = [],
  startsAt,
  timeZone,
  onLeave,
  onStart,
  startPending = false,
  header,
  error,
  className,
}: WebinarStageProps) {
  const { t, i18n } = useTranslation('calls');
  const stage = useWebinarStage(client);
  const call = useCallSession(controller);
  const tiles = useVideoTiles(controller);
  const fullscreen = useFullscreen();
  const stageMotion = useMotionPreset('backdrop');
  const overlayMotion = useMotionPreset('dialog');
  const popover = useMotionPreset('popover');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [soundMuted, setSoundMuted] = useState(false);
  const errors = useErrorMessages(error);

  const lobby = stage.status === 'draft' || stage.status === 'published';
  const now = useNow(lobby);
  const { isHost, isEnded, isLive, isRecording } = stage;

  useEffect(() => {
    controller.bindAudio(audioRef.current);
    return () => controller.bindAudio(null);
  }, [controller]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = soundMuted;
  }, [soundMuted]);

  // CW-R-36b: leave the meeting once the webinar has ended.
  useEffect(() => {
    if (isEnded && call.isInCall) void controller.leave();
  }, [isEnded, call.isInCall, controller]);

  const announcement = useChangeAnnouncement(`${stage.status}|${isRecording}|${stage.myFloor.status}`, (previous, next) => {
    const [wasStatus, wasRecording, wasFloor] = previous.split('|');
    const [status, recording, floor] = next.split('|');
    if (wasStatus !== status && status === 'live') return t('webinar.started');
    if (wasStatus !== status && status === 'ended') return t('webinar.ended');
    if (wasFloor !== floor && floor === 'given') return t('webinar.floorGiven');
    if (wasFloor !== floor && floor === 'taken') return t('webinar.floorTaken');
    if (wasRecording !== recording) return t(recording === 'true' ? 'webinar.recordingStarted' : 'webinar.recordingStopped');
    return null;
  });

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = formatInZone(startsAt, zone, locale);
  const untilStart = Date.parse(startsAt) - now;
  const names = presenterNames.length > 0 ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(presenterNames) : null;
  const fullscreenControl = { supported: fullscreen.supported, active: fullscreen.isFullscreen, toggle: () => void fullscreen.toggle() };
  const presenterPip = tiles.contentTileId !== null ? (tiles.remoteTiles[0]?.tileId ?? null) : null;

  return (
    <MotionFeatures>
      <m.section
        {...stageMotion}
        aria-label={title}
        data-role={stage.role}
        data-fullscreen={fullscreen.isFullscreen || undefined}
        data-testid="webinar-stage"
        className={cn(
          'isolate overflow-hidden bg-canvas text-text',
          fullscreen.isFullscreen ? 'fixed inset-0 z-[var(--z-sticky)] h-dvh w-screen' : 'relative h-full min-h-96 w-full',
          className,
        )}
      >
        {/* Live webinar audio; live captions are out of scope for this epic (D-CW-23). */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} autoPlay className="hidden" />

        {tiles.primaryTileId !== null ? (
          <TileVideo
            controller={controller}
            tileId={tiles.primaryTileId}
            label={tiles.contentTileId !== null ? t('stage.sharedScreen') : t('webinar.presenterVideo')}
            className={cn('absolute inset-0 h-full w-full bg-tint', tiles.contentTileId !== null ? 'object-contain' : 'object-cover md:object-contain')}
          />
        ) : isLive ? (
          <div className="gap-3 p-6 absolute inset-0 flex flex-col items-center justify-center text-center text-text-secondary">
            <UserCircle size={48} aria-hidden />
            <p className="type-body-large">{t('webinar.waitingForVideo')}</p>
          </div>
        ) : null}

        <AnimatePresence>
          {presenterPip !== null ? (
            <m.div
              key="presenter-pip"
              {...popover}
              data-testid="webinar-presenter-pip"
              className="bottom-32 left-3 w-28 sm:w-44 absolute z-10 overflow-hidden rounded-control border border-border-subtle bg-tint shadow-modal origin-bottom-left"
            >
              <TileVideo controller={controller} tileId={presenterPip} label={t('webinar.presenterVideo')} className="aspect-video w-full object-cover" />
            </m.div>
          ) : null}
          {isHost && tiles.localTileId !== null ? (
            <m.div
              key="self-view"
              {...popover}
              data-testid="webinar-self-view"
              className="bottom-32 right-3 w-28 sm:w-44 absolute z-10 overflow-hidden rounded-control border border-border-subtle bg-tint shadow-modal origin-bottom-right"
            >
              <TileVideo controller={controller} tileId={tiles.localTileId} label={t('stage.selfView')} className="aspect-video w-full -scale-x-100 object-cover" />
            </m.div>
          ) : null}
        </AnimatePresence>

        <div className="gap-2 p-3 absolute inset-x-0 top-0 z-20 flex flex-col items-center">
          <div className="gap-2 flex w-full flex-wrap items-start justify-between">
            <div className="gap-2 flex flex-wrap items-center">
              {isLive ? <Badge tone="success">{t('webinar.live')}</Badge> : null}
              <AnimatePresence>
                {isRecording ? (
                  <m.span key="rec" {...popover} data-testid="webinar-rec-indicator" className="origin-left">
                    <Badge tone="danger">
                      <Record size={14} weight="fill" aria-hidden />
                      <span aria-hidden>{t('webinar.recIndicator')}</span>
                      <span className="sr-only">{t('webinar.recording')}</span>
                    </Badge>
                  </m.span>
                ) : null}
              </AnimatePresence>
              {isHost ? (
                <span role="group" aria-label={t('webinar.statsLabel')} className="gap-2 flex flex-wrap" data-testid="webinar-stage-stats">
                  <Badge>
                    <UsersThree size={16} aria-hidden />
                    <span data-testid="webinar-stage-attendance">{t('webinar.attendance', { count: stage.attendanceCount ?? 0 })}</span>
                  </Badge>
                  <Badge>
                    <HandPalm size={16} aria-hidden />
                    {t('webinar.handCount', { count: stage.hands.length })}
                  </Badge>
                  <Badge>{t('webinar.publishedCount', { count: stage.publicMessages.length })}</Badge>
                </span>
              ) : null}
            </div>
            {header ? <div className="gap-2 flex flex-wrap items-center">{header}</div> : null}
          </div>
          <div className="gap-2 flex w-full max-w-xl flex-col">
            <ErrorStack messages={errors} testId="webinar-stage-error" />
            {!isHost ? <FloorTakenNotice client={client} /> : null}
          </div>
        </div>

        <AnimatePresence>
          {lobby ? (
            <m.div
              key="lobby"
              {...overlayMotion}
              data-testid="webinar-lobby"
              className="gap-3 p-6 absolute inset-0 z-30 m-auto flex h-fit max-h-[calc(100%-2rem)] w-[min(calc(100%-2rem),32rem)] flex-col overflow-auto rounded-card bg-surface shadow-modal"
            >
              <p className="type-metadata text-text-secondary">{t('webinar.lobbyTitle')}</p>
              <h2 className="type-section-title">{title}</h2>
              {names ? <p className="type-body">{t('webinar.presenters', { names })}</p> : null}
              <p className="type-body">{t('webinar.startsAt', start)}</p>
              <p className="type-body-large font-[var(--font-weight-label)]" data-testid="webinar-lobby-countdown">
                {untilStart > 0 ? t('webinar.startsIn', { time: formatClock(untilStart) }) : t('webinar.startingSoon')}
              </p>
              <p className="gap-2 p-3 flex items-start rounded-control bg-info-surface text-info type-body">
                <Record size={20} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
                {t('webinar.recordingNotice')}
              </p>
              {isHost ? (
                <>
                  <p className="type-body">{t('webinar.attendance', { count: stage.attendanceCount ?? 0 })}</p>
                  {onStart ? (
                    <>
                      <p className="type-metadata text-text-secondary">{t('webinar.startHint')}</p>
                      <Button onClick={onStart} loading={startPending} loadingLabel={t('webinar.starting')} leadingIcon={<PlayCircle size={20} />} className="self-start">
                        {t('webinar.start')}
                      </Button>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="type-body">{t('webinar.lobby')}</p>
                  <Button variant="secondary" leadingIcon={<PhoneDisconnect size={20} />} onClick={onLeave} className="self-start">
                    {t('consultation.leave')}
                  </Button>
                </>
              )}
            </m.div>
          ) : null}
          {isEnded ? (
            <m.div
              key="ended"
              {...overlayMotion}
              role="status"
              data-testid="webinar-ended"
              className="gap-4 p-6 absolute inset-0 z-30 m-auto flex h-fit w-[min(calc(100%-2rem),28rem)] flex-col items-center rounded-card bg-surface text-center shadow-modal"
            >
              <p className="type-section-title">{t('webinar.ended')}</p>
              <Button variant="secondary" onClick={onLeave}>
                {t('consultation.leave')}
              </Button>
            </m.div>
          ) : null}
        </AnimatePresence>

        {!isEnded ? (
          <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] absolute inset-x-0 bottom-0 z-20 flex justify-center">
            {isHost ? (
              <WebinarStageHostControls controller={controller} role={stage.role === 'moderator' ? 'moderator' : 'presenter'} fullscreen={fullscreenControl} onLeave={onLeave} />
            ) : isLive ? (
              <WebinarStageAttendeeControls
                controller={controller}
                client={client}
                soundMuted={soundMuted}
                onToggleSound={() => setSoundMuted((value) => !value)}
                fullscreen={fullscreenControl}
                onLeave={onLeave}
              />
            ) : null}
          </div>
        ) : null}

        {!isHost ? <FloorGrantedDialog client={client} controller={controller} /> : null}
        <Announcer announcement={announcement} testId="webinar-stage-announcer" />
      </m.section>
    </MotionFeatures>
  );
}
