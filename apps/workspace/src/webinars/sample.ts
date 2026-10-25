/**
 * Sample mode (VITE_DATA_SOURCE=sample, CW-R-56): webinars come from
 * `SAMPLE_WEBINARS` in the employee's view (`WebinarResponse`: presenter first
 * names, no audience, no host ids); nothing is sent. The fixtures carry no
 * registrations, so every place is free and the employee is not registered.
 */
import { SAMPLE_CALL_SESSIONS, SAMPLE_PEOPLE, SAMPLE_WEBINAR_MESSAGES, SAMPLE_WEBINAR_POLLS, SAMPLE_WEBINARS } from '@nestself/sample-data';
import type { SampleWebinarContent } from '@nestself/video';
import type { WebinarResponse } from '@nestself/contracts';

type SampleWebinar = (typeof SAMPLE_WEBINARS)[number];

/** Statuses `GET /webinars` answers by default. */
const LISTED: ReadonlySet<string> = new Set(['published', 'live']);
/** Statuses `GET /webinars/:id` answers to an employee in the audience. */
const VISIBLE: ReadonlySet<string> = new Set(['published', 'live', 'ended']);

function toResponse(webinar: SampleWebinar): WebinarResponse {
  return {
    id: webinar.id,
    title: { ...webinar.title },
    description: { ...webinar.description },
    startsAt: webinar.startsAt,
    endsAt: webinar.endsAt,
    timeZone: webinar.timeZone,
    status: webinar.status,
    capacity: webinar.capacity,
    capacityRemaining: webinar.capacity,
    presenters: webinar.hosts.filter((host) => host.role === 'presenter').map((host) => ({ displayName: host.displayName })),
    registered: false,
  };
}

export function sampleWebinarList(): WebinarResponse[] {
  return SAMPLE_WEBINARS.filter((webinar) => LISTED.has(webinar.status)).map(toResponse);
}

export function sampleWebinar(webinarId: string): WebinarResponse | null {
  const webinar = SAMPLE_WEBINARS.find((candidate) => candidate.id === webinarId && VISIBLE.has(candidate.status));
  return webinar ? toResponse(webinar) : null;
}

/** The sample webinar session whose participants wrote `SAMPLE_WEBINAR_MESSAGES`. */
const SAMPLE_WEBINAR_SESSION_ID = 'call_session_sample_webinar';

/**
 * The live sample's content (sample-data rule): the people of the sample
 * webinar session, named from `SAMPLE_PEOPLE` (attendees) and the webinar's
 * hosts (first names), with `SAMPLE_WEBINAR_MESSAGES` and
 * `SAMPLE_WEBINAR_POLLS`. Nothing is sent anywhere.
 */
export function sampleWebinarContent(): SampleWebinarContent {
  const participants = SAMPLE_CALL_SESSIONS.find((session) => session.id === SAMPLE_WEBINAR_SESSION_ID)?.participants ?? [];
  const hostNames = new Map(SAMPLE_WEBINARS.flatMap((webinar) => webinar.hosts).map((host) => [host.userId, host.displayName]));
  const personName = (userId: string) => SAMPLE_PEOPLE.find((person) => person.id === userId)?.displayName ?? hostNames.get(userId) ?? userId;
  const hosts = participants
    .filter((participant) => participant.role === 'presenter' || participant.role === 'moderator')
    .map((participant) => ({ participantId: participant.id, name: hostNames.get(participant.userId) ?? personName(participant.userId), role: participant.role }));
  const attendees = participants
    .filter((participant) => participant.role === 'attendee')
    .map((participant) => ({ participantId: participant.id, name: personName(participant.userId), userId: participant.userId }));
  return {
    people: {
      moderator: hosts.find((host) => host.role === 'moderator')?.name ?? '',
      presenter: hosts.find((host) => host.role === 'presenter')?.name ?? '',
      attendees: attendees.map(({ participantId, name }) => ({ participantId, name })),
      hosts: hosts.map(({ participantId, name }) => ({ participantId, name })),
    },
    messages: SAMPLE_WEBINAR_MESSAGES,
    polls: SAMPLE_WEBINAR_POLLS,
  };
}

/** The sample attendee for a signed-in sample user: their own participant in the sample session, else the first attendee. */
export function sampleAttendee(userId: string | undefined): { participantId: string; name: string } {
  const participants = SAMPLE_CALL_SESSIONS.find((session) => session.id === SAMPLE_WEBINAR_SESSION_ID)?.participants ?? [];
  const own = participants.find((participant) => participant.role === 'attendee' && participant.userId === userId);
  const attendees = sampleWebinarContent().people.attendees;
  return attendees.find((attendee) => attendee.participantId === own?.id) ?? attendees[0] ?? { participantId: 'sample-attendee', name: 'Sample attendee' };
}
