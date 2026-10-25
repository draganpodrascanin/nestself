/**
 * Webinars: status lifecycle, audience policy, occurrence, registration,
 * join, chat, hand-raise, floor, polls, attendance and recording schemas, and
 * the events of the `webinar:{webinarId}` and `webinar:{webinarId}:moderation`
 * rooms.
 *
 * Contract spellings are lower case; the database stores UPPER_CASE and the
 * repository maps them (CW-R-19a). The webinar error codes live in
 * `CALL_ERROR_CODES` (`calls.ts`), not here.
 *
 * Anonymity is a contract property (D-CW-15, D-CW-30): every payload an
 * attendee or a presenter receives is a strict object with no name, email or
 * user id, except the first name an attendee chose to attach to a message.
 * Only the moderator views (`WebinarModerationMessageSchema`, the
 * moderation-room events) carry the registration name.
 *
 * @see docs/tasks/calls-webinars/02-decisions.md D-CW-14 to D-CW-17, D-CW-34 to D-CW-36, section 7
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md sections 4.6 to 4.8, 5.2, 6, 7.3
 */
import { z } from 'zod';
import { TimeZoneSchema } from './appointments.ts';
import {
  CALL_ROOM_EVENT_PAYLOAD_SCHEMAS,
  CallParticipantRoleSchema,
  ChimeAttendeeSchema,
  ChimeMeetingSchema,
  RecordingStatusSchema,
  WEBINAR_REPLICATED_CAPACITY,
  WEBINAR_SINGLE_MEETING_CAPACITY,
  WebinarMessageKindSchema,
  WebinarMessageStatusSchema,
  type CallErrorCode,
  type CallRoomEventName,
  type CallRoomEventPayloads,
} from './calls.ts';
import type { Locale } from './locale.ts';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const WEBINAR_TITLE_MAX_LENGTH = 200;
export const WEBINAR_DESCRIPTION_MAX_LENGTH = 5000;
/** Most presenters one occurrence lists. */
export const WEBINAR_PRESENTERS_MAX = 10;
/** Most organisations or organisational units one audience policy names. */
export const WEBINAR_AUDIENCE_IDS_MAX = 100;
/** Chat message cap (`webinar_messages.text`, guidelines 5.2). */
export const WEBINAR_MESSAGE_TEXT_MAX_LENGTH = 1000;
/** Host answer cap (`webinar_messages.answer_text`, guidelines 5.2). */
export const WEBINAR_ANSWER_TEXT_MAX_LENGTH = 2000;
export const WEBINAR_POLL_QUESTION_MAX_LENGTH = 300;
export const WEBINAR_POLL_OPTION_LABEL_MAX_LENGTH = 120;
export const WEBINAR_POLL_OPTIONS_MIN = 2;
export const WEBINAR_POLL_OPTIONS_MAX = 6;

/** Page sizes of `GET /webinars`. */
export const WEBINAR_LIST_DEFAULT_LIMIT = 50;
export const WEBINAR_LIST_MAX_LIMIT = 100;
/** Page sizes of `GET /webinars/:id/messages`. */
export const WEBINAR_MESSAGE_LIST_DEFAULT_LIMIT = 100;
export const WEBINAR_MESSAGE_LIST_MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

const idField = z.string().min(1);
const isoDateTime = z.string().datetime();
const count = z.number().int().nonnegative();

function endsAfterStart(value: { startsAt?: string; endsAt?: string }): boolean {
  if (value.startsAt === undefined || value.endsAt === undefined) return true;
  return Date.parse(value.endsAt) > Date.parse(value.startsAt);
}

const endsAfterStartIssue = { path: ['endsAt'], message: 'endsAt must be after startsAt' };

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// ---------------------------------------------------------------------------
// Status lifecycle (`webinar_status`, decision record section 7)
// ---------------------------------------------------------------------------

export const WEBINAR_STATUSES = ['draft', 'published', 'live', 'ended', 'canceled'] as const;
export const WebinarStatusSchema = z.enum(WEBINAR_STATUSES);
export type WebinarStatus = z.infer<typeof WebinarStatusSchema>;

/**
 * Allowed status transitions: publish (WBN-31), cancel (WBN-32), start
 * (WBN-17) and end (WBN-21, WBN-29). A live webinar is ended, not canceled.
 */
export const WEBINAR_STATUS_TRANSITIONS: Readonly<Record<WebinarStatus, readonly WebinarStatus[]>> = {
  draft: ['published', 'canceled'],
  published: ['live', 'canceled'],
  live: ['ended'],
  ended: [],
  canceled: [],
};

/** True when a webinar may move from `from` to `to`. */
export function canTransitionWebinar(from: WebinarStatus, to: WebinarStatus): boolean {
  return WEBINAR_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Audience policy (D-CW-17, guidelines 5.2)
// ---------------------------------------------------------------------------

/**
 * `all_eligible`: every active member of every client organisation whose plan
 * includes webinars (`webinars.org_id` is null, CW-R-23). `organization`: one
 * or more organisations. `org_unit`: one or more organisational units of one
 * organisation. The repository stores the policy in the `audience_policy`
 * text column; the service filters by it after RLS (D-CW-25).
 */
export const WEBINAR_AUDIENCE_POLICY_TYPES = ['all_eligible', 'organization', 'org_unit'] as const;
export const WebinarAudiencePolicyTypeSchema = z.enum(WEBINAR_AUDIENCE_POLICY_TYPES);
export type WebinarAudiencePolicyType = z.infer<typeof WebinarAudiencePolicyTypeSchema>;

const audienceIds = z
  .array(idField)
  .min(1)
  .max(WEBINAR_AUDIENCE_IDS_MAX)
  .refine(unique, { message: 'Ids must be unique' });

export const WebinarAudiencePolicySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('all_eligible') }),
  z.strictObject({ type: z.literal('organization'), orgIds: audienceIds }),
  z.strictObject({ type: z.literal('org_unit'), orgId: idField, orgUnitIds: audienceIds }),
]);
export type WebinarAudiencePolicy = z.infer<typeof WebinarAudiencePolicySchema>;

/** `webinars.chat_policy`; the only policy is the moderated chat of D-CW-35. */
export const WEBINAR_CHAT_POLICIES = ['moderated'] as const;
export const WebinarChatPolicySchema = z.enum(WEBINAR_CHAT_POLICIES);
export type WebinarChatPolicy = z.infer<typeof WebinarChatPolicySchema>;

/** The `webinar_hosts.role` values. */
export const WebinarHostRoleSchema = CallParticipantRoleSchema.extract(['presenter', 'moderator']);
export type WebinarHostRole = z.infer<typeof WebinarHostRoleSchema>;

// ---------------------------------------------------------------------------
// Localised text (WBN-01 and WBN-30: title per locale)
// ---------------------------------------------------------------------------

function localizedText(max: number) {
  const text = z.string().trim().min(1).max(max).optional();
  return z
    .strictObject({ en: text, 'sr-Latn': text, 'sr-Cyrl': text, hu: text } satisfies Record<Locale, z.ZodType>)
    .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
      message: 'At least one locale is required',
    });
}

/** A title per locale; at least one locale. The client shows the viewer's locale and falls back. */
export const WebinarLocalizedTextSchema = localizedText(WEBINAR_TITLE_MAX_LENGTH);
export type WebinarLocalizedText = z.infer<typeof WebinarLocalizedTextSchema>;

const WebinarLocalizedDescriptionSchema = localizedText(WEBINAR_DESCRIPTION_MAX_LENGTH);

// ---------------------------------------------------------------------------
// Occurrence (operations view, `/ops/webinars`)
// ---------------------------------------------------------------------------

/** A `webinar_hosts` row as operations see it. */
export const WebinarHostSchema = z.strictObject({
  userId: idField,
  role: WebinarHostRoleSchema,
  /** First name or chosen display name, shown to attendees for presenters. */
  displayName: z.string().min(1),
});
export type WebinarHost = z.infer<typeof WebinarHostSchema>;

/**
 * The occurrence with its hosts (operations and the admin form). Not strict,
 * like `AppointmentSchema`: the sample fixtures carry `sample: true`, which
 * parsing drops. Never sent to an employee; they get `WebinarResponseSchema`.
 */
export const WebinarSchema = z.object({
  id: idField,
  /** Null for the `all_eligible` audience and for multi-organisation occurrences (CW-R-23). */
  orgId: idField.nullable(),
  title: WebinarLocalizedTextSchema,
  description: WebinarLocalizedDescriptionSchema.nullable(),
  audiencePolicy: WebinarAudiencePolicySchema,
  capacity: z.number().int().positive(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  timeZone: TimeZoneSchema,
  status: WebinarStatusSchema,
  chatPolicy: WebinarChatPolicySchema,
  createdByUserId: idField,
  hosts: z.array(WebinarHostSchema),
});
export type Webinar = z.infer<typeof WebinarSchema>;

/** Response of `POST /ops/webinars` and `PATCH /ops/webinars/:id`. */
export const WebinarOpsResponseSchema = WebinarSchema;
export type WebinarOpsResponse = Webinar;

/**
 * Capacity of an occurrence: up to `WEBINAR_REPLICATED_CAPACITY` (1,000),
 * a single meeting up to 250 and media replication above (D-CW-14,
 * T-CW-3.2); above 1,000 the IVS path is documented, not built. The issue
 * message is the error code itself, so the controller answers 400
 * `capacity_above_limit` for an issue at `capacity` with this message, and
 * the form names the limit.
 */
const capacityField = z
  .number()
  .int()
  .min(1)
  .refine((value) => value <= WEBINAR_REPLICATED_CAPACITY, {
    message: 'capacity_above_limit' satisfies CallErrorCode,
  });

const presenterUserIdsField = z
  .array(idField)
  .max(WEBINAR_PRESENTERS_MAX)
  .refine(unique, { message: 'Presenters must be unique' });

/**
 * `POST /ops/webinars` (WBN-30). Strict: there is no recording field, because
 * every webinar is recorded (D-CW-34), and no status, because an occurrence
 * starts as `draft`. A draft may lack hosts; publishing requires at least one
 * presenter and the moderator (WBN-31, checked by the service).
 */
export const WebinarCreateRequestSchema = z
  .strictObject({
    title: WebinarLocalizedTextSchema,
    description: WebinarLocalizedDescriptionSchema.optional(),
    presenterUserIds: presenterUserIdsField.default([]),
    moderatorUserId: idField.nullable().default(null),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    timeZone: TimeZoneSchema,
    audiencePolicy: WebinarAudiencePolicySchema,
    capacity: capacityField.default(WEBINAR_SINGLE_MEETING_CAPACITY),
  })
  .refine(endsAfterStart, endsAfterStartIssue);
export type WebinarCreateRequest = z.infer<typeof WebinarCreateRequestSchema>;

/**
 * `PATCH /ops/webinars/:id` while `draft` or `published` (WBN-30). Every field
 * optional and without defaults, at least one present. `moderatorUserId: null`
 * unassigns the moderator; `description: null` clears the description.
 */
export const WebinarUpdateRequestSchema = z
  .strictObject({
    title: WebinarLocalizedTextSchema.optional(),
    description: WebinarLocalizedDescriptionSchema.nullable().optional(),
    presenterUserIds: presenterUserIdsField.optional(),
    moderatorUserId: idField.nullable().optional(),
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    timeZone: TimeZoneSchema.optional(),
    audiencePolicy: WebinarAudiencePolicySchema.optional(),
    capacity: capacityField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
  .refine(endsAfterStart, endsAfterStartIssue);
export type WebinarUpdateRequest = z.infer<typeof WebinarUpdateRequestSchema>;

/**
 * Response of start, end, publish and cancel: the new status only. The same
 * shape is the `webinar.state` room event.
 */
export const WebinarStatusResponseSchema = z.strictObject({
  webinarId: idField,
  status: WebinarStatusSchema,
});
export type WebinarStatusResponse = z.infer<typeof WebinarStatusResponseSchema>;

// ---------------------------------------------------------------------------
// Discovery (employee view, `GET /webinars`, WBN-01)
// ---------------------------------------------------------------------------

/** A presenter as attendees see them: the display name only. */
export const WebinarPresenterSchema = z.strictObject({
  displayName: z.string().min(1),
});
export type WebinarPresenter = z.infer<typeof WebinarPresenterSchema>;

/**
 * One occurrence as an eligible employee sees it: title per locale, presenter
 * names, schedule and capacity remaining (WBN-01), and the caller's own
 * registration state. Strict: no audience policy (it would name other client
 * organisations), no org id, no host user ids and no roster (D-CW-15).
 */
export const WebinarResponseSchema = z
  .strictObject({
    id: idField,
    title: WebinarLocalizedTextSchema,
    description: WebinarLocalizedDescriptionSchema.nullable(),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    timeZone: TimeZoneSchema,
    status: WebinarStatusSchema,
    capacity: z.number().int().positive(),
    capacityRemaining: count,
    presenters: z.array(WebinarPresenterSchema),
    /** True when the caller holds an active registration. */
    registered: z.boolean(),
  })
  .refine((value) => value.capacityRemaining <= value.capacity, {
    path: ['capacityRemaining'],
    message: 'capacityRemaining cannot exceed capacity',
  });
export type WebinarResponse = z.infer<typeof WebinarResponseSchema>;

/**
 * `GET /webinars` query. The dates bound `startsAt` (`from` inclusive, `to`
 * exclusive). Pages follow `(startsAt, id)`; `cursor` is the opaque
 * `nextCursor` of the previous page. Eligibility is never a query parameter:
 * the service filters by the audience policy (CW-R-32).
 */
export const WebinarListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(WEBINAR_LIST_MAX_LIMIT).default(WEBINAR_LIST_DEFAULT_LIMIT),
    status: WebinarStatusSchema.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    orgId: idField.optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.to) > Date.parse(q.from), {
    path: ['to'],
    message: 'to must be after from',
  });
export type WebinarListQuery = z.infer<typeof WebinarListQuerySchema>;

export const WebinarListResponseSchema = z.strictObject({
  items: z.array(WebinarResponseSchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type WebinarListResponse = z.infer<typeof WebinarListResponseSchema>;

/**
 * `GET /ops/webinars`: the admin index of the occurrences the caller may
 * manage or moderate (T-CW-2.1, an addition to the decision record's route
 * list). Same filters and paging as `GET /webinars`, every status; `orgId`
 * narrows to one organisation's occurrences. `mine=true` lists the
 * occurrences where the caller is a host instead (the presenter's and the
 * moderator's own list, from the expert context too).
 */
export const WebinarOpsListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(WEBINAR_LIST_MAX_LIMIT).default(WEBINAR_LIST_DEFAULT_LIMIT),
    status: WebinarStatusSchema.optional(),
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    orgId: idField.optional(),
    mine: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.to) > Date.parse(q.from), {
    path: ['to'],
    message: 'to must be after from',
  });
export type WebinarOpsListQuery = z.infer<typeof WebinarOpsListQuerySchema>;

export const WebinarOpsListResponseSchema = z.strictObject({
  items: z.array(WebinarSchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type WebinarOpsListResponse = z.infer<typeof WebinarOpsListResponseSchema>;

/**
 * `GET /ops/webinars/host-candidates?role=presenter|moderator&q=` (T-CW-2.1,
 * the occurrence form, `event.manage`): NestSelf experts and staff who hold
 * `event.present` (presenters) or `event.moderate` (moderators) in a current
 * grant, filtered by name. Hosts are never client-organisation users, and an
 * `all_eligible` occurrence has no organisation, so the list is not per
 * organisation; the publish check decides per occurrence.
 */
export const WebinarHostCandidatesQuerySchema = z.object({
  role: WebinarHostRoleSchema,
  q: z.string().trim().max(100).optional(),
});
export type WebinarHostCandidatesQuery = z.infer<typeof WebinarHostCandidatesQuerySchema>;

export const WebinarHostCandidateSchema = z.strictObject({
  userId: idField,
  displayName: z.string().min(1),
});
export type WebinarHostCandidate = z.infer<typeof WebinarHostCandidateSchema>;

export const WebinarHostCandidatesResponseSchema = z.strictObject({
  items: z.array(WebinarHostCandidateSchema),
});
export type WebinarHostCandidatesResponse = z.infer<typeof WebinarHostCandidatesResponseSchema>;

/**
 * `GET /ops/orgs?q=` (T-CW-2.1, the audience picker, `event.manage`): the
 * active client organisations whose occurrences the caller may manage, by
 * name.
 */
export const OpsOrganizationsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});
export type OpsOrganizationsQuery = z.infer<typeof OpsOrganizationsQuerySchema>;

export const OpsOrganizationsResponseSchema = z.strictObject({
  items: z.array(z.strictObject({ id: idField, name: z.string().min(1) })),
});
export type OpsOrganizationsResponse = z.infer<typeof OpsOrganizationsResponseSchema>;

// ---------------------------------------------------------------------------
// Registration (`POST` and `DELETE /webinars/:id/register`, WBN-02, WBN-03)
// ---------------------------------------------------------------------------

/** Empty body: the caller registers themselves. */
export const WebinarRegistrationRequestSchema = z.strictObject({});
export type WebinarRegistrationRequest = z.infer<typeof WebinarRegistrationRequestSchema>;

/** Register answers `registered: true`; unregister answers `registered: false`. */
export const WebinarRegistrationResponseSchema = z
  .strictObject({
    webinarId: idField,
    registered: z.boolean(),
    registeredAt: isoDateTime.nullable(),
  })
  .refine((value) => value.registered === (value.registeredAt !== null), {
    path: ['registeredAt'],
    message: 'registeredAt is set exactly when registered',
  });
export type WebinarRegistrationResponse = z.infer<typeof WebinarRegistrationResponseSchema>;

// ---------------------------------------------------------------------------
// Media capabilities and join (`POST /webinars/:id/join`, WBN-07, D-CW-35)
// ---------------------------------------------------------------------------

/** Lower-case spellings of the Chime `MediaCapabilities` values. */
export const WEBINAR_MEDIA_CAPABILITIES = ['send_receive', 'send', 'receive', 'none'] as const;
export const WebinarMediaCapabilitySchema = z.enum(WEBINAR_MEDIA_CAPABILITIES);
export type WebinarMediaCapability = z.infer<typeof WebinarMediaCapabilitySchema>;

/** The adapter's mapping to the Chime spelling. */
export const CHIME_CAPABILITY_BY_MEDIA_CAPABILITY = {
  send_receive: 'SendReceive',
  send: 'Send',
  receive: 'Receive',
  none: 'None',
} as const satisfies Record<WebinarMediaCapability, string>;

/** Host capabilities: presenters and the moderator send on every channel. */
export const WebinarCapabilitiesSchema = z.strictObject({
  audio: WebinarMediaCapabilitySchema,
  video: WebinarMediaCapabilitySchema,
  content: WebinarMediaCapabilitySchema,
});
export type WebinarCapabilities = z.infer<typeof WebinarCapabilitiesSchema>;

/**
 * An attendee's capabilities. Video and content are `receive` in every state
 * and milestone (D-CW-35, CW-R-108): the schema cannot express anything else.
 * Audio is `send_receive` only while a host has given the attendee the floor.
 */
export const WebinarAttendeeCapabilitiesSchema = z.strictObject({
  audio: z.enum(['receive', 'send_receive']),
  video: z.literal('receive'),
  content: z.literal('receive'),
});
export type WebinarAttendeeCapabilities = z.infer<typeof WebinarAttendeeCapabilitiesSchema>;

/** At join an attendee receives on every channel (WBN-07). */
const WebinarAttendeeJoinCapabilitiesSchema = z.strictObject({
  audio: z.literal('receive'),
  video: z.literal('receive'),
  content: z.literal('receive'),
});

/** Empty body. */
export const WebinarJoinRequestSchema = z.strictObject({});
export type WebinarJoinRequest = z.infer<typeof WebinarJoinRequestSchema>;

const joinFields = {
  webinarId: idField,
  /**
   * The occurrence's recording state at join, for the REC indicator before
   * the first `webinar.recording` event (UX-45). Optional until the API
   * fills it; a client that gets none treats a live webinar as recording.
   */
  recordingStatus: RecordingStatusSchema.optional(),
  sessionId: idField,
  participantId: idField,
  format: z.literal('webinar'),
  /** Scheduled window, for the session timer. */
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  meeting: ChimeMeetingSchema,
  /** `ExternalUserId` is the `call_participants.id` (CW-R-71). */
  attendee: ChimeAttendeeSchema,
};

/**
 * `POST /webinars/:id/join`, served with `Cache-Control: no-store`
 * (CW-R-70). `role` and `capabilities` let the client assert that an attendee
 * is receive-only before it renders anything; an attendee response whose
 * Chime capabilities would send fails the parse.
 */
export const WebinarJoinResponseSchema = z.discriminatedUnion('role', [
  z
    .strictObject({
      ...joinFields,
      role: z.literal('attendee'),
      capabilities: WebinarAttendeeJoinCapabilitiesSchema,
    })
    .refine(
      (value) => {
        const chime = value.attendee.Capabilities;
        return chime === undefined || (chime.Audio === 'Receive' && chime.Video === 'Receive' && chime.Content === 'Receive');
      },
      { path: ['attendee', 'Capabilities'], message: 'An attendee joins receive-only' },
    ),
  z.strictObject({
    ...joinFields,
    role: WebinarHostRoleSchema,
    capabilities: WebinarCapabilitiesSchema,
  }),
]);
export type WebinarJoinResponse = z.infer<typeof WebinarJoinResponseSchema>;

// ---------------------------------------------------------------------------
// Hand-raise and floor (WBN-10, WBN-25, D-CW-15)
// ---------------------------------------------------------------------------

/** `POST` (raise) and `DELETE` (lower) `/webinars/:id/hand`. */
export const WebinarHandRaiseResponseSchema = z
  .strictObject({
    raised: z.boolean(),
    raisedAt: isoDateTime.nullable(),
  })
  .refine((value) => value.raised === (value.raisedAt !== null), {
    path: ['raisedAt'],
    message: 'raisedAt is set exactly when raised',
  });
export type WebinarHandRaiseResponse = z.infer<typeof WebinarHandRaiseResponseSchema>;

/**
 * `POST /webinars/:id/participants/:participantId/give-floor` and
 * `.../take-floor`. The floor is audio only: video and content stay `receive`
 * (CW-R-108), and `hasFloor` matches the audio capability.
 */
export const WebinarFloorResponseSchema = z
  .strictObject({
    participantId: idField,
    hasFloor: z.boolean(),
    capabilities: WebinarAttendeeCapabilitiesSchema,
  })
  .refine((value) => value.hasFloor === (value.capabilities.audio === 'send_receive'), {
    path: ['capabilities', 'audio'],
    message: 'Audio is send_receive exactly while the attendee has the floor',
  });
export type WebinarFloorResponse = z.infer<typeof WebinarFloorResponseSchema>;

// ---------------------------------------------------------------------------
// Chat (`webinar_messages`, D-CW-35, CW-R-103, CW-R-104, CW-R-110)
// ---------------------------------------------------------------------------

const messageText = z.string().trim().min(1).max(WEBINAR_MESSAGE_TEXT_MAX_LENGTH);
const answerText = z.string().trim().min(1).max(WEBINAR_ANSWER_TEXT_MAX_LENGTH);

/** An attendee writes to the hosts: a message or a question, anonymous unless they attach their first name. */
export const WebinarAttendeeMessageCreateRequestSchema = z.strictObject({
  kind: WebinarMessageKindSchema.extract(['attendee', 'question']),
  text: messageText,
  showFirstName: z.boolean().default(false),
});
export type WebinarAttendeeMessageCreateRequest = z.infer<typeof WebinarAttendeeMessageCreateRequestSchema>;

/** A host posts to everyone; published at once (CW-R-103). */
export const WebinarHostMessageCreateRequestSchema = z.strictObject({
  kind: z.literal('host'),
  text: messageText,
});
export type WebinarHostMessageCreateRequest = z.infer<typeof WebinarHostMessageCreateRequestSchema>;

/**
 * `POST /webinars/:id/messages`. The service refuses `kind: 'host'` from an
 * attendee and `attendee` or `question` from a host (CW-R-110).
 */
export const WebinarMessageCreateRequestSchema = z.discriminatedUnion('kind', [
  WebinarAttendeeMessageCreateRequestSchema,
  WebinarHostMessageCreateRequestSchema,
]);
export type WebinarMessageCreateRequest = z.infer<typeof WebinarMessageCreateRequestSchema>;

/** `POST .../messages/:messageId/publish`. The moderator may edit the text first (WBN-24). */
export const WebinarMessagePublishRequestSchema = z.strictObject({
  text: messageText.optional(),
});
export type WebinarMessagePublishRequest = z.infer<typeof WebinarMessagePublishRequestSchema>;

/** `POST .../messages/:messageId/answer`. */
export const WebinarMessageAnswerRequestSchema = z.strictObject({
  answerText,
});
export type WebinarMessageAnswerRequest = z.infer<typeof WebinarMessageAnswerRequestSchema>;

/** `POST .../messages/:messageId/dismiss`. Empty body. */
export const WebinarMessageDismissRequestSchema = z.strictObject({});
export type WebinarMessageDismissRequest = z.infer<typeof WebinarMessageDismissRequestSchema>;

const messageFields = {
  id: idField,
  webinarId: idField,
  kind: WebinarMessageKindSchema,
  status: WebinarMessageStatusSchema,
  text: messageText,
  /** The first name the attendee attached, or the host's display name; null when anonymous. */
  authorFirstName: z.string().min(1).nullable(),
  answerText: answerText.nullable(),
  publishedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
};

function answeredHasAnswer(value: { status: string; answerText: string | null }): boolean {
  return (value.status === 'answered') === (value.answerText !== null);
}

const answeredIssue = { path: ['answerText'], message: 'answerText is set exactly when the status is answered' };

/**
 * A message as attendees and presenters see it. Strict: no email, user id,
 * participant id or registration name can ride along (D-CW-15).
 */
export const WebinarMessageSchema = z.strictObject(messageFields).refine(answeredHasAnswer, answeredIssue);
export type WebinarMessage = z.infer<typeof WebinarMessageSchema>;

/**
 * A message as the moderator sees it: the registration name even for an
 * anonymous message, for operational follow-up (WBN-23). Only on the
 * moderation room and the moderator's `GET /webinars/:id/messages`.
 */
export const WebinarModerationMessageSchema = z
  .strictObject({
    ...messageFields,
    /** Null for a host message sent by a non-participant moderator. */
    authorParticipantId: idField.nullable(),
    /** The registration name; null for host messages. */
    authorName: z.string().min(1).nullable(),
    showFirstName: z.boolean(),
  })
  .refine(answeredHasAnswer, answeredIssue);
export type WebinarModerationMessage = z.infer<typeof WebinarModerationMessageSchema>;

/** `GET /webinars/:id/messages` query. Pages follow `(createdAt, id)`. */
export const WebinarMessageListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WEBINAR_MESSAGE_LIST_MAX_LIMIT)
    .default(WEBINAR_MESSAGE_LIST_DEFAULT_LIMIT),
});
export type WebinarMessageListQuery = z.infer<typeof WebinarMessageListQuerySchema>;

const PublicWebinarMessageSchema = WebinarMessageSchema.refine(
  (value) => value.status === 'published' || value.status === 'answered',
  { path: ['status'], message: 'Attendees receive published and answered messages only' },
);

/** `GET /webinars/:id/messages` for attendees and presenters: published and answered only (CW-R-104). */
export const WebinarMessageListResponseSchema = z.strictObject({
  items: z.array(PublicWebinarMessageSchema),
  nextCursor: z.string().nullable(),
});
export type WebinarMessageListResponse = z.infer<typeof WebinarMessageListResponseSchema>;

/** `GET /webinars/:id/messages` for the moderator: every status. */
export const WebinarModerationMessageListResponseSchema = z.strictObject({
  items: z.array(WebinarModerationMessageSchema),
  nextCursor: z.string().nullable(),
});
export type WebinarModerationMessageListResponse = z.infer<typeof WebinarModerationMessageListResponseSchema>;

// ---------------------------------------------------------------------------
// Polls (`webinar_polls`, `webinar_poll_options`, `webinar_poll_results`, WBN-11, WBN-27)
// ---------------------------------------------------------------------------

/** `POST /webinars/:id/polls`: a question and two to six distinct options. */
export const WebinarPollCreateRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(WEBINAR_POLL_QUESTION_MAX_LENGTH),
  options: z
    .array(z.string().trim().min(1).max(WEBINAR_POLL_OPTION_LABEL_MAX_LENGTH))
    .min(WEBINAR_POLL_OPTIONS_MIN)
    .max(WEBINAR_POLL_OPTIONS_MAX)
    .refine(unique, { message: 'Options must be distinct' }),
});
export type WebinarPollCreateRequest = z.infer<typeof WebinarPollCreateRequestSchema>;

/** The name used in guidelines section 6. */
export const WebinarPollRequestSchema = WebinarPollCreateRequestSchema;
export type WebinarPollRequest = WebinarPollCreateRequest;

export const WebinarPollOptionSchema = z.strictObject({
  id: idField,
  label: z.string().min(1).max(WEBINAR_POLL_OPTION_LABEL_MAX_LENGTH),
  position: z.number().int().nonnegative(),
});
export type WebinarPollOption = z.infer<typeof WebinarPollOptionSchema>;

/** A poll definition; also the `webinar.poll.opened` payload. Open while `openedAt` is set and `closedAt` is null. */
export const WebinarPollSchema = z.strictObject({
  id: idField,
  webinarId: idField,
  question: z.string().min(1).max(WEBINAR_POLL_QUESTION_MAX_LENGTH),
  options: z.array(WebinarPollOptionSchema).min(WEBINAR_POLL_OPTIONS_MIN).max(WEBINAR_POLL_OPTIONS_MAX),
  openedAt: isoDateTime.nullable(),
  closedAt: isoDateTime.nullable(),
});
export type WebinarPoll = z.infer<typeof WebinarPollSchema>;

/** `POST /webinars/:id/polls/:pollId/vote`: the option only; no voter field fits (CW-R-24). */
export const WebinarPollVoteRequestSchema = z.strictObject({
  optionId: idField,
});
export type WebinarPollVoteRequest = z.infer<typeof WebinarPollVoteRequestSchema>;

export const WebinarPollVoteResponseSchema = z.strictObject({
  pollId: idField,
  voted: z.literal(true),
});
export type WebinarPollVoteResponse = z.infer<typeof WebinarPollVoteResponseSchema>;

/**
 * Aggregate results; also the `webinar.poll.results` payload. Counts per
 * option only, never a vote or a voter (D-CW-16). The client shows percentages.
 */
export const WebinarPollResultsSchema = z
  .strictObject({
    pollId: idField,
    totalVotes: count,
    results: z.array(z.strictObject({ optionId: idField, count })),
  })
  .refine((value) => value.results.reduce((sum, r) => sum + r.count, 0) === value.totalVotes, {
    path: ['totalVotes'],
    message: 'totalVotes must be the sum of the option counts',
  })
  .refine((value) => unique(value.results.map((r) => r.optionId)), {
    path: ['results'],
    message: 'One result per option',
  });
export type WebinarPollResults = z.infer<typeof WebinarPollResultsSchema>;

/**
 * `GET /webinars/:id/polls` (T-CW-2.1): the polls a late joiner or a
 * reloaded console needs. Registrants and presenters get the opened polls,
 * moderating principals every poll; `results` only once a poll is closed
 * (aggregate counts, D-CW-16). `voted` tells a registrant that they already
 * voted, never what (CW-R-24); it is false for hosts.
 */
export const WebinarPollStateSchema = z.strictObject({
  poll: WebinarPollSchema,
  results: WebinarPollResultsSchema.nullable(),
  voted: z.boolean(),
});
export type WebinarPollState = z.infer<typeof WebinarPollStateSchema>;

export const WebinarPollListResponseSchema = z.strictObject({
  items: z.array(WebinarPollStateSchema),
});
export type WebinarPollListResponse = z.infer<typeof WebinarPollListResponseSchema>;

// ---------------------------------------------------------------------------
// Attendance (`GET /ops/webinars/:id/attendance`, WBN-33, D-CW-17, D-CW-30)
// ---------------------------------------------------------------------------

/** One registration's attendance, keyed by the registration id: no name, email or user id. */
export const WebinarAttendanceRegistrantSchema = z.strictObject({
  registrationId: idField,
  joinedAt: isoDateTime.nullable(),
  leftAt: isoDateTime.nullable(),
  attendedMinutes: count.nullable(),
  completionPercent: z.number().min(0).max(100).nullable(),
});
export type WebinarAttendanceRegistrant = z.infer<typeof WebinarAttendanceRegistrantSchema>;

/**
 * The moderator's and NestSelf operations' attendance report; an
 * employer-scoped principal gets 404 (D-CW-30). Counts cover attendees, not
 * hosts: active registrations, attendees who joined at least once, and the
 * highest number present at the same time.
 */
export const WebinarAttendanceResponseSchema = z
  .strictObject({
    webinarId: idField,
    registeredCount: count,
    joinedCount: count,
    peakConcurrent: count,
    registrants: z.array(WebinarAttendanceRegistrantSchema),
  })
  .refine((value) => value.joinedCount <= value.registeredCount, {
    path: ['joinedCount'],
    message: 'joinedCount cannot exceed registeredCount',
  })
  .refine((value) => value.peakConcurrent <= value.joinedCount, {
    path: ['peakConcurrent'],
    message: 'peakConcurrent cannot exceed joinedCount',
  });
export type WebinarAttendanceResponse = z.infer<typeof WebinarAttendanceResponseSchema>;

// ---------------------------------------------------------------------------
// Recording (`POST /webinars/:id/recording/stop`, D-CW-18, D-CW-34)
// ---------------------------------------------------------------------------

export const WebinarRecordingStatusResponseSchema = z.strictObject({
  webinarId: idField,
  status: RecordingStatusSchema,
  startedAt: isoDateTime.nullable(),
  stoppedAt: isoDateTime.nullable(),
});
export type WebinarRecordingStatusResponse = z.infer<typeof WebinarRecordingStatusResponseSchema>;

// ---------------------------------------------------------------------------
// Socket.IO rooms `webinar:{webinarId}` and `webinar:{webinarId}:moderation`
// (D-CW-16, decision record section 7)
// ---------------------------------------------------------------------------

/** The public room; subscription needs `event.register` on the webinar. */
export function webinarRoomName(webinarId: string): string {
  return `webinar:${webinarId}`;
}

/** The moderators' room; subscription needs `event.moderate` on the webinar. */
export function webinarModerationRoomName(webinarId: string): string {
  return `webinar:${webinarId}:moderation`;
}

/**
 * The hosts' room (T-CW-2.3): presenters and moderators. It carries counts
 * and the floor holder's participant id, never a name, so presenters can
 * follow the session without the moderation room's registration names
 * (D-CW-15, CW-R-36a, WBN-19, WBN-20).
 */
export function webinarHostsRoomName(webinarId: string): string {
  return `webinar:${webinarId}:hosts`;
}

/** `webinar.state`: the new status, for example `{ status: 'live' }` on start (WBN-17). */
export const WebinarStatePayloadSchema = WebinarStatusResponseSchema;
export type WebinarStatePayload = WebinarStatusResponse;

/** `webinar.message.published`: a host post or a message a host published. */
export const WebinarMessagePublishedPayloadSchema = WebinarMessageSchema.refine(
  (value) => value.status === 'published',
  { path: ['status'], message: 'Expected a published message' },
);
export type WebinarMessagePublishedPayload = z.infer<typeof WebinarMessagePublishedPayloadSchema>;

/** `webinar.message.answered`: a question with the host's answer. */
export const WebinarMessageAnsweredPayloadSchema = WebinarMessageSchema.refine(
  (value) => value.status === 'answered',
  { path: ['status'], message: 'Expected an answered message' },
);
export type WebinarMessageAnsweredPayload = z.infer<typeof WebinarMessageAnsweredPayloadSchema>;

/** `webinar.poll.opened`: the poll definition (WBN-11). */
export const WebinarPollOpenedPayloadSchema = WebinarPollSchema;
export type WebinarPollOpenedPayload = WebinarPoll;

/** `webinar.poll.closed`. The results follow as `webinar.poll.results`. */
export const WebinarPollClosedPayloadSchema = z.strictObject({
  pollId: idField,
  closedAt: isoDateTime,
});
export type WebinarPollClosedPayload = z.infer<typeof WebinarPollClosedPayloadSchema>;

/** `webinar.poll.results`: aggregate counts only. */
export const WebinarPollResultsPayloadSchema = WebinarPollResultsSchema;
export type WebinarPollResultsPayload = WebinarPollResults;

/**
 * The primary-meeting credentials of an attendee seated in a replica (media
 * replication, D-CW-14, WEB-09): the client promotes into them with
 * `promoteToPrimaryMeeting`, audio only (D-CW-35). No meeting id: the
 * attendee never learns the primary's (D-CW-15). The join token is a
 * credential, so this travels only on the attendee's own socket (CW-R-69).
 */
export const WebinarPrimaryAttendeeSchema = z.strictObject({
  AttendeeId: z.string().min(1),
  /** The `call_participants.id` (CW-R-71). */
  ExternalUserId: z.string().min(1),
  JoinToken: z.string().min(1),
});
export type WebinarPrimaryAttendee = z.infer<typeof WebinarPrimaryAttendeeSchema>;

/**
 * `webinar.floor.given`, to that participant's socket only: audio on, video
 * and content stay `receive`. `primaryAttendee` is present only for an
 * attendee in a replica, who speaks through a promotion (T-CW-3.2).
 */
export const WebinarFloorGivenPayloadSchema = z.strictObject({
  participantId: idField,
  capabilities: z.strictObject({
    audio: z.literal('send_receive'),
    video: z.literal('receive'),
    content: z.literal('receive'),
  }),
  primaryAttendee: WebinarPrimaryAttendeeSchema.optional(),
});
export type WebinarFloorGivenPayload = z.infer<typeof WebinarFloorGivenPayloadSchema>;

/** `webinar.floor.taken`, to that participant's socket only: back to receive-only. */
export const WebinarFloorTakenPayloadSchema = z.strictObject({
  participantId: idField,
  capabilities: WebinarAttendeeJoinCapabilitiesSchema,
});
export type WebinarFloorTakenPayload = z.infer<typeof WebinarFloorTakenPayloadSchema>;

/**
 * The `webinar.recording` event drives the persistent REC indicator (UX-45):
 * `started` and `stopped`, then `ready` once the recording is finalised and
 * `failed` when the media pipeline failed (CW-R-121, T-CW-2.3 addition).
 */
export const WEBINAR_RECORDING_EVENT_STATUSES = ['started', 'stopped', 'ready', 'failed'] as const;
export const WebinarRecordingPayloadSchema = z.strictObject({
  webinarId: idField,
  status: z.enum(WEBINAR_RECORDING_EVENT_STATUSES),
});
export type WebinarRecordingPayload = z.infer<typeof WebinarRecordingPayloadSchema>;

/** `webinar.ended`, on both rooms (guidelines 4.8). */
export const WebinarEndedPayloadSchema = z.strictObject({
  webinarId: idField,
  endedAt: isoDateTime,
});
export type WebinarEndedPayload = z.infer<typeof WebinarEndedPayloadSchema>;

/** `webinar.message.submitted`, moderation room only: the pending message with the registration name. */
export const WebinarMessageSubmittedPayloadSchema = WebinarModerationMessageSchema;
export type WebinarMessageSubmittedPayload = WebinarModerationMessage;

/** `webinar.hand.raised`, moderation room only: the moderator sees the registration name (WBN-10). */
export const WebinarHandRaisedPayloadSchema = z.strictObject({
  participantId: idField,
  participantName: z.string().min(1),
  raisedAt: isoDateTime,
});
export type WebinarHandRaisedPayload = z.infer<typeof WebinarHandRaisedPayloadSchema>;

/** `webinar.hand.lowered`, moderation room only. */
export const WebinarHandLoweredPayloadSchema = z.strictObject({
  participantId: idField,
});
export type WebinarHandLoweredPayload = z.infer<typeof WebinarHandLoweredPayloadSchema>;

/** `webinar.attendance.count`, moderation room only: a number, never names (WBN-19). */
export const WebinarAttendanceCountPayloadSchema = z.strictObject({
  webinarId: idField,
  count,
});
export type WebinarAttendanceCountPayload = z.infer<typeof WebinarAttendanceCountPayloadSchema>;

/** Events of the public `webinar:{webinarId}` room. */
export const WEBINAR_ROOM_EVENT_NAMES = [
  'webinar.state',
  'webinar.message.published',
  'webinar.message.answered',
  'webinar.poll.opened',
  'webinar.poll.closed',
  'webinar.poll.results',
  'webinar.recording',
  'webinar.ended',
] as const;
export type WebinarRoomEventName = (typeof WEBINAR_ROOM_EVENT_NAMES)[number];

/** Events sent to one participant's socket only (section 7: "to that participant only"). */
export const WEBINAR_PARTICIPANT_EVENT_NAMES = ['webinar.floor.given', 'webinar.floor.taken'] as const;
export type WebinarParticipantEventName = (typeof WEBINAR_PARTICIPANT_EVENT_NAMES)[number];

/** Events of the `webinar:{webinarId}:moderation` room. `webinar.ended` is also sent here. */
export const WEBINAR_MODERATION_ROOM_EVENT_NAMES = [
  'webinar.message.submitted',
  'webinar.hand.raised',
  'webinar.hand.lowered',
  'webinar.attendance.count',
] as const;
export type WebinarModerationRoomEventName = (typeof WEBINAR_MODERATION_ROOM_EVENT_NAMES)[number];

export const WEBINAR_EVENT_NAMES = [
  ...WEBINAR_ROOM_EVENT_NAMES,
  ...WEBINAR_PARTICIPANT_EVENT_NAMES,
  ...WEBINAR_MODERATION_ROOM_EVENT_NAMES,
] as const;
export const WebinarEventNameSchema = z.enum(WEBINAR_EVENT_NAMES);
export type WebinarEventName = z.infer<typeof WebinarEventNameSchema>;

/** The payload schema of each webinar event, for the API's emitter and the clients' listeners. */
export const WEBINAR_EVENT_PAYLOAD_SCHEMAS = {
  'webinar.state': WebinarStatePayloadSchema,
  'webinar.message.published': WebinarMessagePublishedPayloadSchema,
  'webinar.message.answered': WebinarMessageAnsweredPayloadSchema,
  'webinar.poll.opened': WebinarPollOpenedPayloadSchema,
  'webinar.poll.closed': WebinarPollClosedPayloadSchema,
  'webinar.poll.results': WebinarPollResultsPayloadSchema,
  'webinar.recording': WebinarRecordingPayloadSchema,
  'webinar.ended': WebinarEndedPayloadSchema,
  'webinar.floor.given': WebinarFloorGivenPayloadSchema,
  'webinar.floor.taken': WebinarFloorTakenPayloadSchema,
  'webinar.message.submitted': WebinarMessageSubmittedPayloadSchema,
  'webinar.hand.raised': WebinarHandRaisedPayloadSchema,
  'webinar.hand.lowered': WebinarHandLoweredPayloadSchema,
  'webinar.attendance.count': WebinarAttendanceCountPayloadSchema,
} as const satisfies { readonly [E in WebinarEventName]: z.ZodType };

export type WebinarEventPayloads = {
  [E in WebinarEventName]: z.infer<(typeof WEBINAR_EVENT_PAYLOAD_SCHEMAS)[E]>;
};
export type WebinarEventPayload<E extends WebinarEventName> = WebinarEventPayloads[E];

// ---------------------------------------------------------------------------
// Every room event (call and webinar), for the gateway
// ---------------------------------------------------------------------------

/** Call and webinar event payload schemas in one map. The names do not overlap. */
export const ROOM_EVENT_PAYLOAD_SCHEMAS = {
  ...CALL_ROOM_EVENT_PAYLOAD_SCHEMAS,
  ...WEBINAR_EVENT_PAYLOAD_SCHEMAS,
} as const;

export type RoomEventName = CallRoomEventName | WebinarEventName;
export type RoomEventPayloads = CallRoomEventPayloads & WebinarEventPayloads;
export type RoomEventPayload<E extends RoomEventName> = RoomEventPayloads[E];

// ---------------------------------------------------------------------------
// Additions to the canonical webinar events (T-CW-2.3)
// ---------------------------------------------------------------------------

/**
 * `webinar.message.removed`, public room: a published message a host
 * dismissed leaves the public chat (WBN-24.2: "the message disappears from
 * the public feed"). The id only.
 */
export const WebinarMessageRemovedPayloadSchema = z.strictObject({
  messageId: idField,
});
export type WebinarMessageRemovedPayload = z.infer<typeof WebinarMessageRemovedPayloadSchema>;

/**
 * `webinar.floor.state`, public room: whether an attendee has the floor, so
 * the audience sees "a participant is speaking" (WBN-25.8). Anonymous by
 * construction: a flag, never a participant id or a name (D-CW-15).
 */
export const WebinarFloorStatePayloadSchema = z.strictObject({
  active: z.boolean(),
});
export type WebinarFloorStatePayload = z.infer<typeof WebinarFloorStatePayloadSchema>;

/**
 * Public-room events the stories need beyond the decision record's section 7
 * list, added in T-CW-2.3 as canonical additions. They are kept out of
 * `WEBINAR_ROOM_EVENT_NAMES`, `WEBINAR_EVENT_PAYLOAD_SCHEMAS` and
 * `ROOM_EVENT_PAYLOAD_SCHEMAS`, which mirror section 7 exactly; the gateway's
 * `ROOM_EVENTS` and the web client accept both lists.
 */
export const WEBINAR_ROOM_ADDED_EVENT_NAMES = ['webinar.message.removed', 'webinar.floor.state'] as const;
export type WebinarRoomAddedEventName = (typeof WEBINAR_ROOM_ADDED_EVENT_NAMES)[number];

export const WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS = {
  'webinar.message.removed': WebinarMessageRemovedPayloadSchema,
  'webinar.floor.state': WebinarFloorStatePayloadSchema,
} as const satisfies { readonly [E in WebinarRoomAddedEventName]: z.ZodType };

export type WebinarRoomAddedEventPayloads = {
  [E in WebinarRoomAddedEventName]: z.infer<(typeof WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS)[E]>;
};

// ---------------------------------------------------------------------------
// The hosts' room `webinar:{webinarId}:hosts` (T-CW-2.3)
// ---------------------------------------------------------------------------

/** `webinar.hand.count`, hosts room: how many hands are raised; a number, never names (WBN-10, WBN-19). */
export const WebinarHandCountPayloadSchema = z.strictObject({
  count,
});
export type WebinarHandCountPayload = z.infer<typeof WebinarHandCountPayloadSchema>;

/**
 * `webinar.floor.state` on the hosts room: the public flag plus the
 * participant id of the attendee whose floor changed (given, taken, or
 * dropped by a rejoin), so any host can take the floor back after a reload
 * (WBN-25). Every change names its attendee; never a name (D-CW-15). The
 * public room's payload stays `{ active }`.
 */
export const WebinarHostsFloorStatePayloadSchema = z.strictObject({
  /** Whether this attendee has the floor after the change. */
  active: z.boolean(),
  /** The `call_participants.id` of the attendee whose floor changed. */
  participantId: idField,
});
export type WebinarHostsFloorStatePayload = z.infer<typeof WebinarHostsFloorStatePayloadSchema>;

/** Events of the hosts' room; `webinar.attendance.count` is also sent to the moderation room. */
export const WEBINAR_HOSTS_ROOM_EVENT_NAMES = ['webinar.attendance.count', 'webinar.hand.count', 'webinar.floor.state'] as const;
export type WebinarHostsRoomEventName = (typeof WEBINAR_HOSTS_ROOM_EVENT_NAMES)[number];

export const WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS = {
  'webinar.attendance.count': WebinarAttendanceCountPayloadSchema,
  'webinar.hand.count': WebinarHandCountPayloadSchema,
  'webinar.floor.state': WebinarHostsFloorStatePayloadSchema,
} as const satisfies { readonly [E in WebinarHostsRoomEventName]: z.ZodType };

export type WebinarHostsRoomEventPayloads = {
  [E in WebinarHostsRoomEventName]: z.infer<(typeof WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS)[E]>;
};

// ---------------------------------------------------------------------------
// Moderation-room additions (T-CW-2.3)
// ---------------------------------------------------------------------------

/**
 * `webinar.recording.failed`, moderation room (CW-R-121): the media pipeline
 * failed and the webinar continues without recording. `reason` is a short
 * machine reason for support (an error name or code), never shown to people
 * as it is; the client shows its own translated notice to hosts.
 */
export const WebinarRecordingFailedPayloadSchema = z.strictObject({
  webinarId: idField,
  reason: z.string().trim().min(1).max(200),
});
export type WebinarRecordingFailedPayload = z.infer<typeof WebinarRecordingFailedPayloadSchema>;

/** Moderation-room events added in T-CW-2.3, kept out of `WEBINAR_MODERATION_ROOM_EVENT_NAMES` (section 7). */
export const WEBINAR_MODERATION_ROOM_ADDED_EVENT_NAMES = ['webinar.recording.failed'] as const;
export type WebinarModerationRoomAddedEventName = (typeof WEBINAR_MODERATION_ROOM_ADDED_EVENT_NAMES)[number];

export const WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS = {
  'webinar.recording.failed': WebinarRecordingFailedPayloadSchema,
} as const satisfies { readonly [E in WebinarModerationRoomAddedEventName]: z.ZodType };

export type WebinarModerationRoomAddedEventPayloads = {
  [E in WebinarModerationRoomAddedEventName]: z.infer<(typeof WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS)[E]>;
};

// ---------------------------------------------------------------------------
// Muting the floor holder and the unmute request (WBN-26, T-CW-2.1)
// ---------------------------------------------------------------------------

const receiveOnlyCapabilities = z.strictObject({
  audio: z.literal('receive'),
  video: z.literal('receive'),
  content: z.literal('receive'),
});

const floorCapabilities = z.strictObject({
  audio: z.literal('send_receive'),
  video: z.literal('receive'),
  content: z.literal('receive'),
});

/**
 * `POST /webinars/:id/participants/:participantId/mute` (a host or a
 * moderating principal): the floor holder's audio goes back to `receive` but
 * the floor stays theirs (`hasFloor`), so they can unmute again with consent.
 * A host can never unmute an attendee (WBN-26 criterion 4).
 */
export const WebinarFloorMuteResponseSchema = z.strictObject({
  participantId: idField,
  hasFloor: z.literal(true),
  muted: z.literal(true),
  capabilities: receiveOnlyCapabilities,
});
export type WebinarFloorMuteResponse = z.infer<typeof WebinarFloorMuteResponseSchema>;

/** `POST .../unmute-request` (a host): the attendee is asked; nothing changes until they consent. */
export const WebinarUnmuteRequestResponseSchema = z.strictObject({
  participantId: idField,
  requested: z.literal(true),
});
export type WebinarUnmuteRequestResponse = z.infer<typeof WebinarUnmuteRequestResponseSchema>;

/**
 * `POST .../unmute` (the attendee, on their own participant, only while they
 * hold the floor): audio `send_receive` again, video and content still
 * `receive` (D-CW-35). A replica attendee gets fresh primary credentials, to
 * themselves only (CW-R-69).
 */
export const WebinarFloorUnmuteResponseSchema = z.strictObject({
  participantId: idField,
  hasFloor: z.literal(true),
  muted: z.literal(false),
  capabilities: floorCapabilities,
  primaryAttendee: WebinarPrimaryAttendeeSchema.optional(),
});
export type WebinarFloorUnmuteResponse = z.infer<typeof WebinarFloorUnmuteResponseSchema>;

/** `webinar.floor.muted` on the hosts room: which attendee was muted; never a name. */
export const WebinarHostsFloorMutedPayloadSchema = z.strictObject({ participantId: idField });
export type WebinarHostsFloorMutedPayload = z.infer<typeof WebinarHostsFloorMutedPayloadSchema>;

/** `webinar.floor.unmuted` on the hosts room: the attendee consented and speaks again. */
export const WebinarHostsFloorUnmutedPayloadSchema = z.strictObject({ participantId: idField });
export type WebinarHostsFloorUnmutedPayload = z.infer<typeof WebinarHostsFloorUnmutedPayloadSchema>;

/** `webinar.floor.muted` on the attendee's own room `user:{userId}`: empty; the client mutes. */
export const WebinarFloorMutedPayloadSchema = z.strictObject({});
export type WebinarFloorMutedPayload = z.infer<typeof WebinarFloorMutedPayloadSchema>;

/** `webinar.floor.unmute_requested` on the attendee's own room: the client asks for consent before unmuting. */
export const WebinarFloorUnmuteRequestedPayloadSchema = z.strictObject({});
export type WebinarFloorUnmuteRequestedPayload = z.infer<typeof WebinarFloorUnmuteRequestedPayloadSchema>;

/** Events of the hosts room added for WBN-26. */
export const WEBINAR_FLOOR_MUTE_HOSTS_EVENT_NAMES = ['webinar.floor.muted', 'webinar.floor.unmuted'] as const;
export type WebinarFloorMuteHostsEventName = (typeof WEBINAR_FLOOR_MUTE_HOSTS_EVENT_NAMES)[number];

export const WEBINAR_FLOOR_MUTE_HOSTS_EVENT_PAYLOAD_SCHEMAS = {
  'webinar.floor.muted': WebinarHostsFloorMutedPayloadSchema,
  'webinar.floor.unmuted': WebinarHostsFloorUnmutedPayloadSchema,
} as const satisfies { readonly [E in WebinarFloorMuteHostsEventName]: z.ZodType };

export type WebinarFloorMuteHostsEventPayloads = {
  [E in WebinarFloorMuteHostsEventName]: z.infer<(typeof WEBINAR_FLOOR_MUTE_HOSTS_EVENT_PAYLOAD_SCHEMAS)[E]>;
};

/** Events sent to the floor holder's own room only, added for WBN-26. */
export const WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_NAMES = ['webinar.floor.muted', 'webinar.floor.unmute_requested'] as const;
export type WebinarFloorMuteParticipantEventName = (typeof WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_NAMES)[number];

export const WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_PAYLOAD_SCHEMAS = {
  'webinar.floor.muted': WebinarFloorMutedPayloadSchema,
  'webinar.floor.unmute_requested': WebinarFloorUnmuteRequestedPayloadSchema,
} as const satisfies { readonly [E in WebinarFloorMuteParticipantEventName]: z.ZodType };

export type WebinarFloorMuteParticipantEventPayloads = {
  [E in WebinarFloorMuteParticipantEventName]: z.infer<(typeof WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_PAYLOAD_SCHEMAS)[E]>;
};

// ---------------------------------------------------------------------------
// Organisation units for the audience picker (`GET /ops/orgs/:orgId/units`, T-CW-2.1)
// ---------------------------------------------------------------------------

/** The organisation's units for an `org_unit` audience; `parentId` builds the tree. */
export const OpsOrgUnitsResponseSchema = z.strictObject({
  items: z.array(z.strictObject({ id: idField, name: z.string().min(1), parentId: idField.nullable() })),
});
export type OpsOrgUnitsResponse = z.infer<typeof OpsOrgUnitsResponseSchema>;
