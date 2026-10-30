/**
 * Sample mode (VITE_DATA_SOURCE=sample, CW-R-56): occurrences come from
 * `SAMPLE_WEBINARS` in the operations view (`Webinar`), the host pickers from
 * the sample principals holding `event.present` and `event.moderate`, and the
 * organisation picker from `SAMPLE_ORG`. Nothing is created, published or
 * canceled.
 */
import {
  SAMPLE_CALL_SESSIONS,
  SAMPLE_ORG,
  SAMPLE_PEOPLE,
  SAMPLE_PRINCIPALS,
  SAMPLE_WEBINAR_ATTENDANCE,
  SAMPLE_WEBINAR_MESSAGES,
  SAMPLE_WEBINAR_POLLS,
  SAMPLE_WEBINARS,
} from '@nestself/sample-data';
import type { SampleWebinarContent } from '@nestself/video';
import type { RecordingStatus, Webinar, WebinarAttendanceResponse, WebinarResponse } from '@nestself/contracts';

type SampleWebinar = (typeof SAMPLE_WEBINARS)[number];

function toOccurrence(webinar: SampleWebinar): Webinar {
  return {
    id: webinar.id,
    orgId: webinar.orgId,
    title: { ...webinar.title },
    description: { ...webinar.description },
    audiencePolicy: webinar.audiencePolicy === 'all_eligible' ? { type: 'all_eligible' } : { type: 'organization', orgIds: [webinar.audiencePolicy] },
    capacity: webinar.capacity,
    startsAt: webinar.startsAt,
    endsAt: webinar.endsAt,
    timeZone: webinar.timeZone,
    status: webinar.status,
    chatPolicy: webinar.chatPolicy,
    createdByUserId: webinar.createdByUserId,
    hosts: webinar.hosts.map((host) => ({ ...host })),
  };
}

export function sampleOccurrences(): Webinar[] {
  return SAMPLE_WEBINARS.map(toOccurrence);
}

export function sampleOccurrence(webinarId: string): Webinar | null {
  const webinar = SAMPLE_WEBINARS.find((candidate) => candidate.id === webinarId);
  return webinar ? toOccurrence(webinar) : null;
}

/** The host's view of a sample occurrence (`GET /webinars/:id`). */
export function sampleHostView(webinarId: string): WebinarResponse | null {
  const webinar = sampleOccurrence(webinarId);
  if (!webinar) return null;
  return {
    id: webinar.id,
    title: webinar.title,
    description: webinar.description,
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

/** The ended sample webinar's attendance (`SAMPLE_WEBINAR_ATTENDANCE`); the others have none yet. */
export function sampleAttendance(webinarId: string): WebinarAttendanceResponse | null {
  if (SAMPLE_WEBINAR_ATTENDANCE.webinarId !== webinarId) return null;
  const { sample: _sample, ...attendance } = SAMPLE_WEBINAR_ATTENDANCE;
  return { ...attendance, registrants: attendance.registrants.map((row) => ({ ...row })) };
}

/** The sample recording state: recording while live, ready once ended (every webinar is recorded, D-CW-34). */
export function sampleRecordingStatus(webinar: Pick<Webinar, 'status'>): RecordingStatus | null {
  if (webinar.status === 'live') return 'recording';
  if (webinar.status === 'ended') return 'ready';
  return null;
}

export interface PickerOption {
  value: string;
  label: string;
}

function holders(action: string): PickerOption[] {
  return Object.values(SAMPLE_PRINCIPALS)
    .filter((sample) => sample.effectiveActions.includes(action))
    .map((sample) => ({ value: sample.principal.userId, label: sample.principal.displayName }));
}

export const SAMPLE_PRESENTER_OPTIONS: readonly PickerOption[] = holders('event.present');
export const SAMPLE_MODERATOR_OPTIONS: readonly PickerOption[] = holders('event.moderate');
export const SAMPLE_ORGANIZATION_OPTIONS: readonly PickerOption[] = [{ value: SAMPLE_ORG.id, label: SAMPLE_ORG.name }];

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
