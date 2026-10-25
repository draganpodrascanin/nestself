/**
 * Sample webinars, webinar chat messages and a poll for the calls and
 * webinars epic (NS-CALLS-01, T-CW-0.7). Shaped after the `webinars`,
 * `webinar_hosts`, `webinar_messages`, `webinar_polls`,
 * `webinar_poll_options` and `webinar_poll_results` tables (implementation
 * guidelines 5.2) with the lower-case contract spellings.
 *
 * Every webinar is recorded (D-CW-34), so there is no recording switch.
 * Titles are neutral, never clinical labels. Hosts are sample people shown by
 * first name only. The chat and the poll belong to the ended webinar and its
 * session (`call_session_sample_webinar` in `appointments.ts`).
 */
import {
  WEBINAR_SINGLE_MEETING_CAPACITY,
  type CallParticipantRole,
  type WebinarMessageKind,
  type WebinarMessageStatus,
} from '@nestself/contracts';

/** The four locales, kept in sync with @nestself/i18n's Locale. */
type SampleLocale = 'en' | 'sr-Latn' | 'sr-Cyrl' | 'hu';

/**
 * `webinar_status` (decision record section 7). The contracts package has no
 * webinar status yet; it arrives with the webinar schema in T-CW-2.1, which
 * should replace this alias with the contract type.
 */
export type SampleWebinarStatus = 'draft' | 'published' | 'live' | 'ended' | 'canceled';

/** A `webinar_hosts` row: a presenter or the moderator. */
export interface SampleWebinarHost {
  readonly userId: string;
  readonly role: Extract<CallParticipantRole, 'presenter' | 'moderator'>;
  /** First name only. */
  readonly displayName: string;
}

/** A `webinars` row with its hosts. */
export interface SampleWebinar {
  readonly id: string;
  /** Null for the `all_eligible` audience (CW-R-23). */
  readonly orgId: string | null;
  // Per locale here, while the 5.2 `title` and `description` columns are single
  // text: the T-CW-2.1 seed inserts the `sr-Latn` value (the platform default);
  // the other locales are kept for the sample-mode UI.
  readonly title: Readonly<Record<SampleLocale, string>>;
  readonly description: Readonly<Record<SampleLocale, string>>;
  /** `all_eligible`, or the organisation id of an organisation-scoped occurrence (D-CW-17). */
  readonly audiencePolicy: string;
  readonly capacity: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly status: SampleWebinarStatus;
  readonly chatPolicy: 'moderated';
  readonly createdByUserId: string;
  readonly hosts: readonly SampleWebinarHost[];
  readonly sample: true;
}

/** A `webinar_messages` row: a host post, an attendee message or a question (D-CW-35). */
export interface SampleWebinarMessage {
  readonly id: string;
  readonly webinarId: string;
  readonly sessionId: string;
  readonly kind: WebinarMessageKind;
  readonly status: WebinarMessageStatus;
  /** A `call_participants` id of the webinar session. */
  readonly authorParticipantId: string | null;
  readonly text: string;
  /** Anonymous towards the audience unless the attendee attached the first name. */
  readonly showFirstName: boolean;
  readonly publishedAt: string | null;
  readonly answerText: string | null;
  readonly createdAt: string;
  readonly sample: true;
}

/** A `webinar_poll_options` row. */
export interface SampleWebinarPollOption {
  readonly id: string;
  readonly label: string;
  readonly position: number;
}

/** A `webinar_poll_results` row: an aggregate count, never a voter (CW-R-24). */
export interface SampleWebinarPollResult {
  readonly optionId: string;
  readonly count: number;
}

/** A `webinar_polls` row with its options and results. */
export interface SampleWebinarPoll {
  readonly id: string;
  readonly webinarId: string;
  readonly sessionId: string;
  readonly question: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly options: readonly SampleWebinarPollOption[];
  readonly results: readonly SampleWebinarPollResult[];
  readonly sample: true;
}

const ENDED_ID = 'webinar_sample_ended';
const ENDED_SESSION_ID = 'call_session_sample_webinar';
const PRESENTER_PARTICIPANT_ID = 'call_participant_sample_presenter';
const MODERATOR_PARTICIPANT_ID = 'call_participant_sample_moderator';

const PRESENTER: SampleWebinarHost = { userId: 'user_milica', role: 'presenter', displayName: 'Milica' };

/**
 * The org-less occurrence needs a moderator whose `event.moderate` reaches
 * every organisation (a platform-scoped grant): the platform administrator.
 * Nikola (`client_operations`) reaches only the sample organisation, so he
 * moderates its own occurrence, as in its session (`appointments.ts`).
 */
const UPCOMING_HOSTS: readonly SampleWebinarHost[] = [
  PRESENTER,
  { userId: 'user_admin', role: 'moderator', displayName: 'Platform' },
];
const ENDED_HOSTS: readonly SampleWebinarHost[] = [
  PRESENTER,
  { userId: 'user_nikola', role: 'moderator', displayName: 'Nikola' },
];

export const SAMPLE_WEBINARS: readonly SampleWebinar[] = [
  {
    // Run by NestSelf for every eligible client organisation (F-CW-08).
    // 25 November 2026, 17:00 to 18:00 in Belgrade.
    id: 'webinar_sample_upcoming',
    orgId: null,
    title: {
      en: 'Planning a balanced working week',
      'sr-Latn': 'Planiranje uravnotežene radne nedelje',
      'sr-Cyrl': 'Планирање уравнотежене радне недеље',
      hu: 'Kiegyensúlyozott munkahét tervezése',
    },
    description: {
      en: 'Practical ways to plan your week so that work, rest and personal time each have their place.',
      'sr-Latn':
        'Praktični načini da isplanirate nedelju tako da posao, odmor i lično vreme imaju svoje mesto.',
      'sr-Cyrl':
        'Практични начини да испланирате недељу тако да посао, одмор и лично време имају своје место.',
      hu: 'Gyakorlati módszerek a hét megtervezéséhez, hogy a munkának, a pihenésnek és a saját időnek is legyen helye.',
    },
    audiencePolicy: 'all_eligible',
    capacity: WEBINAR_SINGLE_MEETING_CAPACITY,
    startsAt: '2026-11-25T16:00:00.000Z',
    endsAt: '2026-11-25T17:00:00.000Z',
    timeZone: 'Europe/Belgrade',
    status: 'published',
    chatPolicy: 'moderated',
    createdByUserId: 'user_nikola',
    hosts: UPCOMING_HOSTS,
    sample: true,
  },
  {
    // Requested by the sample organisation for its own members (F-CW-08).
    // 15 October 2026, 17:00 to 18:00 in Belgrade.
    id: ENDED_ID,
    orgId: 'org_sample',
    title: {
      en: 'Taking breaks during the working day',
      'sr-Latn': 'Pauze tokom radnog dana',
      'sr-Cyrl': 'Паузе током радног дана',
      hu: 'Szünetek a munkanap során',
    },
    description: {
      en: 'Short, simple breaks that fit into a working day, at the desk or away from it.',
      'sr-Latn': 'Kratke i jednostavne pauze koje se uklapaju u radni dan, za stolom ili dalje od njega.',
      'sr-Cyrl': 'Кратке и једноставне паузе које се уклапају у радни дан, за столом или даље од њега.',
      hu: 'Rövid, egyszerű szünetek, amelyek beilleszthetők a munkanapba, az íróasztalnál vagy attól távol.',
    },
    audiencePolicy: 'org_sample',
    capacity: 100,
    startsAt: '2026-10-15T15:00:00.000Z',
    endsAt: '2026-10-15T16:00:00.000Z',
    timeZone: 'Europe/Belgrade',
    status: 'ended',
    chatPolicy: 'moderated',
    createdByUserId: 'user_nikola',
    hosts: ENDED_HOSTS,
    sample: true,
  },
];

const messageBase = { webinarId: ENDED_ID, sessionId: ENDED_SESSION_ID, sample: true } as const;

/**
 * Two host posts (published at once, CW-R-103), two attendee messages (one
 * published with the first name attached, one still pending) and one
 * anonymous question the presenter answered.
 */
export const SAMPLE_WEBINAR_MESSAGES: readonly SampleWebinarMessage[] = [
  {
    ...messageBase,
    id: 'webinar_message_sample_1',
    kind: 'host',
    status: 'published',
    authorParticipantId: MODERATOR_PARTICIPANT_ID,
    text: 'Welcome, everyone. We are starting now.',
    showFirstName: false,
    publishedAt: '2026-10-15T15:01:00.000Z',
    answerText: null,
    createdAt: '2026-10-15T15:01:00.000Z',
  },
  {
    ...messageBase,
    id: 'webinar_message_sample_2',
    kind: 'attendee',
    status: 'published',
    authorParticipantId: 'call_participant_sample_attendee_jovan',
    text: 'Thank you, the sound and the slides are clear.',
    showFirstName: true,
    publishedAt: '2026-10-15T15:06:00.000Z',
    answerText: null,
    createdAt: '2026-10-15T15:05:00.000Z',
  },
  {
    ...messageBase,
    id: 'webinar_message_sample_3',
    kind: 'host',
    status: 'published',
    authorParticipantId: PRESENTER_PARTICIPANT_ID,
    text: 'Questions are welcome in the chat. We will take them at the end.',
    showFirstName: false,
    publishedAt: '2026-10-15T15:20:00.000Z',
    answerText: null,
    createdAt: '2026-10-15T15:20:00.000Z',
  },
  {
    ...messageBase,
    id: 'webinar_message_sample_4',
    kind: 'question',
    status: 'answered',
    authorParticipantId: 'call_participant_sample_attendee_ana',
    text: 'How long should a short break be?',
    showFirstName: false,
    publishedAt: '2026-10-15T15:45:00.000Z',
    answerText:
      'There is no single right length. Start with a few minutes away from the screen and adjust it to your day.',
    createdAt: '2026-10-15T15:25:00.000Z',
  },
  {
    ...messageBase,
    id: 'webinar_message_sample_5',
    kind: 'attendee',
    status: 'pending',
    authorParticipantId: 'call_participant_sample_attendee_ana',
    text: 'Could you show the stretching example once more?',
    showFirstName: false,
    publishedAt: null,
    answerText: null,
    createdAt: '2026-10-15T15:32:00.000Z',
  },
];

export const SAMPLE_WEBINAR_POLLS: readonly SampleWebinarPoll[] = [
  {
    id: 'webinar_poll_sample',
    webinarId: ENDED_ID,
    sessionId: ENDED_SESSION_ID,
    question: 'Which break would you like to try this week?',
    openedAt: '2026-10-15T15:35:00.000Z',
    closedAt: '2026-10-15T15:40:00.000Z',
    options: [
      { id: 'webinar_poll_option_sample_1', label: 'A short walk', position: 0 },
      { id: 'webinar_poll_option_sample_2', label: 'Stretching at the desk', position: 1 },
      { id: 'webinar_poll_option_sample_3', label: 'A cup of tea away from the screen', position: 2 },
    ],
    results: [
      { optionId: 'webinar_poll_option_sample_1', count: 1 },
      { optionId: 'webinar_poll_option_sample_2', count: 1 },
      { optionId: 'webinar_poll_option_sample_3', count: 0 },
    ],
    sample: true,
  },
];
