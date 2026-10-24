/**
 * The employee's consultation call (CALL-02 to CALL-16, CALL-34): join
 * window states, the optional location prompt, the mandatory pre-join
 * check, the call stage with its waiting state and quick signals, and the
 * post-call screen with feedback, then the follow-up card and the problem
 * report.
 *
 * The follow-up card (D-CW-37) appears when a proposal for this consultation
 * arrives on the call room or on the user's own room (`user:{userId}`), or
 * when the post-call screen finds one already waiting (CALL-42).
 *
 * The join response is used once, to start the controller, and is never
 * stored (CW-R-59): only the session id (for the call room and the client
 * events) is kept. Leaving the route destroys the controller, so the camera
 * preview does not stay on.
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AnimatePresence,
  Field,
  Heading,
  Input,
  MotionFeatures,
  m,
  useAnnounce,
  useMotionPreset,
  useToast,
} from '@nestself/ui';
import { appointmentKeys, startClientEventPoster } from '@nestself/api-client';
import type { ClientEventPoster, FollowUpProposedEvent } from '@nestself/api-client';
import { CALL_LOCATION_TEXT_MAX_LENGTH } from '@nestself/contracts';
import type { Appointment, CallJoinResponse, CallSignalPayload } from '@nestself/contracts';
import {
  CallStage,
  ConnectionBadge,
  ControlBar,
  CrisisResourcesButton,
  FakeCallSessionController,
  PreJoinCheck,
  SessionTimer,
  useCallSession,
  useConnectionQuality,
  useDevices,
  useFullscreen,
  useVideoTiles,
} from '@nestself/video';
import type { CallSessionControllerApi, CallSignal } from '@nestself/video';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { EmployeeFollowUpPanel } from './follow-up-panel';
import { markJoined } from './joined-sessions';
import { userRoomClient } from './user-room-client';
import { callRoomClient } from './call-room-client';
import { callsApi } from './calls-api';
import { ClientEventSummaryRecorder } from './client-event-summary';
import { durationMinutes, roomClosesAt, supportAreaOf, useZonedFormat } from './format';
import { mapCallError } from './map-call-error';
import { FeedbackForm, ReportProblemDialog } from './post-call';
import { Reveal } from './reveal';
import { useConsultationController } from './use-consultation-controller';
import { useJoinWindow } from './use-join-window';

/** CALL-15: the post-call screen follows an ended call after five seconds; a person who leaves gets it at once. */
export const POST_CALL_DELAY_MS = 5_000;
/** Sample mode: the fake expert "joins" this long after the employee. */
const SAMPLE_EXPERT_JOIN_MS = 2_500;
const MINUTE_MS = 60_000;

type EndReason = 'left' | 'ended' | 'room_closed';

export interface ConsultationCallProps {
  appointment: Appointment;
  /** The expert's first name where it is known; never from the video provider. */
  expertName: string | null;
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="gap-6 px-4 py-6 sm:px-6 max-w-4xl mx-auto flex w-full flex-col"
    >
      {children}
    </main>
  );
}

function WaitingPanel({
  appointment,
  expertName,
  runningLate,
}: {
  appointment: Appointment;
  expertName: string | null;
  runningLate: { etaMinutes?: number } | null;
}) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  return (
    <section
      aria-labelledby="waiting-title"
      className="gap-3 p-4 max-w-md mx-auto flex w-full flex-col rounded-card border border-border-subtle bg-surface text-text shadow-low"
    >
      <h2 id="waiting-title" className="type-label text-text">
        {expertName ? t('waiting.expertSoonNamed', { name: expertName }) : t('waiting.expertSoon')}
      </h2>
      <p className="type-metadata text-text-secondary">
        {t('waiting.scheduled', { time: format.time(appointment.startsAt, appointment.timeZone) })}
      </p>
      <Reveal show={runningLate !== null}>
        <Alert tone="info">
          {runningLate?.etaMinutes
            ? t('waiting.runningLateEta', { count: runningLate.etaMinutes })
            : t('waiting.runningLate')}
        </Alert>
      </Reveal>
      <h3 className="type-metadata text-text">{t('waiting.tipsTitle')}</h3>
      <ul className="gap-1 m-0 pl-5 flex list-disc flex-col type-metadata text-text-secondary">
        <li>{t('waiting.tips.private')}</li>
        <li>{t('waiting.tips.headphones')}</li>
        <li>{t('waiting.tips.notes')}</li>
      </ul>
    </section>
  );
}

/** Joining before the window, after it or for an appointment that is not confirmed (CALL-02, CALL-07, CALL-20). */
function JoinGate({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const window = useJoinWindow(appointment);
  if (!window || window.kind === 'open') return null;
  if (window.kind === 'before') {
    return (
      <Alert tone="info">
        {t('join.comeBackAt', { time: format.time(window.opensAt, appointment.timeZone) })}
      </Alert>
    );
  }
  if (window.kind === 'closed' && window.rejoinable) {
    // The pre-join check below stays available; the server refuses anyone who never joined (CALL-07).
    return (
      <Alert tone="info">{t('join.rejoinHint', { time: format.time(roomClosesAt(appointment), appointment.timeZone) })}</Alert>
    );
  }
  if (window.kind === 'closed') {
    return (
      <Alert tone="warning">
        <span className="gap-2 flex flex-col">
          <span>{t('join.windowClosed')}</span>
          <Link to="/support" className="text-primary underline underline-offset-[0.2em]">
            {t('join.contactSupport')}
          </Link>
        </span>
      </Alert>
    );
  }
  return <Alert tone="warning">{t('errors.appointmentNotJoinable')}</Alert>;
}

export function ConsultationCall({ appointment, expertName }: ConsultationCallProps) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const toast = useToast();
  const { announce } = useAnnounce();
  const phaseMotion = useMotionPreset('backdrop');
  const [probe] = useState(() => callsApi.networkProbe(appointment.id));
  const controller: CallSessionControllerApi = useConsultationController({
    role: 'employee',
    format: 'consultation',
    probeNetwork: probe,
  });
  const call = useCallSession(controller);
  const devices = useDevices(controller);
  const quality = useConnectionQuality(controller);
  const tiles = useVideoTiles(controller);
  const fullscreen = useFullscreen();
  const window = useJoinWindow(appointment);
  const [recorder] = useState(() => new ClientEventSummaryRecorder());
  const poster = useRef<ClientEventPoster | null>(null);
  const realtimeWarned = useRef(false);

  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [locationText, setLocationText] = useState('');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [expertPresent, setExpertPresent] = useState(false);
  const [runningLate, setRunningLate] = useState<{ etaMinutes?: number } | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [postCallDue, setPostCallDue] = useState(false);
  const [liveProposal, setLiveProposal] = useState<FollowUpProposedEvent | null>(null);
  const { principal } = useAuth();

  const sharesLocation = supportAreaOf(appointment.serviceCategory) === 'psychological';
  const remotePresent = expertPresent || tiles.remoteTiles.length > 0;
  const left = joined && call.status === 'left';
  const reason: EndReason | null = endReason ?? (left ? 'ended' : null);
  const phase = !joined ? 'prejoin' : left && (reason !== 'ended' || postCallDue) ? 'post' : 'call';

  // A proposal already waiting when the post-call screen opens (CALL-42): the room event may have come first.
  const waiting = useQuery({
    queryKey: [...appointmentKeys.lists(), 'follow-up-of', appointment.id],
    queryFn: () => callsApi.listAppointments({ status: 'proposed', from: appointment.startsAt }),
    enabled: phase === 'post' && !isSampleDataMode,
    select: (page) => page.items.find((item) => item.followUpOf === appointment.id) ?? null,
  });
  const proposal: FollowUpProposedEvent | null =
    liveProposal ??
    (waiting.data
      ? {
          appointmentId: appointment.id,
          followUpId: waiting.data.id,
          startsAt: waiting.data.startsAt,
          durationMinutes: durationMinutes(waiting.data),
        }
      : null);

  // An ended call shows the stage's "session ended" state, then the post-call screen.
  useEffect(() => {
    if (!left || reason !== 'ended') return undefined;
    const id = setTimeout(() => setPostCallDue(true), POST_CALL_DELAY_MS);
    return () => clearTimeout(id);
  }, [left, reason]);

  // Telemetry (D-CW-13): post the controller's log every 30 s and once more on leave.
  useEffect(() => {
    if (!joined) return undefined;
    const started = startClientEventPoster({
      drain: () => {
        const events = controller.drainClientEvents();
        recorder.add(events);
        return events;
      },
      post: (events) =>
        isSampleDataMode || !sessionId
          ? Promise.resolve()
          : callsApi.postClientEvents(sessionId, events),
    });
    poster.current = started;
    return () => {
      poster.current = null;
      void started.stop();
    };
  }, [joined, sessionId, controller, recorder]);

  useEffect(() => {
    if (!left) return;
    recorder.ended();
    void poster.current?.flush();
  }, [left, recorder]);

  const onSignal = useEffectEvent((signal: CallSignalPayload) => {
    if (signal.fromRole !== 'expert') return;
    if (signal.type === 'running_late') {
      setRunningLate({ etaMinutes: signal.etaMinutes });
      announce(
        signal.etaMinutes
          ? t('waiting.runningLateEta', { count: signal.etaMinutes })
          : t('waiting.runningLate'),
      );
      return;
    }
    toast.add({
      title: t(signal.type === 'cannot_hear' ? 'signals.cannotHear' : 'signals.cannotSee'),
      tone: 'warning',
    });
  });
  const onExpertPresence = useEffectEvent((role: string, present: boolean) => {
    if (role !== 'expert') return;
    setExpertPresent(present);
    if (present) setRunningLate(null);
  });
  const onSessionEnded = useEffectEvent(() => {
    setEndReason((current) => current ?? 'ended');
    void controller.leave();
  });
  const onUnavailable = useEffectEvent(() => {
    if (realtimeWarned.current) return;
    realtimeWarned.current = true;
    toast.add({ title: t('call.realtimeUnavailable'), tone: 'info' });
  });

  // The call room (T-CW-1.6): signals, presence, the session's end and follow-up proposals.
  useEffect(() => {
    if (!sessionId) return undefined;
    return callRoomClient.subscribe(sessionId, {
      onSignal: (signal) => onSignal(signal),
      onParticipantJoined: (event) => onExpertPresence(event.role, true),
      onParticipantLeft: (event) => onExpertPresence(event.role, false),
      onSessionEnded: () => onSessionEnded(),
      onFollowUpProposed: (event) => setLiveProposal(event),
      onUnavailable: () => onUnavailable(),
    });
  }, [sessionId]);

  // The user's own room: a proposal made while this screen is open but after the call room closed (CALL-42).
  const userId = principal?.userId ?? null;
  useEffect(() => {
    if (!userId || !joined) return undefined;
    return userRoomClient.subscribe(userId, {
      onFollowUpProposed: (event) => {
        if (event.appointmentId === appointment.id) setLiveProposal(event);
      },
    });
  }, [userId, joined, appointment.id]);

  // Sample mode: the fake expert joins shortly after the employee.
  useEffect(() => {
    if (!isSampleDataMode || !joined || !(controller instanceof FakeCallSessionController))
      return undefined;
    const id = setTimeout(() => {
      controller.simulate.remoteJoined();
      setExpertPresent(true);
    }, SAMPLE_EXPERT_JOIN_MS);
    return () => clearTimeout(id);
  }, [joined, controller]);

  /** Calls the join endpoint, then starts the controller with the response, which is not kept. */
  const connect = async (onError: (message: string) => void): Promise<void> => {
    if (isSampleDataMode && controller instanceof FakeCallSessionController) {
      setJoined(true);
      recorder.started();
      await controller.join();
      const start = Date.now();
      controller.simulate.connected({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + durationMinutes(appointment) * MINUTE_MS).toISOString(),
      });
      return;
    }
    const text = locationText.trim();
    let response: CallJoinResponse;
    try {
      response = await callsApi.join(
        appointment.id,
        sharesLocation && text ? { locationText: text } : {},
      );
    } catch (err) {
      onError(mapCallError(err, t));
      return;
    }
    setSessionId(response.sessionId);
    markJoined(appointment.id);
    setJoined(true);
    recorder.started();
    // A failure to connect media is shown by the stage (status `failed`, with Rejoin).
    await controller.join(response).catch(() => undefined);
  };

  const join = async () => {
    setJoinError(null);
    if (locationText.trim().length > CALL_LOCATION_TEXT_MAX_LENGTH) {
      setLocationError(t('location.tooLong', { max: CALL_LOCATION_TEXT_MAX_LENGTH }));
      return;
    }
    setLocationError(null);
    setJoining(true);
    try {
      await connect(setJoinError);
    } finally {
      setJoining(false);
    }
  };

  const rejoin = async () => {
    setRejoinError(null);
    setJoining(true);
    try {
      await connect(setRejoinError);
    } finally {
      setJoining(false);
    }
  };

  const leave = async () => {
    setEndReason('left');
    await controller.leave();
  };

  const sendSignal = async (signal: CallSignal) => {
    setControlError(null);
    if (isSampleDataMode) {
      toast.add({ title: t('sample.actionNoop'), tone: 'info' });
      return;
    }
    try {
      await callsApi.sendSignal(appointment.id, { type: signal });
    } catch (err) {
      setControlError(mapCallError(err, t));
    }
  };

  const when = t('appointments.dateTime', {
    date: format.date(appointment.startsAt, appointment.timeZone),
    time: format.time(appointment.startsAt, appointment.timeZone),
  });
  const sampleNotice = isSampleDataMode ? (
    <Alert tone="info">{t('call.sampleNotice')}</Alert>
  ) : null;
  const backLink = (
    <Link
      to="/appointments/$appointmentId"
      params={{ appointmentId: appointment.id }}
      className="type-body text-primary underline underline-offset-[0.2em]"
    >
      {t('call.backToAppointment')}
    </Link>
  );

  let content: ReactNode;
  if (phase === 'prejoin') {
    const open = isSampleDataMode || window?.kind === 'open' || (window?.kind === 'closed' && window.rejoinable);
    content = (
      <PageFrame>
        {backLink}
        <header className="gap-1 flex flex-col">
          <Heading level={1} typeRole="screenTitle">
            {t('call.title')}
          </Heading>
          <p className="type-body text-text-secondary">{when}</p>
        </header>
        {sampleNotice}
        {isSampleDataMode ? null : <JoinGate appointment={appointment} />}
        {open ? (
          <>
            <Reveal show={!isSampleDataMode && window?.kind === 'open' && window.late}>
              <Alert tone="info">
                {t('join.lateJoin', {
                  time: format.time(appointment.startsAt, appointment.timeZone),
                })}
              </Alert>
            </Reveal>
            {sharesLocation ? (
              <div className="max-w-xl">
                <Field
                  label={t('location.label')}
                  description={`${t('location.prompt')} ${t('location.hint')}`}
                  optionalLabel={t('location.optional')}
                  error={locationError ?? undefined}
                >
                  <Input
                    value={locationText}
                    onChange={(event) => setLocationText(event.target.value)}
                    autoComplete="off"
                    name="locationText"
                  />
                </Field>
              </div>
            ) : null}
            <PreJoinCheck
              controller={controller}
              onJoin={() => void join()}
              joining={joining}
              error={joinError}
            />
          </>
        ) : null}
      </PageFrame>
    );
  } else if (phase === 'call') {
    const waiting = call.status === 'connected' && !remotePresent;
    content = (
      // The sample banner is sticky above the page: leave it room so the stage never scrolls under it.
      <main
        id="main"
        tabIndex={-1}
        className={isSampleDataMode ? 'h-[calc(100dvh-5rem)] w-full' : 'h-dvh w-full'}
      >
        <CallStage
          controller={controller}
          remoteName={expertName ?? undefined}
          remotePresent={remotePresent}
          fullscreen={fullscreen.isFullscreen}
          onRejoin={() => void rejoin()}
          rejoinPending={joining}
          supportHref="/support"
          error={rejoinError}
          header={
            <>
              <div className="gap-2 flex flex-wrap items-center">
                {call.startsAt && call.endsAt ? (
                  <SessionTimer
                    startsAt={call.startsAt}
                    endsAt={call.endsAt}
                    participantRole="employee"
                    onRoomClose={() => {
                      setEndReason('room_closed');
                      void controller.leave();
                    }}
                  />
                ) : null}
                <ConnectionBadge
                  quality={quality.level}
                  reconnecting={quality.reconnecting}
                  videoPaused={quality.videoPaused}
                />
              </div>
              <CrisisResourcesButton audience="employee" />
            </>
          }
          controls={
            <div className="gap-3 flex w-full flex-col items-center">
              {/* Ended from the call room: the stage shows no overlay after our own leave, so say it here until the post-call screen. */}
              <Reveal show={left && call.endReason === 'left'} className="w-full max-w-md">
                <Alert tone="info">{t('consultation.sessionEnded')}</Alert>
              </Reveal>
              <Reveal show={waiting} className="w-full">
                <WaitingPanel
                  appointment={appointment}
                  expertName={expertName}
                  runningLate={runningLate}
                />
              </Reveal>
              <ControlBar
                participantRole="employee"
                muted={call.media.muted}
                cameraOn={call.media.cameraOn}
                blur={devices.blur}
                fullscreen={fullscreen.isFullscreen}
                devices={devices}
                onToggleMute={call.toggleMute}
                onToggleCamera={() => void call.toggleCamera()}
                onToggleBlur={() => void controller.setBlur(!devices.blur.enabled)}
                onSelectDevice={(kind, deviceId) => void controller.selectDevice(kind, deviceId)}
                onToggleFullscreen={
                  fullscreen.supported ? () => void fullscreen.toggle() : undefined
                }
                onSignal={(signal) => void sendSignal(signal)}
                onLeave={() => void leave()}
                error={controlError}
              />
            </div>
          }
        />
      </main>
    );
  } else {
    content = (
      <PageFrame>
        <Heading level={1} typeRole="screenTitle">
          {reason === 'left'
            ? t('postCall.left')
            : reason === 'room_closed'
              ? t('postCall.roomClosed')
              : t('postCall.ended')}
        </Heading>
        {sampleNotice}
        {/* D-CW-37: feedback first, then the follow-up card, which animates in when a proposal arrives. */}
        <FeedbackForm appointmentId={appointment.id} />
        {proposal ? (
          <EmployeeFollowUpPanel
            key={proposal.followUpId}
            followUpId={proposal.followUpId}
            proposal={{
              startsAt: proposal.startsAt,
              durationMinutes: proposal.durationMinutes,
              timeZone: appointment.timeZone,
            }}
            status="proposed"
          />
        ) : null}
        <ReportProblemDialog sessionId={sessionId} recorder={recorder} />
        <Link
          to="/appointments"
          className="type-body text-primary underline underline-offset-[0.2em]"
        >
          {t('postCall.backToAppointments')}
        </Link>
      </PageFrame>
    );
  }

  return (
    <MotionFeatures>
      <AnimatePresence mode="wait" initial={false}>
        <m.div key={phase} {...phaseMotion}>
          {content}
        </m.div>
      </AnimatePresence>
    </MotionFeatures>
  );
}
