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
 * the moderator a form to prepare polls. "End webinar" asks first and ends it
 * for everyone (`POST .../end`, WBN-21, WBN-29).
 *
 * The join response starts the controller once and is not kept (CW-R-59).
 * Sample mode runs on a scripted `FakeWebinarClient` and
 * `FakeCallSessionController`: nothing joins a meeting and nothing is sent.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StopCircle } from '@phosphor-icons/react';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  AlertDialogTrigger,
  AnimatePresence,
  Button,
  Field,
  Heading,
  Input,
  MotionFeatures,
  m,
  useMotionPreset,
} from '@nestself/ui';
import { createWebinarTransport } from '@nestself/api-client';
import { WEBINAR_POLL_OPTIONS_MAX, WEBINAR_POLL_OPTIONS_MIN, WebinarPollCreateRequestSchema } from '@nestself/contracts';
import type { WebinarHostRole, WebinarJoinResponse, WebinarMessage, WebinarModerationMessage, WebinarPoll, WebinarResponse, WebinarStatus } from '@nestself/contracts';
import {
  ChatPanel,
  FakeCallSessionController,
  FakeWebinarClient,
  ModeratorQueue,
  PollPanel,
  PreJoinCheck,
  WebinarClient,
  WebinarStage,
  createSampleWebinarServer,
} from '@nestself/video';
import type { CallSessionControllerApi, WebinarClientApi } from '@nestself/video';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { useConsultationController } from '../calls/use-consultation-controller';
import { Reveal } from '../calls/reveal';
import { mapWebinarError } from './map-webinar-error';
import { useLocalized, useWebinarWhen } from './webinar-format';
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

function EndWebinar({ pending, onEnd }: { pending: boolean; onEnd: () => void }) {
  const { t } = useTranslation('calls');
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button size="sm" variant="danger" leadingIcon={<StopCircle size={18} />} loading={pending} loadingLabel={t('webinar.console.ending')}>
          {t('webinar.console.end')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        title={t('webinar.console.endTitle')}
        description={t('webinar.console.endBody')}
        confirmLabel={t('webinar.console.end')}
        cancelLabel={t('webinar.console.keepGoing')}
        destructive
        confirmPending={pending}
        onConfirm={onEnd}
      />
    </AlertDialog>
  );
}

const noSubscription = () => () => undefined;

/** The client's status, re-rendering on change; null before a client exists. */
function useClientStatus(client: WebinarClientApi | null): WebinarStatus | null {
  return useSyncExternalStore(client ? client.subscribe : noSubscription, () => client?.getSnapshot().status ?? null);
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
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [roomUnavailable, setRoomUnavailable] = useState(false);

  const client = useHostClient(webinar, role, controller, () => setRoomUnavailable(true));
  const title = localized(webinar.title);
  const registered = webinar.capacity - webinar.capacityRemaining;
  const isModerator = (client?.getSnapshot().role ?? role) === 'moderator';
  const status = useClientStatus(client);

  const join = async () => {
    setJoinError(null);
    if (isSampleDataMode && controller instanceof FakeCallSessionController && client) {
      setJoined(true);
      await controller.join();
      const start = Date.now();
      controller.simulate.connected({ startsAt: new Date(start).toISOString(), endsAt: new Date(start + 60 * MINUTE_MS).toISOString() });
      return;
    }
    setJoining(true);
    try {
      const response = await webinarsApi.join(webinar.id);
      if (response.role === 'attendee') throw new Error('An attendee cannot open the host view');
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
    webinarsApi.listMessages(webinar.id).then(
      (page) => {
        if (!current) return;
        setChatError(null);
        const items: readonly (WebinarMessage | WebinarModerationMessage)[] = page.items;
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
    } catch (err) {
      setStageError(mapWebinarError(err, t));
    } finally {
      setStarting(false);
    }
  };

  const end = async () => {
    if (!client) return;
    setStageError(null);
    if (isSampleDataMode && client instanceof FakeWebinarClient) {
      client.simulate.end();
      return;
    }
    setEnding(true);
    try {
      const response = await webinarsApi.end(webinar.id);
      client.hydrate({ status: response.status });
    } catch (err) {
      setStageError(mapWebinarError(err, t));
    } finally {
      setEnding(false);
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
        <PreJoinCheck controller={controller} onJoin={() => void join()} joining={joining} error={joinError} />
      </Frame>
    );
  } else {
    const live = status === 'live';
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
              header={live ? <EndWebinar pending={ending} onEnd={() => void end()} /> : null}
              error={stageError}
            />
          </div>
          <aside aria-label={t('webinar.moderation.title')} className="gap-4 xl:w-[28rem] flex flex-col">
            <ModeratorQueue client={client} />
            <PollPanel client={client} />
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
