/**
 * The attendee's live webinar (WBN-06 to WBN-12, D-CW-15, D-CW-35): the
 * pre-join sound and network check (no camera, CW-R-124), then the stage
 * with the chat and the poll beside it. Attendees receive only: the stage
 * offers the webinar sound, the hand, fullscreen and leave, and the
 * microphone only while a host has given the floor and after the floor
 * notice was read (`WebinarStage` holds `HandRaiseButton`,
 * `FloorGrantedDialog` and `FloorTakenNotice`, so they are not rendered a
 * second time here). There is no roster and no other attendee's name.
 *
 * Joining before a host started answers 409 `webinar_not_open`: the stage
 * shows the lobby (countdown, recording notice, the camera sentence) and
 * joins as soon as the room reports `live`. When the webinar ends the screen
 * leaves the meeting and thanks the attendee; a replay is a sentence only
 * (M2). The join response starts the controller once and is not kept
 * (CW-R-59). Sample mode runs on `FakeWebinarClient` and
 * `FakeCallSessionController`: nothing joins a meeting and nothing is sent.
 */
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, AnimatePresence, Heading, MotionFeatures, m, useMotionPreset } from '@nestself/ui';
import { createWebinarTransport } from '@nestself/api-client';
import type { WebinarJoinResponse, WebinarResponse } from '@nestself/contracts';
import {
  ChatPanel,
  FAKE_WEBINAR_SAMPLE_PEOPLE,
  FakeCallSessionController,
  FakeWebinarClient,
  PollPanel,
  PreJoinCheck,
  WebinarClient,
  createSampleWebinarServer,
} from '@nestself/video';
import type { CallSessionControllerApi, WebinarClientApi } from '@nestself/video';
import { WebinarStage } from '@nestself/video';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { useConsultationController } from '../calls/use-consultation-controller';
import { isWebinarNotOpen, mapWebinarError } from './map-webinar-error';
import { webinarRoomClient } from './webinar-room-client';
import { webinarsApi } from './webinars-api';
import { useLocalized } from './webinar-format';
import { Reveal } from '../calls/reveal';

type Phase = 'prejoin' | 'stage';

const MINUTE_MS = 60_000;

/** The webinar join response as the call controller takes it; nothing else of it is kept. */
function toCallJoin(response: WebinarJoinResponse) {
  return {
    sessionId: response.sessionId,
    participantId: response.participantId,
    role: response.role,
    format: response.format,
    startsAt: response.startsAt,
    endsAt: response.endsAt,
    meeting: response.meeting,
    attendee: response.attendee,
  };
}

function useSnapshotStatus(client: WebinarClientApi) {
  return useSyncExternalStore(client.subscribe, () => client.getSnapshot().status);
}

/**
 * The attendee's webinar client: one per participant id (the floor events
 * are matched against it), on the API transport; in sample mode one fake
 * client on a scripted sample webinar that is already live.
 */
function useAttendeeClient(webinar: WebinarResponse, participantId: string | null, controller: CallSessionControllerApi, onUnavailable: () => void): WebinarClientApi {
  const { principal } = useAuth();
  const userId = principal?.userId ?? null;
  const [sample] = useState(() => {
    if (!isSampleDataMode) return null;
    const server = createSampleWebinarServer({ webinarId: webinar.id, status: 'live', recording: true, poll: 'open', chat: true });
    const [ana] = FAKE_WEBINAR_SAMPLE_PEOPLE.attendees;
    return new FakeWebinarClient({ server, role: 'attendee', participantId: ana.participantId, name: ana.name, audio: controller });
  });
  const live = useMemo(() => {
    if (sample) return null;
    return new WebinarClient({
      webinarId: webinar.id,
      role: 'attendee',
      participantId,
      audio: controller,
      transport: createWebinarTransport({ api: webinarsApi, rooms: webinarRoomClient, webinarId: webinar.id, userId, onUnavailable }),
      // An attendee's join succeeds only while the webinar is live; later changes arrive on the room.
      initial: { status: participantId ? 'live' : webinar.status },
    });
    // The detail's status seeds a new client only; `onUnavailable` is a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, webinar.id, participantId, controller, userId]);
  return sample ?? live!;
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="gap-4 flex flex-col">{children}</div>;
}

export function WebinarLive({ webinar }: { webinar: WebinarResponse }) {
  const { t } = useTranslation('calls');
  const navigate = useNavigate();
  const localized = useLocalized();
  const phaseMotion = useMotionPreset('backdrop');
  const controller = useConsultationController({ role: 'attendee', format: 'webinar' });

  const [stagePhase, setPhase] = useState<Phase>('prejoin');
  const connecting = useRef(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [roomUnavailable, setRoomUnavailable] = useState(false);

  const client = useAttendeeClient(webinar, participantId, controller, () => setRoomUnavailable(true));
  const status = useSnapshotStatus(client);
  const title = localized(webinar.title);
  // CW-R-36b: once the webinar ended for everyone, the screen thanks the attendee.
  const phase: Phase | 'ended' = status === 'ended' && stagePhase === 'stage' ? 'ended' : stagePhase;

  /** Calls the join endpoint, then starts the controller with the response, which is not kept. */
  const connect = async (): Promise<void> => {
    if (connecting.current) return;
    connecting.current = true;
    try {
      await joinOnce();
    } finally {
      connecting.current = false;
    }
  };

  const joinOnce = async (): Promise<void> => {
    setJoinError(null);
    if (isSampleDataMode && controller instanceof FakeCallSessionController) {
      setPhase('stage');
      await controller.join();
      const start = Date.now();
      controller.simulate.connected({ startsAt: new Date(start).toISOString(), endsAt: new Date(start + 60 * MINUTE_MS).toISOString() });
      controller.simulate.remoteJoined('sample-presenter');
      return;
    }
    setJoining(true);
    let response: WebinarJoinResponse;
    try {
      response = await webinarsApi.join(webinar.id);
    } catch (err) {
      if (isWebinarNotOpen(err) && (webinar.status === 'published' || webinar.status === 'live')) {
        // The lobby: the hosts have not started; the room's `live` joins again.
        setWaiting(true);
        setPhase('stage');
      } else {
        setWaiting(false);
        setJoinError(mapWebinarError(err, t));
        setPhase('prejoin');
      }
      return;
    } finally {
      setJoining(false);
    }
    setWaiting(false);
    setParticipantId(response.participantId);
    setPhase('stage');
    // A failure to connect media is shown by the stage through the controller's state.
    await controller.join(toCallJoin(response)).catch(() => undefined);
  };

  // The chat so far, once joined (published and answered messages only, CW-R-104).
  useEffect(() => {
    if (isSampleDataMode || !participantId) return undefined;
    let current = true;
    webinarsApi.listMessages(webinar.id).then(
      (page) => {
        if (!current) return;
        setChatError(null);
        client.hydrate({ publicMessages: page.items.filter((message) => message.status === 'published' || message.status === 'answered') });
      },
      (err: unknown) => {
        if (current) setChatError(mapWebinarError(err, t));
      },
    );
    return () => {
      current = false;
    };
  }, [client, participantId, webinar.id, t]);

  // In the lobby: join once a host has started (`webinar.state` live on the room).
  const retry = useEffectEvent(() => {
    if (client.getSnapshot().status === 'live') void connect();
  });
  useEffect(() => {
    if (!waiting) return undefined;
    // The room may have said `live` between the refused join and this subscription.
    const id = setTimeout(() => retry(), 0);
    const unsubscribe = client.subscribe(() => retry());
    return () => {
      clearTimeout(id);
      unsubscribe();
    };
  }, [waiting, client]);

  // CW-R-36b: leave the meeting once the webinar has ended.
  useEffect(() => {
    if (phase === 'ended') void controller.leave();
  }, [phase, controller]);

  const leave = async () => {
    await controller.leave();
    await navigate({ to: '/webinars/$webinarId', params: { webinarId: webinar.id } });
  };

  const sampleNotice = isSampleDataMode ? <Alert tone="info">{t('webinar.liveView.sampleNotice')}</Alert> : null;
  const back = (
    <Link to="/webinars/$webinarId" params={{ webinarId: webinar.id }} className="type-body text-primary underline underline-offset-[0.2em]">
      {t('webinar.liveView.back')}
    </Link>
  );

  let content: ReactNode;
  if (phase === 'prejoin') {
    content = (
      <Frame>
        {back}
        <header className="gap-1 flex flex-col">
          <Heading level={1} typeRole="screenTitle">
            {title}
          </Heading>
          <p className="type-body text-text-secondary">{t('webinar.liveView.prejoinBody')}</p>
        </header>
        {sampleNotice}
        <PreJoinCheck controller={controller} onJoin={() => void connect()} joining={joining} error={joinError} />
      </Frame>
    );
  } else if (phase === 'ended') {
    content = (
      <Frame>
        <section aria-labelledby="webinar-thanks-title" className="gap-3 p-6 max-w-xl flex flex-col rounded-card border border-border-subtle bg-surface" data-testid="webinar-thanks">
          <Heading level={1} typeRole="screenTitle" id="webinar-thanks-title">
            {t('webinar.liveView.thanksTitle')}
          </Heading>
          <p className="type-body">{t('webinar.ended')}</p>
          <p className="type-body text-text-secondary">{t('webinar.liveView.replayLater')}</p>
          <Link to="/webinars" className="type-body text-primary underline underline-offset-[0.2em]">
            {t('webinar.liveView.backToWebinars')}
          </Link>
        </section>
      </Frame>
    );
  } else {
    content = (
      <Frame>
        <Heading level={1} typeRole="screenTitle" className="sr-only">
          {title}
        </Heading>
        {sampleNotice}
        <Reveal show={waiting}>
          <Alert tone="info">{t('webinar.liveView.waitingForStart')}</Alert>
        </Reveal>
        <Reveal show={roomUnavailable}>
          <Alert tone="warning">{t('webinar.liveView.realtimeUnavailable')}</Alert>
        </Reveal>
        <div className="gap-4 flex flex-col lg:flex-row lg:items-start">
          <div className="h-[70dvh] min-h-96 lg:flex-1">
            <WebinarStage
              controller={controller}
              client={client}
              title={title}
              presenterNames={webinar.presenters.map((presenter) => presenter.displayName)}
              startsAt={webinar.startsAt}
              timeZone={webinar.timeZone}
              onLeave={() => void leave()}
            />
          </div>
          <aside aria-label={t('webinar.liveView.panelsLabel')} className="gap-4 lg:w-96 flex flex-col">
            <PollPanel client={client} />
            <ChatPanel client={client} error={chatError} />
          </aside>
        </div>
      </Frame>
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
