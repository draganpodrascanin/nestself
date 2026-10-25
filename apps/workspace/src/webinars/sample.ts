/**
 * Sample mode (VITE_DATA_SOURCE=sample, CW-R-56): webinars come from
 * `SAMPLE_WEBINARS` in the employee's view (`WebinarResponse`: presenter first
 * names, no audience, no host ids); nothing is sent. The fixtures carry no
 * registrations, so every place is free and the employee is not registered.
 */
import { SAMPLE_WEBINARS } from '@nestself/sample-data';
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
