/**
 * Sample mode (VITE_DATA_SOURCE=sample, CW-R-56): occurrences come from
 * `SAMPLE_WEBINARS` in the operations view (`Webinar`), the host pickers from
 * the sample principals holding `event.present` and `event.moderate`, and the
 * organisation picker from `SAMPLE_ORG`. Nothing is created, published or
 * canceled.
 */
import { SAMPLE_ORG, SAMPLE_PRINCIPALS, SAMPLE_WEBINARS } from '@nestself/sample-data';
import type { Webinar, WebinarResponse } from '@nestself/contracts';

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
