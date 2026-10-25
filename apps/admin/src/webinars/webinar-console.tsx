/**
 * The hosts' live webinar (WBN-16 to WBN-29): the presenter view and the
 * moderator console.
 *
 * Before joining, the pre-webinar check (camera, microphone, speaker and
 * network) with the session details: title, scheduled time and the number of
 * registrations, never names (WBN-16). After joining, the host stage
 * (`WebinarStage` with the existing `ControlBar` and the separate screen
 * share control) with "Start webinar" in the lobby (`POST .../start`, WBN-17),
 * and beside it `ModeratorQueue` (attendance count, raised hands, give and
 * take the floor, and for the moderator the review queue and the early
 * "Stop recording" with its confirmation), the poll panel, the chat, and for
 * the moderator a form to prepare polls. The stage's "End webinar for
 * everyone" asks first and ends it for everyone (`POST .../end` through the
 * client's `webinar.end` action, WBN-21, WBN-29).
 *
 * The join response starts the controller once and is not kept (CW-R-59).
 * Sample mode runs on a scripted `FakeWebinarClient` and
 * `FakeCallSessionController`: nothing joins a meeting and nothing is sent.
 */
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AnimatePresence,
  Button,
  Field,
  Heading,
  Input,
  MotionFeatures,
  m,
  useMotionPreset,
} from '@nestself/ui';
import { createWebinarTransport, startClientEventPoster, webinarKeys } from '@nestself/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { WEBINAR_MESSAGE_LIST_MAX_LIMIT, WEBINAR_POLL_OPTIONS_MAX, WEBINAR_POLL_OPTIONS_MIN, WebinarPollCreateRequestSchema } from '@nestself/contracts';
import type {
  RecordingStatus,
  WebinarHostRole,
  WebinarJoinResponse,
  WebinarMessage,
  WebinarModerationMessage,
  WebinarPoll,
  WebinarResponse,
} from '@nestself/contracts';
import {
  ChatPanel,
  FakeCallSessionController,
  FakeWebinarClient,
  ModeratorQueue,
  PollPanel,
  PreJoinCheck,
  SessionTimer,
  WebinarClient,
  WebinarStage,
  createSampleWebinarServer,
} from '@nestself/video';
import type { CallSessionControllerApi, WebinarClientApi } from '@nestself/video';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { useConsultationController } from '../calls/use-consultation-controller';
import { callsApi } from '../calls/calls-api';
import { Reveal } from '../calls/reveal';
import { mapWebinarError } from './map-webinar-error';
import { hostJoinWindow, useLocalized, useNow, useWebinarWhen } from './webinar-format';
import { useZonedFormat } from '../calls/format';
import { canListWebinars } from './route-gate';
import { webinarRoomClient } from './webinar-room-client';
import { webinarsApi } from './webinars-api';

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

/** Sample mode: the operations principals moderate the sample webinars, the expert presents. */
function sampleRole(effectiveActions: readonly string[]): WebinarHostRole {
  return effectiveActions.includes('event.moderate') ? 'moderator' : 'presenter';
}

function useHostClient(webinar: WebinarResponse, role: WebinarHostRole | null, controller: CallSessionControllerApi, onUnavailable: () => void): WebinarClientApi | null {
  const { principal, effectiveActions } = useAuth();
  const [sample] = useState(() => {
    if (!isSampleDataMode) return null;
    const server = createSampleWebinarServer({ webinarId: webinar.id, status: 'published', pending: true, hands: true, poll: 'prepared', chat: true });
    const sampleHost = sampleRole(effectiveActions);
    return new FakeWebinarClient({ server, role: sampleHost, name: principal?.displayName ?? null, audio: controller });
  });
  const live = useMemo(() => {
    if (sample || !role) return null;
    return new WebinarClient({
      webinarId: webinar.id,
      role,
      audio: controller,
      // Hosts receive no floor events, so the user room is not joined.
      transport: createWebinarTransport({ api: webinarsApi, rooms: webinarRoomClient, webinarId: webinar.id, onUnavailable }),
      initial: { status: webinar.status },
    });
    // The detail's status seeds a new client only; `onUnavailable` is a state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, role, webinar.id, controller]);
  return sample ?? live;
}

/** The moderator prepares a poll (WBN-27); `PollPanel` opens and closes it. */
function PollCreator({ webinarId, client }: { webinarId: string; client: WebinarClientApi }) {
  const { t } = useTranslation('calls');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);
  const [form, setForm] = useState(0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOutcome(null);
    const data = new FormData(event.currentTarget);
    const options = Array.from({ length: WEBINAR_POLL_OPTIONS_MAX }, (_, index) => String(data.get(`option-${index}`) ?? '').trim()).filter(Boolean);
    const request = WebinarPollCreateRequestSchema.safeParse({ question: String(data.get('question') ?? ''), options });
    if (!request.success) {
      setOutcome({ tone: 'danger', message: t('webinar.console.pollInvalid') });
      return;
    }
    setPending(true);
    try {
      let poll: WebinarPoll;
      if (isSampleDataMode && client instanceof FakeWebinarClient) {
        const id = `sample-poll-${Date.now()}`;
        poll = {
          id,
          webinarId,
          question: request.data.question,
          options: request.data.options.map((label, position) => ({ id: `${id}-${position}`, label, position })),
          openedAt: null,
          closedAt: null,
        };
        client.server.addPoll(poll);
      } else {
        poll = await webinarsApi.createPoll(webinarId, request.data);
      }
      client.hydrate({ polls: [poll] });
      setOutcome({ tone: 'success', message: t('webinar.console.pollCreated') });
      setForm((value) => value + 1);
    } catch (err) {
      setOutcome({ tone: 'danger', message: mapWebinarError(err, t) });
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby="webinar-poll-creator" className="gap-3 p-4 flex flex-col rounded-card border border-border-subtle bg-raised">
      <Heading level={2} typeRole="sectionTitle" id="webinar-poll-creator">
        {t('webinar.console.pollTitle')}
      </Heading>
      <form key={form} noValidate onSubmit={(event) => void submit(event)} className="gap-3 flex flex-col">
        <Field label={t('webinar.console.pollQuestion')}>
          <Input name="question" autoComplete="off" />
        </Field>
        {Array.from({ length: 4 }, (_, index) => (
          <Field key={index} label={t('webinar.console.pollOption', { number: index + 1 })} optionalLabel={index >= WEBINAR_POLL_OPTIONS_MIN ? t('location.optional') : undefined}>
            <Input name={`option-${index}`} autoComplete="off" density="compact" />
          </Field>
        ))}
        <Button type="submit" variant="secondary" className="self-start" loading={pending} loadingLabel={t('webinar.console.pollCreating')}>
          {t('webinar.console.pollCreate')}
        </Button>
      </form>
      <Reveal show={outcome !== null}>
        <Alert tone={outcome?.tone ?? 'success'}>{outcome?.message}</Alert>
      </Reveal>
    </section>
  );
}

/** At most this many pages of 200 messages are read when the console opens. */
const MESSAGE_PAGES_MAX = 20;

/** `GET /webinars/:id/messages` page by page through `nextCursor`. */
async function loadAllMessages(webinarId: string): Promise<(WebinarMessage | WebinarModerationMessage)[]> {
  const items: (WebinarMessage | WebinarModerationMessage)[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MESSAGE_PAGES_MAX; pageNumber += 1) {
    const page = await webinarsApi.listMessages(webinarId, { cursor, limit: WEBINAR_MESSAGE_LIST_MAX_LIMIT });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="gap-4 flex flex-col">{children}</div>;
}

export function WebinarConsole({ webinar }: { webinar: WebinarResponse }) {
  const { t } = useTranslation('calls');
  const navigate = useNavigate();
  const { principal, effectiveActions } = useAuth();
  const localized = useLocalized();
  const when = useWebinarWhen();
  const phaseMotion = useMotionPreset('backdrop');
  const controller = useConsultationController({ role: 'presenter', format: 'webinar' });

  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState<WebinarHostRole | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [roomUnavailable, setRoomUnavailable] = useState(false);
  // The join response's recording state; undefined until joined, null when the response carries none.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [joinRecording, setJoinRecording] = useState<RecordingStatus | null | undefined>(undefined);
  const queryClient = useQueryClient();
  const format = useZonedFormat();
  const { opensAt } = hostJoinWindow(webinar);
  const now = useNow(!isSampleDataMode);
  // Hosts may join from 30 minutes before the start (WBN-16); the demonstration is open at any time.
  const opensLater = !isSampleDataMode && now < opensAt.getTime() ? t('webinar.detail.joinOpensAt', { time: format.time(opensAt, webinar.timeZone) }) : null;

  const client = useHostClient(webinar, role, controller, () => setRoomUnavailable(true));
  const title = localized(webinar.title);
  const registered = webinar.capacity - webinar.capacityRemaining;
  const isModerator = (client?.getSnapshot().role ?? role) === 'moderator';

  // PLT-18: the controller's client-event log goes to `POST /calls/:sessionId/client-events` every 30 s and on leave.
  useEffect(() => {
    if (!joined) return undefined;
    const poster = startClientEventPoster({
      drain: () => controller.drainClientEvents(),
      post: (events) => (isSampleDataMode || !sessionId ? Promise.resolve() : callsApi.postClientEvents(sessionId, events)),
    });
    return () => {
      void poster.stop();
    };
  }, [joined, sessionId, controller]);

  const join = async () => {
    setJoinError(null);
    if (isSampleDataMode && controller instanceof FakeCallSessionController && client) {
      setJoined(true);
      await controller.join();
      const start = Date.now();
      controller.simulate.connected({ startsAt: new Date(start).toISOString(), endsAt: new Date(start + 60 * MINUTE_MS).toISOString() });
      return;
    }
    if (Date.now() < opensAt.getTime()) {
      setJoinError(t('webinar.detail.joinOpensAt', { time: format.time(opensAt, webinar.timeZone) }));
      return;
    }
    setJoining(true);
    try {
      const response = await webinarsApi.join(webinar.id);
      if (response.role === 'attendee') throw new Error('An attendee cannot open the host view');
      setRoomUnavailable(false);
      setJoinRecording(response.recordingStatus ?? null);
      setSessionId(response.sessionId);
      setRole(response.role);
      setJoined(true);
      // A failure to connect media is shown by the stage through the controller's state.
      await controller.join(toCallJoin(response)).catch(() => undefined);
    } catch (err) {
      setJoinError(mapWebinarError(err, t));
    } finally {
      setJoining(false);
    }
  };

  // The chat so far: every message with the registration name for the moderator, the published ones for a presenter.
  useEffect(() => {
    if (isSampleDataMode || !client || !role) return undefined;
    let current = true;
    loadAllMessages(webinar.id).then(
      (items) => {
        if (!current) return;
        setChatError(null);
        const moderation = items.filter((item): item is WebinarModerationMessage => 'authorName' in item);
        if (moderation.length > 0 || role === 'moderator') client.hydrate({ moderationMessages: moderation });
        else client.hydrate({ publicMessages: items });
      },
      (err: unknown) => {
        if (current) setChatError(mapWebinarError(err, t));
      },
    );
    return () => {
      current = false;
    };
  }, [client, role, webinar.id, t]);

  // The polls so far with their results, for a reloaded console (the moderator gets every poll).
  useEffect(() => {
    if (isSampleDataMode || !client || !role) return undefined;
    let current = true;
    webinarsApi.listPolls(webinar.id).then(
      (page) => {
        if (!current) return;
        setPollError(null);
        client.hydrate({ polls: page.items.map((item) => item.poll), results: page.items.flatMap((item) => (item.results ? [item.results] : [])) });
      },
      (err: unknown) => {
        if (current) setPollError(mapWebinarError(err, t));
      },
    );
    return () => {
      current = false;
    };
  }, [client, role, webinar.id, t]);

  /**
   * The REC indicator from the server (UX-45): the join response's state when
   * it carries one, else `GET /webinars/:id/recording`. If neither answers,
   * the `webinar.recording` events still drive it.
   */
  useEffect(() => {
    if (isSampleDataMode || !client || joinRecording === undefined) return undefined;
    if (joinRecording) {
      client.hydrate({ recordingStatus: joinRecording });
      return undefined;
    }
    let current = true;
    webinarsApi.recording(webinar.id).then(
      (recording) => {
        if (current) client.hydrate({ recordingStatus: recording.status });
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, joinRecording, webinar.id]);

  const start = async () => {
    if (!client) return;
    setStageError(null);
    if (isSampleDataMode && client instanceof FakeWebinarClient) {
      client.simulate.start();
      client.simulate.attendance(86);
      return;
    }
    setStarting(true);
    try {
      const response = await webinarsApi.start(webinar.id);
      client.hydrate({ status: response.status });
      void queryClient.invalidateQueries({ queryKey: webinarKeys.all });
    } catch (err) {
      setStageError(mapWebinarError(err, t));
    } finally {
      setStarting(false);
    }
  };

  const leave = async () => {
    await controller.leave();
    if (canListWebinars(principal, effectiveActions)) await navigate({ to: '/webinars/$webinarId', params: { webinarId: webinar.id } });
    else await navigate({ to: '/' });
  };

  const sampleNotice = isSampleDataMode ? <Alert tone="info">{t('webinar.console.sampleNotice')}</Alert> : null;

  let content: ReactNode;
  if (!joined || !client) {
    content = (
      <Frame>
        {canListWebinars(principal, effectiveActions) ? (
          <Link to="/webinars/$webinarId" params={{ webinarId: webinar.id }} className="type-body text-primary underline underline-offset-[0.2em]">
            {t('webinar.console.backToWebinar')}
          </Link>
        ) : null}
        <header className="gap-1 flex flex-col">
          <Heading level={1} typeRole="screenTitle">
            {title}
          </Heading>
          <p className="type-body text-text-secondary">{when(webinar)}</p>
          <p className="type-body" data-testid="webinar-console-registered">
            {t('webinar.console.registered', { count: registered })}
          </p>
        </header>
        {sampleNotice}
        <p className="p-3 rounded-control bg-info-surface text-info type-body">{t('webinar.startHint')}</p>
        {opensLater ? (
          <Alert tone="info">
            <span data-testid="webinar-console-opens">{opensLater}</span>
          </Alert>
        ) : null}
        <PreJoinCheck controller={controller} onJoin={() => void join()} joining={joining} error={joinError} />
      </Frame>
    );
  } else {
    content = (
      <Frame>
        <Heading level={1} typeRole="screenTitle" className="sr-only">
          {title}
        </Heading>
        {sampleNotice}
        <Reveal show={roomUnavailable}>
          <Alert tone="warning">{t('webinar.liveView.realtimeUnavailable')}</Alert>
        </Reveal>
        <div className="gap-4 flex flex-col xl:flex-row xl:items-start">
          <div className="h-[70dvh] min-h-96 xl:flex-1">
            <WebinarStage
              controller={controller}
              client={client}
              title={title}
              presenterNames={webinar.presenters.map((presenter) => presenter.displayName)}
              startsAt={webinar.startsAt}
              timeZone={webinar.timeZone}
              onLeave={() => void leave()}
              onStart={() => void start()}
              startPending={starting}
              // The stage's own "End webinar for everyone" (WBN-21) ends it through the client; the lists then refresh.
              onEnd={() => void queryClient.invalidateQueries({ queryKey: webinarKeys.all })}
              // WBN-19: the elapsed and remaining time of the scheduled window.
              header={<SessionTimer startsAt={webinar.startsAt} endsAt={webinar.endsAt} participantRole={client.getSnapshot().role} />}
              error={stageError}
            />
          </div>
          <aside aria-label={t('webinar.moderation.title')} className="gap-4 xl:w-[28rem] flex flex-col">
            <ModeratorQueue client={client} />
            <PollPanel client={client} error={pollError} />
            {isModerator ? <PollCreator webinarId={webinar.id} client={client} /> : null}
            <ChatPanel client={client} error={chatError} />
          </aside>
        </div>
      </Frame>
    );
  }

  return (
    <MotionFeatures>
      <AnimatePresence mode="wait" initial={false}>
        <m.div key={joined ? 'stage' : 'prejoin'} {...phaseMotion}>
          {content}
        </m.div>
      </AnimatePresence>
    </MotionFeatures>
  );
}
