/**
 * Typed wrappers for the appointment and consultation call routes
 * (T-CW-1.5, guidelines 7.1 and 12.3, decision record section 7).
 *
 * Every method parses the response through the matching contracts schema.
 * `join` is the only method that returns meeting credentials: it asks the
 * browser not to cache the response (`cache: 'no-store'`, matching the
 * server's `Cache-Control: no-store`) and this module never logs or keeps
 * what it returns. The caller hands the response to the call controller and
 * drops it (CW-R-59, CW-R-69); there is deliberately no query or mutation
 * option for it, because both would hold the credentials in a cache.
 *
 * The follow-up methods serve T-CW-1.9's routes. Until those routes land the
 * server answers 404, which the apps render through their call error map.
 */
import { z } from 'zod';
import {
  AppointmentListResponseSchema,
  AppointmentResponseSchema,
  CLIENT_EVENT_BATCH_MAX,
  CallJoinResponseSchema,
  CallLocationResponseSchema,
} from '@nestself/contracts';
import type {
  AppointmentStatus,
  CallFeedbackRequest,
  CallJoinRequest,
  CallOutcomeRequest,
  CallSignalRequest,
  ClientEventRequest,
  FollowUpProposeRequest,
  FollowUpScheduleRequest,
  FollowUpSuggestTimesRequest,
} from '@nestself/contracts';
import type { ApiClient } from './client';

/** Query of `GET /appointments` (`AppointmentListQuerySchema`); every field is optional. */
export interface AppointmentListParams {
  limit?: number;
  cursor?: string;
  orgId?: string;
  status?: AppointmentStatus;
  /** Inclusive lower bound of `startsAt` (ISO date-time). */
  from?: string;
  /** Exclusive upper bound of `startsAt` (ISO date-time). */
  to?: string;
}

const NoContentSchema = z.undefined();

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  };
}

/** `?a=1&b=2` from the defined entries; empty string when none are defined. */
function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const appointmentPath = (id: string, suffix = '') => `/api/appointments/${encodeURIComponent(id)}${suffix}`;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createCallsApi(client: ApiClient) {
  return {
    /** GET /appointments: one cursor page of the caller's appointments (participants) or coordinated organizations (operations). */
    listAppointments: (params: AppointmentListParams = {}) =>
      client.request(`/api/appointments${queryString(params)}`, {
        method: 'GET',
        schema: AppointmentListResponseSchema,
      }),

    /** GET /appointments/:id */
    getAppointment: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId), {
        method: 'GET',
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/cancel */
    cancel: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/cancel'), {
        method: 'POST',
        schema: AppointmentResponseSchema,
      }),

    /**
     * POST /appointments/:id/join: Chime SDK credentials for this participant.
     * `locationText` only for the employee of a psychological consultation
     * (CALL-34). Not cached by the browser, never logged, never stored.
     */
    join: (appointmentId: string, body: CallJoinRequest = {}) =>
      client.request(appointmentPath(appointmentId, '/join'), {
        ...jsonPost(body),
        cache: 'no-store',
        schema: CallJoinResponseSchema,
      }),

    /** POST /appointments/:id/end: the expert ends the session for both (204). */
    end: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/end'), {
        method: 'POST',
        schema: NoContentSchema,
        expectBody: false,
      }),

    /** POST /appointments/:id/outcome: the expert records the delivery status; returns the updated appointment. */
    recordOutcome: (appointmentId: string, body: CallOutcomeRequest) =>
      client.request(appointmentPath(appointmentId, '/outcome'), {
        ...jsonPost(body),
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/feedback: the employee's private rating (204). */
    submitFeedback: (appointmentId: string, body: CallFeedbackRequest) =>
      client.request(appointmentPath(appointmentId, '/feedback'), {
        ...jsonPost(body),
        schema: NoContentSchema,
        expectBody: false,
      }),

    /** POST /appointments/:id/signal: "running late", "I cannot hear you", "I cannot see you" (204). */
    sendSignal: (appointmentId: string, signal: CallSignalRequest) =>
      client.request(appointmentPath(appointmentId, '/signal'), {
        ...jsonPost(signal),
        schema: NoContentSchema,
        expectBody: false,
      }),

    /** GET /appointments/:id/location: the location the employee shared, for the assigned expert (CALL-34). */
    getLocation: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/location'), {
        method: 'GET',
        cache: 'no-store',
        schema: CallLocationResponseSchema,
      }),

    /**
     * POST /calls/:sessionId/client-events: connection metadata of D-CW-13,
     * sent in batches of at most `CLIENT_EVENT_BATCH_MAX`. An empty list
     * sends nothing.
     */
    postClientEvents: async (sessionId: string, events: readonly ClientEventRequest[]): Promise<void> => {
      for (let start = 0; start < events.length; start += CLIENT_EVENT_BATCH_MAX) {
        await client.request(`/api/calls/${encodeURIComponent(sessionId)}/client-events`, {
          ...jsonPost({ events: events.slice(start, start + CLIENT_EVENT_BATCH_MAX) }),
          schema: NoContentSchema,
          expectBody: false,
        });
      }
    },

    /** POST /appointments/:id/follow-up: the expert proposes a follow-up; returns the new `proposed` appointment. */
    proposeFollowUp: (appointmentId: string, body: FollowUpProposeRequest) =>
      client.request(appointmentPath(appointmentId, '/follow-up'), {
        ...jsonPost(body),
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/confirm: the employee confirms a proposal. */
    confirmFollowUp: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/confirm'), {
        ...jsonPost({}),
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/suggest-times: the employee suggests one to three other windows. */
    suggestFollowUpTimes: (appointmentId: string, body: FollowUpSuggestTimesRequest) =>
      client.request(appointmentPath(appointmentId, '/suggest-times'), {
        ...jsonPost(body),
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/schedule: the expert picks one suggested window. */
    scheduleFollowUp: (appointmentId: string, body: FollowUpScheduleRequest) =>
      client.request(appointmentPath(appointmentId, '/schedule'), {
        ...jsonPost(body),
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/decline: the employee declines a proposal. */
    declineFollowUp: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/decline'), {
        ...jsonPost({}),
        schema: AppointmentResponseSchema,
      }),

    /**
     * A probe for the pre-join network check: times an authenticated,
     * uncached read of the appointment through the API, so the result
     * reflects the path to NestSelf rather than to the page's origin.
     */
    networkProbe:
      (appointmentId: string) =>
      async (): Promise<number> => {
        const started = now();
        await client.request(appointmentPath(appointmentId), {
          method: 'GET',
          cache: 'no-store',
          schema: z.unknown(),
        });
        return now() - started;
      },
  };
}

export type CallsApi = ReturnType<typeof createCallsApi>;
