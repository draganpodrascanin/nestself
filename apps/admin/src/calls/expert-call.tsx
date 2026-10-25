/**
 * The expert's consultation call (CALL-20, CALL-21, CALL-34): the mandatory
 * pre-join check, then the call stage with the expert's control bar ("End
 * for everyone" behind its confirmation), the session timer with the
 * follow-up hint, crisis resources with the expert guidance, and the
 * location the employee shared for a psychological consultation.
 *
 * The join response starts the controller and is never stored (CW-R-59).
 * Unmounting destroys the controller, so leaving the page without joining
 * turns the camera preview off.
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@nestself/ui';
import { appointmentLocationQuery, startClientEventPoster } from '@nestself/api-client';
import type { ClientEventPoster } from '@nestself/api-client';
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
import { isSampleDataMode } from '../data-source';
import { callRoomClient } from './call-room-client';
import { callsApi } from './calls-api';
import { durationMinutes, supportAreaOf } from './format';
import { mapCallError } from './map-call-error';
import { Reveal } from './reveal';
import { supportMailto } from './support-contact';
import { useConsultationController } from './use-consultation-controller';

/** While waiting for the employee, the shared location is re-read this often (the room event refetches at once). */
const LOCATION_POLL_MS = 30_000;
/** Sample mode: the fake employee "joins" this long after the expert. */
const SAMPLE_EMPLOYEE_JOIN_MS = 2_500;
const MINUTE_MS = 60_000;

export type ExpertCallEnd = 'left' | 'ended';

export interface ExpertCallProps {
  appointment: Appointment;
  /** The employee's first name where it is known. */
  employeeName: string | null;
  /** The call is over: the page shows the outcome capture next (CALL-21 criterion 6, CALL-23). */
  onEnded: (how: ExpertCallEnd) => void;
}

function SharedLocation({ appointment, joined, waiting, refetchSignal }: { appointment: Appointment; joined: boolean; waiting: boolean; refetchSignal: number }) {
  const { t } = useTranslation('calls');
  const query = useQuery({
    ...appointmentLocationQuery(callsApi, appointment.id),
    enabled: joined && !isSampleDataMode,
    refetchInterval: waiting ? LOCATION_POLL_MS : false,
  });
  const { refetch } = query;
  useEffect(() => {
    if (refetchSignal > 0) void refetch();
  }, [refetchSignal, refetch]);

  const text = query.data?.locationText ?? null;
  return (
    <section aria-labelledby="shared-location-title" className="gap-1 p-3 flex max-w-md flex-col rounded-card border border-border-subtle bg-surface text-text shadow-low">
      <h2 id="shared-location-title" className="type-label text-text">
        {t('consultations.location.title')}
      </h2>
      {query.isError ? (
        <p className="type-metadata text-danger">{mapCallError(query.error, t)}</p>
      ) : (
        <p className="type-body text-text">{text ?? t('consultations.location.none')}</p>
      )}
      <p className="type-metadata text-text-secondary">{t('consultations.location.hint')}</p>
    </section>
  );
}

export function ExpertCall({ appointment, employeeName, onEnded }: ExpertCallProps) {
  const { t } = useTranslation('calls');
  const toast = useToast();
  const [probe] = useState(() => callsApi.networkProbe(appointment.id));
  const controller: CallSessionControllerApi = useConsultationController({ role: 'expert', format: 'consultation', probeNetwork: probe });
  const call = useCallSession(controller);
  const devices = useDevices(controller);
  const quality = useConnectionQuality(controller);
  const tiles = useVideoTiles(controller);
  const fullscreen = useFullscreen();
  const poster = useRef<ClientEventPoster | null>(null);
  const realtimeWarned = useRef(false);

  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [employeePresent, setEmployeePresent] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [locationShared, setLocationShared] = useState(0);
  const [endedBy, setEndedBy] = useState<ExpertCallEnd | null>(null);

  const remotePresent = employeePresent || tiles.remoteTiles.length > 0;
  const waiting = call.status === 'connected' && !remotePresent;
  const psychological = supportAreaOf(appointment.serviceCategory) === 'psychological';

  const finish = useEffectEvent((how: ExpertCallEnd) => onEnded(how));
  useEffect(() => {
    if (!joined || call.status !== 'left') return;
    void poster.current?.flush();
    finish(endedBy ?? 'ended');
  }, [joined, call.status, endedBy]);

  useEffect(() => {
    if (!joined) return undefined;
    const started = startClientEventPoster({
      drain: () => controller.drainClientEvents(),
      post: (events) => (isSampleDataMode || !sessionId ? Promise.resolve() : callsApi.postClientEvents(sessionId, events)),
    });
    poster.current = started;
    return () => {
      poster.current = null;
      void started.stop();
    };
  }, [joined, sessionId, controller]);

  const onSignal = useEffectEvent((signal: CallSignalPayload) => {
    if (signal.fromRole !== 'employee' || signal.type === 'running_late') return;
    toast.add({ title: t(signal.type === 'cannot_hear' ? 'signals.cannotHear' : 'signals.cannotSee'), tone: 'warning' });
  });
  const onPresence = useEffectEvent((role: string, present: boolean) => {
    if (role === 'employee') setEmployeePresent(present);
  });
  const onUnavailable = useEffectEvent(() => {
    if (realtimeWarned.current) return;
    realtimeWarned.current = true;
    toast.add({ title: t('call.realtimeUnavailable'), tone: 'info' });
  });

  useEffect(() => {
    if (!sessionId) return undefined;
    return callRoomClient.subscribe(sessionId, {
      onSignal: (signal) => onSignal(signal),
      onParticipantJoined: (event) => onPresence(event.role, true),
      onParticipantLeft: (event) => onPresence(event.role, false),
      onLocationShared: () => setLocationShared((count) => count + 1),
      onUnavailable: () => onUnavailable(),
    });
  }, [sessionId]);

  useEffect(() => {
    if (!isSampleDataMode || !joined || !(controller instanceof FakeCallSessionController)) return undefined;
    const id = setTimeout(() => {
      controller.simulate.remoteJoined();
      setEmployeePresent(true);
    }, SAMPLE_EMPLOYEE_JOIN_MS);
    return () => clearTimeout(id);
  }, [joined, controller]);

  const connect = async (onError: (message: string) => void): Promise<void> => {
    if (isSampleDataMode && controller instanceof FakeCallSessionController) {
      setJoined(true);
      await controller.join();
      const start = Date.now();
      controller.simulate.connected({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + durationMinutes(appointment) * MINUTE_MS).toISOString(),
      });
      return;
    }
    let response: CallJoinResponse;
    try {
      response = await callsApi.join(appointment.id);
    } catch (err) {
      onError(mapCallError(err, t));
      return;
    }
    setSessionId(response.sessionId);
    setJoined(true);
    // A failure to connect media is shown by the stage (status `failed`, with Rejoin).
    await controller.join(response).catch(() => undefined);
  };

  const run = async (onError: (message: string) => void) => {
    setJoining(true);
    try {
      await connect(onError);
    } finally {
      setJoining(false);
    }
  };

  const endForEveryone = async () => {
    setControlError(null);
    setEnding(true);
    try {
      if (!isSampleDataMode) await callsApi.end(appointment.id);
      setEndedBy('ended');
      await controller.leave();
    } catch (err) {
      setControlError(mapCallError(err, t));
    } finally {
      setEnding(false);
    }
  };

  const leave = async () => {
    setEndedBy('left');
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

  if (!joined) {
    return (
      <PreJoinCheck
        controller={controller}
        onJoin={() => {
          setJoinError(null);
          void run(setJoinError);
        }}
        joining={joining}
        error={joinError}
      />
    );
  }

  return (
    <div className="h-[80dvh] min-h-96 w-full">
      <CallStage
        controller={controller}
        remoteName={employeeName ?? undefined}
        remotePresent={remotePresent}
        fullscreen={fullscreen.isFullscreen}
        onRejoin={() => {
          setRejoinError(null);
          void run(setRejoinError);
        }}
        rejoinPending={joining}
        supportHref={supportMailto()}
        error={rejoinError}
        className="rounded-card"
        header={
          <>
            <div className="gap-2 flex flex-wrap items-center">
              {call.startsAt && call.endsAt ? (
                <SessionTimer
                  startsAt={call.startsAt}
                  endsAt={call.endsAt}
                  participantRole="expert"
                  onRoomClose={() => {
                    setEndedBy('ended');
                    void controller.leave();
                  }}
                />
              ) : null}
              <ConnectionBadge quality={quality.level} reconnecting={quality.reconnecting} videoPaused={quality.videoPaused} />
            </div>
            <CrisisResourcesButton audience="expert" />
            <Reveal show={psychological && call.status === 'connected'} className="basis-full">
              <SharedLocation appointment={appointment} joined={joined} waiting={waiting} refetchSignal={locationShared} />
            </Reveal>
          </>
        }
        controls={
          <ControlBar
            participantRole="expert"
            muted={call.media.muted}
            cameraOn={call.media.cameraOn}
            blur={devices.blur}
            sharingScreen={call.media.sharingScreen}
            fullscreen={fullscreen.isFullscreen}
            devices={devices}
            onToggleMute={call.toggleMute}
            onToggleCamera={() => void call.toggleCamera()}
            onToggleBlur={() => void controller.setBlur(!devices.blur.enabled)}
            onSelectDevice={(kind, deviceId) => void controller.selectDevice(kind, deviceId)}
            onToggleFullscreen={fullscreen.supported ? () => void fullscreen.toggle() : undefined}
            onToggleScreenShare={() => void call.toggleScreenShare()}
            onSignal={(signal) => void sendSignal(signal)}
            onLeave={() => void leave()}
            onEndForEveryone={() => void endForEveryone()}
            endPending={ending}
            error={controlError}
          />
        }
      />
    </div>
  );
}
