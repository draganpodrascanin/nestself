# Implementation guidelines: consultations and webinars on Amazon Chime SDK

Epic `NS-CALLS-01`. Implementation guidelines v1.0, 24 October 2026. This document is the technical reference an engineer reads before touching code for this epic. It is binding alongside the decision record (`02-decisions.md`), the epic (`03-epic.md`), the stories (`04-user-stories.md`) and the backlog (`05-tasks.md`). The decision record's canonical names (section 7) are the only valid identifiers for tables, enums, routes, actions, jobs, events, error codes, Redis keys, Socket.IO rooms and client exports; any mismatch between this document and section 7 is a bug in this document.

Requirements are numbered `CW-R-01` through `CW-R-nn` and placed at the end of the paragraph they belong to. Each requirement that follows from a decision cites it: `[D-CW-nn]`. Where this document makes a choice that is not forced by the decision record or the codebase, the paragraph ends with `(guideline choice)`.

---

## 1. Module map

The epic adds seven API modules, one shared mailer module, one calendar utility, one client package and supporting infrastructure. All live in the git worktree's existing directories and follow the conventions the codebase survey (section 1) documents.

**API modules** (under `apps/api/src/`):

| Module | Directory | Owns |
| --- | --- | --- |
| Video provider | `video/` | `VideoProvider` abstract class, `ChimeVideoProvider`, `FakeVideoProvider`, `video.module.ts` |
| Appointments | `appointments/` | Appointment CRUD, cancellation, propose, the appointment spine that the booking epic will later extend |
| Calls | `calls/` | Session lifecycle, join, end, participants, outcomes, feedback, client events, diagnostics |
| Webinars | `webinars/` | Occurrences, registrations, live session, chat and messages, polls, hand-raise, the floor, recordings, certificates, attendance |
| Mailer | `mailer/` | Abstract `Mailer` class, `SesMailer`, `LoggingMailer`, localised templates for all four locales |
| Calendar | `calendar/` | RFC 5545 ICS generator with tests, no external dependency |
| Jobs (extensions) | `jobs/` | New queues and handlers alongside the existing `JobSchedulerService` |

**Client package**: `packages/video` (`@nestself/video`), holding `CallSessionController`, React hooks and UI components [D-CW-20].

**Infrastructure**: `infra/cdk/lib/video-stack.ts` (stack `NestSelf-<stage>-Video`) [D-CW-31].

**Contracts**: `packages/contracts/src/appointments.ts`, `packages/contracts/src/calls.ts`, `packages/contracts/src/webinars.ts`.

**Sample data**: `packages/sample-data/src/fixtures/appointments.ts`, `webinars.ts`, `call-sessions.ts`.

**i18n**: `packages/i18n/locales/{en,sr-Latn,hu}/calls.json` with keys `consultation.*`, `followUp.*`, `approval.*`, `webinar.*`, `webinar.chat.*`, `webinar.floor.*`, `webinar.recording.*`, `workshop.*`, `prejoin.*`, `errors.*`, `email.*`; the Cyrillic catalog is generated [D-CW-26].

Every new module registers in `AppModule` and the default-deny route test. **CW-R-01**: every controller route carries `@Public()`, `@Authenticated()` or `@Authorize()`. **CW-R-02**: every new table enables RLS and carries `FORCE ROW LEVEL SECURITY` in its migration.

---

## 2. VideoProvider contract

The abstract class lives at `apps/api/src/video/video-provider.ts` and mirrors the identity provider pattern in `apps/api/src/identity/`. The injection token is `VIDEO_PROVIDER`. The provider is selected by the `VIDEO_PROVIDER` env var: `none` selects `FakeVideoProvider` (the default), `chime` selects `ChimeVideoProvider` [D-CW-05].

```ts
export abstract class VideoProvider {
  abstract createSession(input: CreateSessionInput): Promise<ProviderSession>;
  abstract createParticipant(input: CreateParticipantInput): Promise<ProviderParticipant>;
  abstract updateParticipantCapabilities(
    input: UpdateCapabilitiesInput,
  ): Promise<void>;
  abstract removeParticipant(input: RemoveParticipantInput): Promise<void>;
  abstract endSession(input: EndSessionInput): Promise<void>;
  abstract startRecording(input: StartRecordingInput): Promise<ProviderRecording>;
  abstract stopRecording(input: StopRecordingInput): Promise<void>;
  abstract describeSession(input: DescribeSessionInput): Promise<ProviderSessionInfo | null>;
}
```

`CreateSessionInput` carries `sessionId` (used as `ClientRequestToken` and `ExternalMeetingId`), `format` (the `call_format` enum value), `capacity`, and `meetingFeatures` built from the format table in D-CW-10. `CreateParticipantInput` carries `providerMeetingId`, `participantId` (used as `ExternalUserId`), `capabilities` and `tags` [D-CW-11].

**CW-R-03**: `ExternalUserId` is always the `call_participants.id`, never a user id, name or email [D-CW-11].

**CW-R-04**: the `tags` object contains only `stage`, `format` and `orgId`. No personal data appears in tags [D-CW-11].

`FakeVideoProvider` returns deterministic stubs (fixed meeting id derived from the session id, fixed join token `fake-join-token-{participantId}`) and emits the same domain events (`SessionCreated`, `ParticipantJoined`, `ParticipantLeft`, `SessionEnded`) to an in-process event emitter that the event consumption handler subscribes to. This lets every test and local development run exercise the full lifecycle without AWS credentials [D-CW-05]. **CW-R-05**: every method of `FakeVideoProvider` completes in under 5 ms and never makes a network call.

---

## 3. Chime adapter specifics

`ChimeVideoProvider` lives at `apps/api/src/video/chime-video-provider.ts`. It depends on two AWS SDK clients injected through the NestJS module: `ChimeSDKMeetingsClient` (from `@aws-sdk/client-chime-sdk-meetings`) and `ChimeSDKMediaPipelinesClient` (from `@aws-sdk/client-chime-sdk-media-pipelines`).

**CW-R-06**: both clients are configured with `region: 'eu-central-1'`, hard-coded in the adapter constructor. The `CHIME_REGION` env var is validated at start-up to equal `eu-central-1`; any other value fails the Zod refinement and the process does not start [D-CW-06].

**CW-R-07**: only the `chime-sdk-meetings` namespace is used. Never import from `@aws-sdk/client-chime` (the legacy namespace, deprecated, us-east-1 only, CORE-37, CORE-39).

`createSession` calls `CreateMeetingWithAttendees` for the first join and `CreateAttendee` for subsequent joins [D-CW-07]. `NotificationsConfiguration.SqsQueueArn` is set to the `CHIME_EVENTS_QUEUE_ARN` env var on every `CreateMeeting` call [D-CW-12, OPS-14].

Meeting features per format:

```ts
const MEETING_FEATURES: Record<CallFormat, MeetingFeaturesConfiguration> = {
  consultation: {
    Audio: { EchoReduction: 'AVAILABLE' },
    Video: { MaxResolution: 'HD' },
    Content: { MaxResolution: 'FHD' },
    Attendee: { MaxCount: 4 },
  },
  webinar: {
    Audio: { EchoReduction: 'AVAILABLE' },
    Video: { MaxResolution: 'HD' },
    Content: { MaxResolution: 'FHD' },
    Attendee: { MaxCount: 250 },
  },
  workshop: {
    Audio: { EchoReduction: 'AVAILABLE' },
    Video: { MaxResolution: 'HD' },
    Content: { MaxResolution: 'FHD' },
    Attendee: { MaxCount: 30 },
  },
};
```

`MaxResolution` for video is `HD` (720p), never `FHD`, because FHD caps meetings at 25 attendees (CORE-06). `MaxCount` for consultations is 4 (room for a recording attendee and a support join in a future phase) [D-CW-10]. **CW-R-08**: never request `FHD` for the `Video` feature.

`TenantIds` carries the organisation id for consultations and workshops, and the webinar id for webinars [D-CW-11, OPS-37]. AppKeys are not configured in this epic.

Error mapping: `ServiceUnavailableException` from the SDK maps to `ApiHttpException` with code `video_provider_unavailable` (503). `LimitExceededException` maps to a 429 with a log entry; the caller retries once after 1 second. `NotFoundException` (meeting deleted) maps to `appointment_not_joinable`. All other SDK exceptions are logged at error level and re-thrown as 502. **CW-R-09**: SDK exceptions never propagate to the client with their original message or structure.

**CW-R-10**: unit tests for the adapter use `aws-sdk-client-mock` (added to the catalog as a dev dependency, D-CW-32). Each SDK call has a test that verifies the request shape and a test that verifies the error-mapping branch.

---

## 4. Session lifecycle

The session lifecycle is the sequence from the first join through the in-call phase to the end and cleanup.

### 4.1 First join

The first participant to call `POST /appointments/:id/join` (or `POST /webinars/:id/join`) inside the allowed window triggers meeting creation. The service acquires a lock via `KeyValueStore.set('call:{sessionId}:create', '1', { ttlSeconds: 30, onlyIfAbsent: true })`. If the lock succeeds, the service calls `VideoProvider.createSession` followed by writing the `provider_meeting_id` to `call_sessions`. If the lock fails, the participant is the loser: they poll `call_sessions.provider_meeting_id` with a 200 ms interval up to 3 seconds and then create their attendee [D-CW-07].

**CW-R-11**: the `ClientRequestToken` passed to `CreateMeetingWithAttendees` is the `call_sessions.id`. This is the second line of defence; the primary idempotency mechanism is the Redis lock [D-CW-07].

**CW-R-12**: the create lock TTL is 30 seconds, matching the `CALL_TICKET_TTL_SECONDS` constant. If the lock holder crashes, a second join after 30 seconds will find `provider_meeting_id` already set (or absent, in which case it takes the lock itself).

### 4.2 Credential caching

After `createParticipant` returns meeting and attendee credentials, the adapter stores the full `{ meeting, attendee }` blob under `call:{sessionId}:participant:{participantId}` in the `KeyValueStore` with a TTL of `endsAt + 15 minutes - now` [D-CW-08]. A repeated join returns the cached credentials.

**CW-R-13**: the join token is never written to PostgreSQL, never logged, never put in an `AuditWriter.record()` details object. The audit writer's `FORBIDDEN_KEYS` already blocks `token`, `tokens`, `accessToken`; the participant credentials blob must be stored under a key name that does not collide with those (the key is `call:{sessionId}:participant:{participantId}`, not a forbidden key itself, but the blob contains a `JoinToken` field). The audit event `call.joined` records `{ sessionId, participantId, role }` only [D-CW-08].

**CW-R-14**: the join response carries the header `Cache-Control: no-store` [D-CW-08].

### 4.3 Join window

Consultations: the window opens at `startsAt - CALL_JOIN_WINDOW_BEFORE_MINUTES` (15 minutes) and closes at `endsAt + CALL_JOIN_WINDOW_AFTER_MINUTES` (10 minutes). A non-participant gets 404. A participant outside the window gets 403 with code `join_window_closed`. A participant on a canceled or completed appointment gets 409 with code `appointment_not_joinable` [D-CW-02, D-CW-07].

Webinars: presenters and the moderator (hosts) may join from `startsAt - WEBINAR_HOST_JOIN_BEFORE_MINUTES` (30 minutes before the scheduled start); attendees may join from `startsAt - CALL_JOIN_WINDOW_BEFORE_MINUTES` (15 minutes before). The room closes at `endsAt + CALL_ROOM_CLOSE_AFTER_MINUTES` (15 minutes after the scheduled end) unless the moderator ends the webinar earlier [D-CW-17]. **CW-R-15**: the join-window constants are imported from `@nestself/contracts`, never hard-coded in the service.

### 4.4 Explicit end and safety net

The expert's "end for everyone" calls `POST /appointments/:id/end`, which triggers `VideoProvider.endSession` (`DeleteMeeting` in the Chime adapter) [D-CW-09, OPS-04]. For webinars, the moderator calls `POST /webinars/:id/end`.

A BullMQ delayed job `calls.cleanup` is scheduled at `endsAt + CALL_ROOM_CLOSE_AFTER_MINUTES` (15 minutes) for each session. It calls `VideoProvider.describeSession`; if the session still exists, it calls `endSession` [D-CW-09].

A recurring `calls.reconcile` job runs every 5 minutes and picks up sessions in `active` status whose `endsAt + 15 minutes` has passed but whose cleanup job is missing (worker restart scenario). **CW-R-16**: the reconcile job is idempotent: calling `endSession` on an already-ended meeting is a no-op in the adapter (it catches `NotFoundException`) [D-CW-09].

**CW-R-17**: recording attendees keep a meeting alive (OPS-42), so the cleanup job runs regardless of attendee count and always calls `DeleteMeeting` [D-CW-09].

### 4.5 Follow-up appointment lifecycle

When the expert proposes a follow-up at the end of a completed call, a new appointment is created with status `proposed` and `followUpOf` set to the finished appointment [D-CW-37]. **CW-R-105**: a follow-up can be proposed only when the linked appointment's `call_outcomes.status` is `COMPLETED`; attempting to propose a follow-up before the outcome is recorded returns 409 `follow_up_not_allowed`.

The follow-up state machine:

1. `proposed` -- the expert created the follow-up. The employee sees a card on the post-call screen and in the appointment list.
2. When the employee confirms:
   - If the organisation's `followUpApprovalPolicy` is `AUTOMATIC`, the appointment transitions directly to `confirmed`, reminders are scheduled and the ICS is sent.
   - If the policy is `MANAGER_APPROVAL`, the appointment transitions to `awaiting_approval` and an `appointment_approvals` row is created and routed to the matching approval authority (section 7.5).
3. `awaiting_approval` -- waiting for the approver's decision.
   - `approved` by the approver: the appointment transitions to `confirmed`, both parties are notified, reminders are scheduled.
   - `rejected` by the approver: the appointment transitions to `declined` with the approver's safe reason shown to the employee.
   - No decision within 5 working days (in `Europe/Belgrade`, weekends skipped; Serbian public holidays are not modelled in this epic): the `appointment.approval.remind` job fires, sending a reminder to the approver and the alternate. The approval lapses at the earlier of the proposed start and 10 working days after the request (the `appointment.approval.expire` job; no reminder is scheduled when it would not come before the lapse): the approval status becomes `expired`, the appointment becomes `declined`, its jobs are removed and the employee is told (`appointment.approval.decided`, expired). Because jobs are best effort, a decision or a reminder after the start runs the same lapse first; the decision answers 409 `approval_not_pending` (amended 2026-10-25, T-CW-1.10).
4. `declined` -- the employee declined the proposal, or the approver rejected it.
5. Either party can cancel a confirmed follow-up through `POST /appointments/:id/cancel`.

**CW-R-106**: the follow-up state transitions are enforced in a `CASE` expression on the appointment row. The only valid transitions are `proposed -> confirmed`, `proposed -> awaiting_approval`, `proposed -> declined`, `awaiting_approval -> confirmed`, `awaiting_approval -> declined` (rejection or lapse), `confirmed -> canceled`, `confirmed -> completed`, `confirmed -> no_show` [D-CW-37].

### 4.6 Webinar recording lifecycle

Every webinar is recorded; there is no per-occurrence recording switch [D-CW-34]. When the moderator starts the webinar (`POST /webinars/:id/start`), the start handler enqueues `webinar.recording.start`. When the moderator ends the webinar (`POST /webinars/:id/end`), the end handler stops the recording pipeline. The moderator can stop recording earlier through `POST /webinars/:id/recording/stop` (moderator only). **CW-R-107**: recording start is enqueued through the `webinar.recording.start` job, not called synchronously, so the webinar start is not blocked by the media pipeline call [D-CW-34, D-CW-18].

### 4.7 Attendee floor and capabilities

An attendee given the floor by a host receives `UpdateAttendeeCapabilities` with `Audio: 'SendReceive'`, `Video: 'Receive'`, `Content: 'Receive'` only. **CW-R-108**: a unit test asserts that the adapter rejects any attendee capability update where video is `SendReceive`. Attendees never have video send capability, in any milestone [D-CW-35]. The floor events (`webinar.floor.given`, `webinar.floor.taken`) go to that one participant's socket only. Before the attendee unmutes, the client shows a dialog: "You can speak now. Unmute to talk. Your voice is part of the recording." The dialog must be acknowledged before the unmute control is enabled [D-CW-15, D-CW-35].

### 4.8 Webinar session lifecycle

Webinar sessions follow the same create-on-first-join pattern as consultations. The moderator calls `POST /webinars/:id/start`, which transitions the webinar from `published` to `live`, enqueues `webinar.recording.start` (section 4.6) and allows attendees to join. The first presenter or moderator to join after the start triggers `CreateMeetingWithAttendees`; attendees who join create their own attendee with receive-only capabilities.

Webinar audience eligibility is evaluated at two points: registration and join. At registration, the service checks the audience policy against the caller's organisation and org-unit memberships. At join, the same check runs again; a member whose organisation lost eligibility between registration and join receives 403 `not_eligible` [D-CW-17].

A host (presenter or moderator) can give an attendee the floor by calling `POST /webinars/:id/participants/:participantId/give-floor`. This emits `webinar.floor.given` only to the given participant's socket. The participant sees a dialog stating that their audio will be enabled, their voice is part of the recording, and their camera stays off. Only after the participant acknowledges does the attendee unmute. The server calls `UpdateAttendeeCapabilities` to set audio to `SendReceive`; video stays at `Receive` (section 4.7). Taking the floor back (`POST .../take-floor`) reverses the audio capability and sends `webinar.floor.taken` to that participant's socket [D-CW-15, D-CW-35].

Chat works through Socket.IO and PostgreSQL. An attendee submits a message via `POST /webinars/:id/messages`; it persists in `webinar_messages` with status `PENDING` and emits `webinar.message.submitted` to the `:moderation` room. A host publishes, answers or dismisses it. Published messages emit `webinar.message.published` to the main webinar room. Answered messages emit `webinar.message.answered` with the answer text. Host messages are published immediately. Attendee messages and questions reach the audience only when a host publishes them, anonymous by default or with the first name the attendee attached [D-CW-35].

Polls are created by the moderator, opened (which emits `webinar.poll.opened` to all attendees), voted on (each vote increments an aggregate counter in `webinar_poll_options`, never storing the voter id), closed (which emits `webinar.poll.results` with the aggregate counts), and optionally shared on screen [D-CW-16, WEB-35].

When the moderator ends the webinar, the end handler stops the recording pipeline and emits `webinar.ended` to both rooms [D-CW-34].

### 4.9 Session status transitions

The `call_session_status` enum: `pending` (row created) -> `creating` (lock acquired, `CreateMeeting` in flight) -> `active` (provider meeting id written) -> `ended` (meeting deleted or `MeetingEnded` event received) -> `failed` (creation threw an unrecoverable error). Transitions are written in a `CASE` expression that rejects out-of-order updates. **CW-R-18**: the only valid transitions are `pending -> creating`, `creating -> active`, `creating -> failed`, `active -> ended`.

---

## 5. Data model

All tables are defined in Drizzle schema files under `apps/api/src/db/schema/`. New domain tables go in `calls.ts` and `webinars.ts` (guideline choice). The `_shared.ts` helpers (`idColumn`, `ts`, `createdAt`, `updatedAt`, `tenantPredicate`, `tenantPredicateVia`) are used without exception.

### 5.1 Appointment-side tables

PostgreSQL enum values are UPPER_CASE, matching the convention in `enums.ts` (every existing pgEnum uses UPPER_CASE: `'COMPANY'`, `'INVITED'`, `'ACTIVE'` and so on). The lower-case spellings used by the contracts package and the API responses are mapped once in each Drizzle repository (a lookup object or a small helper), so the mapping lives in one place and never leaks into controllers or services. **CW-R-19a**: every new pgEnum uses UPPER_CASE values; the repository layer maps them to the lower-case contract values before they leave the module [D-CW-25].

```ts
// calls.ts
export const callFormats = pgEnum('call_format', [
  'CONSULTATION', 'WEBINAR', 'WORKSHOP',
]);
export const appointmentStatuses = pgEnum('appointment_status', [
  'PROPOSED', 'AWAITING_APPROVAL', 'CONFIRMED', 'COMPLETED',
  'CANCELED', 'DECLINED', 'NO_SHOW',
]);
export const callSessionStatuses = pgEnum('call_session_status', [
  'PENDING', 'CREATING', 'ACTIVE', 'ENDED', 'FAILED',
]);
export const callParticipantRoles = pgEnum('call_participant_role', [
  'EXPERT', 'EMPLOYEE', 'PRESENTER', 'MODERATOR',
  'ATTENDEE', 'FACILITATOR', 'PARTICIPANT',
]);
export const callOutcomeStatuses = pgEnum('call_outcome_status', [
  'COMPLETED', 'NO_SHOW_EMPLOYEE', 'NO_SHOW_EXPERT',
  'TECHNICAL_FAILURE', 'CANCELED',
]);

export const appointments = pgTable('appointments', {
  id: idColumn(),
  orgId: text().notNull(),
  expertUserId: text().notNull(),
  employeeUserId: text().notNull(),
  serviceCategory: text().notNull(),
  startsAt: ts().notNull(),
  endsAt: ts().notNull(),
  timeZone: text().notNull(),
  status: appointmentStatuses().notNull().default('CONFIRMED'),
  followUpOf: text(), // nullable self-reference to an earlier appointment [D-CW-37]
  fundingRef: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
```

The `format` column does not belong on `appointments`; it lives on `call_sessions`, because the format is a property of the real-time session, not the booking spine. An appointment is always a consultation or a workshop depending on context; the booking epic determines which.

**CW-R-100**: the `appointments.follow_up_of` column is a nullable self-reference. A follow-up can be proposed only when the linked appointment's outcome status is `COMPLETED` (guarded in the service; the error code is `follow_up_not_allowed`) [D-CW-37].

The `appointment_approvals` table tracks approval items for follow-up appointments when the organisation's `follow_up_approval_policy` is `MANAGER_APPROVAL` [D-CW-37]:

```ts
export const appointmentApprovalStatuses = pgEnum('appointment_approval_status', [
  'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED',
]);

export const appointmentApprovals = pgTable('appointment_approvals', {
  id: idColumn(),
  appointmentId: text().notNull(),
  orgId: text().notNull(),
  approverUserId: text().notNull(),
  alternateUserId: text(),
  status: appointmentApprovalStatuses().notNull().default('PENDING'),
  safeReason: text(), // max 300 characters, validated in the service
  decidedAt: ts(),
  remindedAt: ts(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index('appointment_approvals_appointment_id_idx').on(table.appointmentId),
  index('appointment_approvals_approver_user_id_idx').on(table.approverUserId),
  pgPolicy('appointment_approvals_tenant_isolation', {
    for: 'all',
    using: tenantPredicate(table.orgId),
    withCheck: tenantPredicate(table.orgId),
  }),
]).enableRLS();
```

**CW-R-101**: `appointment_approvals` is tenant-scoped by `orgId`, carries forced RLS, and has indexes on `appointmentId` and `approverUserId`. The `safeReason` column holds at most 300 characters of approver-visible text; it is validated in the service layer [D-CW-37].

**CW-R-102**: the organisation column `follow_up_approval_policy` (text, default `'AUTOMATIC'`) is added to the `organizations` table in a migration. The migration line is:

```sql
ALTER TABLE "organizations" ADD COLUMN "follow_up_approval_policy" text NOT NULL DEFAULT 'AUTOMATIC';
```

The column accepts two values: `AUTOMATIC` (follow-up confirmation creates a confirmed appointment directly) and `MANAGER_APPROVAL` (confirmation creates an `awaiting_approval` appointment and routes an approval item) [D-CW-37].

The `appointments` table carries `tenantPredicate(appointments.orgId)` and a forced-RLS migration line. The expert accesses the appointment through the operations-route pattern with a participant check in `authorize()`, not through the org scope; the RLS policy for the expert is `tenantPredicateVia` using an exists clause that joins through `call_participants` to the expert's user id in the principal (guideline choice). **CW-R-19**: the appointment table carries `org_id` (the employee's organisation) and is under forced RLS [D-CW-25].

```ts
export const callSessions = pgTable('call_sessions', {
  id: idColumn(),
  appointmentId: text(),
  webinarId: text(),
  orgId: text(),
  format: callFormats().notNull(),
  providerMeetingId: text(),
  status: callSessionStatuses().notNull().default('PENDING'),
  startsAt: ts().notNull(),
  endsAt: ts().notNull(),
  startedAt: ts(),
  endedAt: ts(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
```

`startsAt` and `endsAt` are the scheduled window (copied from the appointment or occurrence). `startedAt` is nullable and set when the session transitions to `active` (provider meeting id written). `endedAt` is nullable and set when the session transitions to `ended`.

**CW-R-20**: `call_sessions.provider_meeting_id` is nullable; it is set only after `CreateMeeting` succeeds.

`call_participants`, `call_events`, `call_client_events`, `call_outcomes`, `call_feedback` and `call_consents` follow the same pattern: `idColumn`, tenant predicate, timestamps. `call_consents` is schema-only in this epic (columns defined, no production code path writes to it) [D-CW-19].

**CW-R-21**: `call_outcomes` has no free-text field. It stores `status` (the `call_outcome_status` enum), `sessionId`, `recordedByUserId`, `connectionMetrics` (a JSONB column with aggregated quality numbers) and timestamps [D-CW-25].

**CW-R-22**: `call_feedback` stores `sessionId`, `userId`, `score` (integer 1 to 5) and `comment` (nullable text, max 2000 characters). Feedback is visible to NestSelf operations in aggregate and never to the employer [D-CW-25, UX-22].

`call_events` stores raw provider events for attendee-minutes derivation:

```ts
export const callEvents = pgTable('call_events', {
  id: idColumn(),
  sessionId: text().notNull(),
  providerMeetingId: text().notNull(),
  eventType: text().notNull(),
  providerAttendeeId: text(),
  occurredAt: ts().notNull(),
  payload: jsonb(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('call_events_dedup_idx').on(
    table.providerMeetingId,
    table.eventType,
    table.providerAttendeeId,
    table.occurredAt,
  ),
]).enableRLS();
```

**CW-R-22a**: the deduplication index on `(provider_meeting_id, event_type, provider_attendee_id, occurred_at)` is a unique index, not a unique constraint, because `provider_attendee_id` is nullable for meeting-level events [D-CW-12].

`call_client_events` stores client-reported telemetry with 90-day retention:

```ts
export const callClientEvents = pgTable('call_client_events', {
  id: idColumn(),
  sessionId: text().notNull(),
  participantId: text().notNull(),
  eventName: text().notNull(),
  durationMs: integer(),
  metrics: jsonb(),
  deviceError: text(),
  browser: text(),
  os: text(),
  createdAt: createdAt(),
}).enableRLS();
```

**CW-R-22b**: `call_client_events` never stores device labels, user names or any content. The `metrics` JSONB holds `{ rtt, jitter, packetLoss, outgoingBitrate }` [D-CW-13].

`call_participants` links users to sessions with their role and timestamps:

```ts
export const callParticipants = pgTable('call_participants', {
  id: idColumn(),
  sessionId: text().notNull(),
  userId: text().notNull(),
  role: callParticipantRoles().notNull(),
  providerAttendeeId: text(),
  firstJoinedAt: ts(),
  lastLeftAt: ts(),
  reconnectCount: integer().notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
```

**CW-R-22c**: `call_participants.id` is the value used as `ExternalUserId` when calling the provider. It is a random id generated per session and participant, never reused across sessions [D-CW-11].

### 5.2 Webinar tables

```ts
export const webinarStatuses = pgEnum('webinar_status', [
  'DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'CANCELED',
]);
export const recordingStatuses = pgEnum('recording_status', [
  'SCHEDULED', 'RECORDING', 'PROCESSING', 'READY', 'HANDED_OFF', 'FAILED',
]);
export const webinarMessageKinds = pgEnum('webinar_message_kind', [
  'HOST', 'ATTENDEE', 'QUESTION',
]);
export const webinarMessageStatuses = pgEnum('webinar_message_status', [
  'PENDING', 'PUBLISHED', 'ANSWERED', 'DISMISSED',
]);

export const webinars = pgTable('webinars', {
  id: idColumn(),
  orgId: text(), // null for all_eligible
  title: text().notNull(),
  description: text(),
  audiencePolicy: text().notNull(), // 'all_eligible' | org_id | org_unit_ids JSON
  capacity: integer().notNull().default(250),
  startsAt: ts().notNull(),
  endsAt: ts().notNull(),
  timeZone: text().notNull(),
  status: webinarStatuses().notNull().default('DRAFT'),
  chatPolicy: text().notNull().default('moderated'),
  createdByUserId: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
```

`webinars` with `org_id = null` (the `all_eligible` case) use `tenantPredicate(webinars.orgId, { nullable: true })`, which produces an RLS policy that allows the row when the session's org scope is null (platform scope) or matches, following the `grants` table pattern in `authorization.ts` [D-CW-25]. Because `nullable: true` makes all `all_eligible` webinars visible to every org scope, audience eligibility filtering must happen in the service layer, not through RLS alone. **CW-R-23**: webinar tables for `all_eligible` occurrences carry `org_id = null`; organisation-scoped occurrences carry the organisation id. The service filters by audience policy after the RLS predicate passes [D-CW-25].

`webinar_hosts`, `webinar_registrations`, `webinar_messages`, `webinar_polls`, `webinar_poll_options`, `webinar_poll_results`, `webinar_recordings` and `webinar_certificates` all live in `webinars.ts` alongside the `webinars` table and each have their own RLS policy and migration. **CW-R-24**: `webinar_poll_results` stores aggregate counts per option, never the voter id [D-CW-16, WEB-35].

`webinar_messages` replaces the earlier `webinar_questions` concept. It stores all chat messages (host posts, attendee messages and questions) in one table [D-CW-35]:

```ts
export const webinarMessages = pgTable('webinar_messages', {
  id: idColumn(),
  webinarId: text().notNull(),
  sessionId: text().notNull(),
  kind: webinarMessageKinds().notNull(),
  status: webinarMessageStatuses().notNull().default('PENDING'),
  authorParticipantId: text(), // nullable for host messages sent by a non-participant moderator
  text: text().notNull(), // max 1000 characters, validated in the service
  showFirstName: boolean().notNull().default(false),
  publishedAt: ts(),
  answerText: text(), // host answer, max 2000 characters
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
```

**CW-R-103**: host messages (`kind = 'HOST'`) are published immediately (status `PUBLISHED`). Attendee messages and questions start with status `PENDING` and reach the audience only when a host publishes them. `showFirstName` defaults to `false` (anonymous); the attendee may opt in per message. **CW-R-104**: attendees receive only messages with status `PUBLISHED` or `ANSWERED` through the `webinar:{webinarId}` room; pending and dismissed messages are visible only in the `webinar:{webinarId}:moderation` room [D-CW-35].

`webinar_hosts` links presenters and the moderator to a webinar:

```ts
export const webinarHosts = pgTable('webinar_hosts', {
  id: idColumn(),
  webinarId: text().notNull(),
  userId: text().notNull(),
  role: callParticipantRoles().notNull(), // 'PRESENTER' or 'MODERATOR'
  displayName: text().notNull(),
  createdAt: createdAt(),
}).enableRLS();
```

`webinar_registrations` tracks who registered and their attendance:

```ts
export const webinarRegistrations = pgTable('webinar_registrations', {
  id: idColumn(),
  webinarId: text().notNull(),
  userId: text().notNull(),
  orgId: text(),
  registeredAt: ts().notNull(),
  joinedAt: ts(),
  leftAt: ts(),
  attendedMinutes: integer(),
  canceledAt: ts(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('webinar_registrations_user_idx').on(
    table.webinarId,
    table.userId,
  ),
]).enableRLS();
```

**CW-R-24a**: the unique index on `(webinar_id, user_id)` prevents duplicate registrations at the database level. The application-level `already_registered` error code is the first line of defence; the unique constraint is the second.

`webinar_recordings` tracks the recording pipeline lifecycle:

```ts
export const webinarRecordings = pgTable('webinar_recordings', {
  id: idColumn(),
  webinarId: text().notNull(),
  sessionId: text().notNull(),
  status: recordingStatuses().notNull().default('SCHEDULED'),
  providerPipelineId: text(),
  rawSegmentsPrefix: text(),
  concatenatedKey: text(),
  handoffStatus: text().default('pending'),
  startedAt: ts(),
  stoppedAt: ts(),
  readyAt: ts(),
  handedOffAt: ts(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
```

**CW-R-24b**: `webinar_recordings.handoff_status` is `pending` until the CMS media module interface exists. When it lands, a one-line adapter changes the handoff to create a draft content item [D-CW-03].

`webinar_certificates` records issued attendance certificates:

```ts
export const webinarCertificates = pgTable('webinar_certificates', {
  id: idColumn(),
  webinarId: text().notNull(),
  userId: text().notNull(),
  registrationId: text().notNull(),
  title: text().notNull(),
  issuedAt: ts().notNull(),
  attendedMinutes: integer().notNull(),
  includesTopic: boolean().notNull().default(false),
  createdAt: createdAt(),
}).enableRLS();
```

**CW-R-24c**: the certificate title is "NestSelf webinar" and the date. The topic is included only if the attendee opted in at the time of requesting the certificate (default: not included) [D-CW-26, F-CW-03].

### 5.3 Migration workflow

After defining tables, run `pnpm --filter @nestself/api db:generate` to produce the migration SQL. Migration file names use the next free number (migrations 0000 to 0002 exist, and the parallel auth session may add more; check the current head before naming the file). Then hand-edit the migration to add `ALTER TABLE <name> FORCE ROW LEVEL SECURITY;` for every new table, and any `GRANT` statements the app role needs. **CW-R-25**: every migration with new RLS tables includes the manual `FORCE ROW LEVEL SECURITY` line (survey section 1, migration workflow step 6).

---

## 6. Contracts

New contract files export Zod schemas, companion TypeScript types and constant arrays following the pattern in `packages/contracts/src/auth.ts`. The file split is:

- `packages/contracts/src/appointments.ts` -- appointment schemas, statuses, the seam fields.
- `packages/contracts/src/calls.ts` -- join-window constants, error codes, session schemas.
- `packages/contracts/src/webinars.ts` -- webinar schemas, registration, questions, polls, certificates.

`packages/contracts/src/appointments.ts` exports `AppointmentSchema`, `AppointmentCreateRequestSchema`, `AppointmentResponseSchema`, the `APPOINTMENT_STATUSES` array and the seam fields the booking epic will read: `id`, `orgId`, `expertUserId`, `employeeUserId`, `startsAt`, `endsAt`, `status`, `serviceCategory`, `timeZone` [D-CW-02].

It also exports the follow-up and approval schemas [D-CW-37]:

```ts
export const AppointmentFollowUpRequestSchema = z.object({
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(120),
  timeZone: z.string().min(1),
});

export const AppointmentSuggestTimesRequestSchema = z.object({
  windows: z.array(z.object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })).min(1).max(3),
});

export const AppointmentApprovalDecisionRequestSchema = z.object({
  safeReason: z.string().min(1).max(300),
});

export const FollowUpApprovalPolicySchema = z.enum(['AUTOMATIC', 'MANAGER_APPROVAL']);

export const FOLLOW_UP_APPROVAL_POLICIES = ['AUTOMATIC', 'MANAGER_APPROVAL'] as const;
export type FollowUpApprovalPolicy = (typeof FOLLOW_UP_APPROVAL_POLICIES)[number];
```

**CW-R-109**: `AppointmentApprovalDecisionRequestSchema` requires `safeReason` on reject. On approve the body is empty (no schema required). The `safeReason` is capped at 300 characters [D-CW-37].

**CW-R-110**: `WebinarMessageCreateRequestSchema` validates chat and question submissions:

```ts
export const WebinarMessageCreateRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  kind: z.enum(['attendee', 'question', 'host']),
  showFirstName: z.boolean().default(false),
});
```

Attendees may submit `kind: 'attendee'` or `kind: 'question'`; hosts may submit `kind: 'host'`. The service rejects an attendee submitting `kind: 'host'` [D-CW-35].

`packages/contracts/src/calls.ts` exports the join-window constants and error codes:

```ts
export const CALL_JOIN_WINDOW_BEFORE_MINUTES = 15;
export const CALL_JOIN_WINDOW_AFTER_MINUTES = 10;
export const CALL_ROOM_CLOSE_AFTER_MINUTES = 15;
export const WEBINAR_HOST_JOIN_BEFORE_MINUTES = 30;
export const CALL_TICKET_TTL_SECONDS = 30;
export const WEBINAR_SINGLE_MEETING_CAPACITY = 250;
export const WORKSHOP_CAPACITY = 25;
export const REMINDER_OFFSETS_MINUTES = [1440, 60] as const;

export const CALL_ERROR_CODES = [
  'join_window_closed',
  'appointment_not_joinable',
  'appointment_not_proposed',
  'approval_not_pending',
  'follow_up_not_allowed',
  'approver_missing',
  'video_provider_unavailable',
  'webinar_full',
  'webinar_not_open',
  'registration_closed',
  'already_registered',
  'not_eligible',
  'floor_not_available',
  'recording_not_allowed',
  'capacity_above_limit',
  'invalid_ticket',
  'not_editable',
] as const;
export type CallErrorCode = (typeof CALL_ERROR_CODES)[number];
```

**CW-R-26**: every numeric constant in the list above is imported from `@nestself/contracts`, never hard-coded in a service, controller, test or client module [D-CW-07, D-CW-09, D-CW-10].

`packages/contracts/src/webinars.ts` exports `WebinarSchema`, `WebinarCreateRequestSchema`, `WebinarRegistrationRequestSchema`, `WebinarMessageCreateRequestSchema`, `WebinarPollRequestSchema`, `WebinarPollVoteRequestSchema` and their response counterparts.

**CW-R-27**: new error codes are added to the `CALL_ERROR_CODES` array (not to `AUTH_ERROR_CODES`). The `ApiExceptionFilter` recognises both arrays. A colocated test asserts no overlap and no duplicate.

New actions `event.manage`, `event.moderate` and `event.present` are added to `ACTIONS` in `packages/contracts/src/actions.ts`. Template grants are updated in `packages/contracts/src/templates.ts` per the canonical names table: `expert` gains `event.present` (it already holds `consultation.join`, `delivery.record`, `appointment.propose`), `service_coordinator` gains `event.moderate`, `content_publisher` gains `event.manage`, `platform_owner` and `client_operations` gain both `event.manage` and `event.moderate` [D-CW-16].

**CW-R-27a**: every audit event listed in section 7.4 is appended to the `AUDIT_ACTIONS` array in `apps/api/src/audit/audit-events.ts`. The `categoryFor` function gains prefix handlers for the new event families: `appointment.` maps to ADMIN (except `appointment.completed` and `appointment.no_show` which are FINANCIAL, and `appointment.approval.*` which is ADMIN), `call.` maps to ADMIN by default with overrides (`call.outcome.recorded` is FINANCIAL, `call.diagnostics.viewed` is CONTENT_ACCESS, `call.joined` and `call.ticket.issued` are SECURITY), `org.follow_up_policy.changed` maps to ADMIN, and `webinar.` maps to ADMIN by default with overrides (`webinar.joined` is SECURITY, `webinar.message.*` and `webinar.floor.*` are CONTENT_ACCESS, `webinar.recording.*` is CONTENT_ACCESS). `joinToken` and `JoinToken` are added to the `FORBIDDEN_KEYS` set in `apps/api/src/audit/audit-writer.ts` [D-CW-08].

**CW-R-28**: a contract test asserts that every route in the calls and webinars controllers maps to an action in `ACTIONS` and that every audit event name in the controllers matches the canonical list.

---

## 7. API routes and authorisation

Every route in this epic follows the grants controller pattern: `@Controller` with `@Authorize(action, resolver)`, `@Throttle` on writes, `@Body(new ZodValidationPipe(schema))` for request validation, `@CurrentPrincipal()` for the acting user. Services use `DbService.withOrgScope(orgId, tx => ...)` for tenant-scoped transactions and `AuditWriter.record(...)` for every mutation.

### 7.1 Appointment routes

Routes that address an appointment by `:id` (without `:orgId` in the path) cannot use `orgResourceFromContext`, because that resolver reads `orgId` from `req.params.orgId`, which is absent. Instead they use a custom resolver `appointmentResource` that loads the appointment row by `req.params.id`, derives `orgId` from the row, and returns a not-found resource when the row is missing so the guard answers 404:

```ts
export function appointmentResource(action: string): ResourceResolver {
  return async (req, principal): Promise<Resource> => {
    const id = (req['params'] as Record<string, string>)?.['id'];
    if (!id) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    const row = await appointmentRepo.findById(id);
    if (!row) {
      return { type: 'appointment', orgId: '__not_found__' };
    }
    return { type: 'appointment', orgId: row.orgId, id: row.id };
  };
}
```

When the row is missing, returning an orgId that no grant can match makes the guard produce 404 (the same pattern the auth guards use for missing resources). Only `POST /orgs/:orgId/appointments` uses `orgResourceFromContext('appointment')` because the organisation id is in the path.

| Route | Action | Resolver | Throttle |
| --- | --- | --- | --- |
| `GET /appointments` | `consultation.join` | `appointmentResource('consultation.join')` | none |
| `GET /appointments/:id` | `consultation.join` | `appointmentResource('consultation.join')` | none |
| `POST /orgs/:orgId/appointments` | `appointment.propose` | `orgResourceFromContext('appointment')` | 10/60s |
| `POST /appointments/:id/cancel` | `appointment.cancel` | `appointmentResource('appointment.cancel')` | 10/60s |
| `POST /appointments/:id/join` | `consultation.join` | `appointmentResource('consultation.join')` | 20/60s |
| `POST /appointments/:id/call-ticket` | `consultation.join` | `appointmentResource('consultation.join')` | 10/60s |
| `POST /appointments/:id/end` | `consultation.join` | participant check in service | 10/60s |
| `POST /appointments/:id/outcome` | `delivery.record` | `appointmentResource('delivery.record')` | 10/60s |
| `POST /appointments/:id/feedback` | `consultation.join` | `appointmentResource('consultation.join')` | 5/60s |
| `POST /appointments/:id/signal` | `consultation.join` | `appointmentResource('consultation.join')` | 30/60s |
| `POST /appointments/:id/follow-up` | `appointment.propose` | `appointmentResource('appointment.propose')` | 10/60s |
| `POST /appointments/:id/confirm` | `consultation.join` | `appointmentResource('consultation.join')` | 10/60s |
| `POST /appointments/:id/decline` | `consultation.join` | `appointmentResource('consultation.join')` | 10/60s |
| `POST /appointments/:id/suggest-times` | `consultation.join` | `appointmentResource('consultation.join')` | 10/60s |
| `POST /appointments/:id/schedule` | `appointment.propose` | `appointmentResource('appointment.propose')` | 10/60s |
| `GET /orgs/:orgId/appointment-approvals` | `approval.decide` | `orgResourceFromContext('appointment')` | none |
| `POST /appointment-approvals/:id/approve` | `approval.decide` | `approvalResource('approval.decide')` | 10/60s |
| `POST /appointment-approvals/:id/reject` | `approval.decide` | `approvalResource('approval.decide')` | 10/60s |
| `GET /orgs/:orgId/settings/follow-up-approval` | `program.overview` | `orgResourceFromContext('organization')` | none |
| `PATCH /orgs/:orgId/settings/follow-up-approval` | `program.overview` | `orgResourceFromContext('organization')` | 5/60s |

`POST /appointments/:id/follow-up` is the expert's proposal. The request body is validated against `AppointmentFollowUpRequestSchema`. The service verifies the linked appointment's outcome is `COMPLETED` (error: 409 `follow_up_not_allowed`), creates a new appointment with status `proposed` and `followUpOf` set, and emits `appointment.follow_up.proposed` on the `call:{sessionId}` room. Audit: `appointment.follow_up.proposed`. **CW-R-111** [D-CW-37].

`POST /appointments/:id/confirm` is the employee's confirmation. If the organisation's `followUpApprovalPolicy` is `AUTOMATIC`, the appointment transitions to `confirmed`; if `MANAGER_APPROVAL`, it transitions to `awaiting_approval` and an approval item is created (section 7.5). Audit: `appointment.confirmed`. **CW-R-112** [D-CW-37].

`POST /appointments/:id/decline` is the employee's decline. The appointment transitions to `declined`. Error: 409 `appointment_not_proposed` if the appointment is not in `proposed` status. Audit: `appointment.declined`. **CW-R-113** [D-CW-37].

`POST /appointments/:id/suggest-times` is the employee's alternative. The request body is validated against `AppointmentSuggestTimesRequestSchema` (1 to 3 time windows). The windows are stored and emitted on the `call:{sessionId}` room as `appointment.times_suggested`. Audit: `appointment.times_suggested`. **CW-R-114** [D-CW-37].

`POST /appointments/:id/schedule` is the expert's selection of one suggested window. The appointment is created as confirmed (or routed through approval). Audit: `appointment.confirmed`. **CW-R-115** [D-CW-37].

`POST /appointment-approvals/:id/approve` and `POST /appointment-approvals/:id/reject` use a custom resolver `approvalResource` that loads the approval row, derives `orgId` and returns 404 for missing rows. `reject` requires `AppointmentApprovalDecisionRequestSchema` (`safeReason` required). `authorize()` uses `approval.decide` with the self-approval rule (`orgSelfApprovalAllowed` from the organisation's `selfApprovalAllowed` column) and returns 404 for an approver whose authority does not cover the employee's unit. Audit: `appointment.approval.approved` or `appointment.approval.rejected`. **CW-R-116** [D-CW-37].

`PATCH /orgs/:orgId/settings/follow-up-approval` sets the organisation's `followUpApprovalPolicy`. The request body is validated against `FollowUpApprovalPolicySchema`. Audit: `org.follow_up_policy.changed`. **CW-R-117** [D-CW-37].

The expert's access to appointments in organisations they are assigned to uses the operations-route pattern: the `authorize()` engine checks whether the expert's principal has a grant with a `CLIENT` assignment that covers the appointment's `orgId` (phase-2 pattern from `implementation.md` section 11). The `appointmentResource` resolver loads the appointment row and derives the `orgId` for the guard. The default-deny test accepts `@Authorize()` on these routes, and the golden cases prove the guard rejects non-participants. **CW-R-29**: the join route's resolver loads the appointment and verifies the caller is either `expertUserId` or `employeeUserId` (or a moderator for workshops); a non-participant gets 404, not 403 [D-CW-07].

### 7.2 Call routes

| Route | Action | Resolver | Throttle |
| --- | --- | --- | --- |
| `POST /calls/:sessionId/client-events` | `consultation.join` | participant from session | 60/60s |
| `GET /ops/calls/:sessionId/diagnostics` | `diagnostic.read` | `operationsResource('call', idFn)` | none |

**CW-R-30**: viewing diagnostics is audited as `call.diagnostics.viewed` with `{ sessionId }` in details. The diagnostic DTO is tested by a serialisation test that asserts no field beyond the 4.7.5 set is present [D-CW-28].

### 7.3 Webinar routes

| Route | Action | Resolver | Throttle |
| --- | --- | --- | --- |
| `GET /webinars` | `event.register` | audience eligibility in service | none |
| `GET /webinars/:id` | `event.register` | audience eligibility | none |
| `POST /webinars/:id/register` | `event.register` | audience eligibility | 10/60s |
| `DELETE /webinars/:id/register` | `event.register` | registered user | 10/60s |
| `POST /webinars/:id/join` | `event.register` | registered participant | 20/60s |
| `POST /webinars/:id/start` | `@Authenticated()` | service-level check (see below) | 5/60s |
| `POST /webinars/:id/end` | `@Authenticated()` | service-level check (see below) | 5/60s |
| `POST /webinars/:id/messages` | `event.register` | registered participant (attendee) or host | 20/60s |
| `GET /webinars/:id/messages` | `event.register` | registered participant (attendees: published only; hosts: all) | none |
| `POST /webinars/:id/messages/:messageId/publish` | `event.moderate` | `orgResourceFromContext('webinar')` | 30/60s |
| `POST /webinars/:id/messages/:messageId/answer` | `event.moderate` | `orgResourceFromContext('webinar')` | 30/60s |
| `POST /webinars/:id/messages/:messageId/dismiss` | `event.moderate` | `orgResourceFromContext('webinar')` | 30/60s |
| `POST /webinars/:id/hand` | `event.register` | registered participant | 10/60s |
| `DELETE /webinars/:id/hand` | `event.register` | registered participant | 10/60s |
| `POST /webinars/:id/participants/:participantId/give-floor` | `event.moderate` | `orgResourceFromContext('webinar')` | 10/60s |
| `POST /webinars/:id/participants/:participantId/take-floor` | `event.moderate` | `orgResourceFromContext('webinar')` | 10/60s |
| `POST /webinars/:id/polls` | `event.moderate` | `orgResourceFromContext('webinar')` | 10/60s |
| `POST /webinars/:id/polls/:pollId/open` | `event.moderate` | `orgResourceFromContext('webinar')` | 10/60s |
| `POST /webinars/:id/polls/:pollId/close` | `event.moderate` | `orgResourceFromContext('webinar')` | 10/60s |
| `POST /webinars/:id/polls/:pollId/vote` | `event.register` | registered participant | 30/60s |
| `POST /webinars/:id/recording/stop` | `event.moderate` | `orgResourceFromContext('webinar')` | 5/60s |
| `POST /ops/webinars` | `event.manage` | `operationsOrgResource('webinar')` | 10/60s |
| `PATCH /ops/webinars/:id` | `event.manage` | `operationsResource('webinar', idFn)` | 10/60s |
| `POST /ops/webinars/:id/publish` | `event.manage` | `operationsResource('webinar', idFn)` | 5/60s |
| `POST /ops/webinars/:id/cancel` | `event.manage` | `operationsResource('webinar', idFn)` | 5/60s |
| `GET /ops/webinars/:id/attendance` | `event.manage` | `operationsResource('webinar', idFn)` | none |
| `GET /webinars/:id/certificate` | `event.register` | registered participant | 10/60s |
| `GET /webinars/:id/polls` (addition, T-CW-2.1) | `@Authenticated()` | registrants and presenters: opened polls; moderating: all; results once closed (service) | none |
| `GET /webinars/:id/polls/:pollId/results` (addition, T-CW-2.1) | `@Authenticated()` | a host or moderating principal, after the close (service) | none |
| `GET /ops/webinars` (addition, T-CW-2.1) | `@Authenticated()` | `event.manage` or `event.moderate`, operations context; `mine=true`: the caller's hosted occurrences, any context (service) | none |
| `GET /ops/webinars/:id` (addition, T-CW-2.1) | `@Authenticated()` | `event.manage` or `event.moderate` on the occurrence, operations context (service) | none |
| `GET /ops/webinars/host-candidates` (addition, T-CW-2.1) | `@Authenticated()` | `event.manage`, operations context (service) | none |
| `GET /ops/orgs` (addition, T-CW-2.1) | `@Authenticated()` | `event.manage`, operations context: the organisations the caller may manage (service) | none |

**CW-R-31b** (T-CW-2.1 review): publishing an occurrence, and editing a published one, checks through `authorize()` that the moderator holds `event.moderate` and each presenter `event.present` on the occurrence (the presenter with the CASE assignment the occurrence form gives) and answers 400 `validation` naming the field. A published occurrence also keeps the other publish checks (a moderator, at least one presenter, a start in the future); its capacity is compared with the registrations under the row lock; an audience change that moves it to another organisation answers 409 `not_editable`, as does any edit once it is live, ended or canceled. Cancel and end close the presenters' CASE assignments on the occurrence. The media capture pipeline takes one meeting seat (SPIKE-CW-03 assumption), so the session is created for the capacity plus one.

`POST /webinars/:id/start` and `POST /webinars/:id/end` use `@Authenticated()` on the route (not `@Authorize()`), because the check requires loading the webinar occurrence to determine whether the caller is its presenter (`event.present`) or its moderator (`event.moderate`). The service loads the occurrence, checks the caller against `webinar_hosts`, and verifies the caller holds either `event.present` (a presenter of this occurrence) or `event.moderate` (its moderator) through `authorize()` called inside the service; if neither matches, the service throws 404. The default-deny CI test accepts `@Authenticated()` on these routes, and the authorisation golden cases prove the service-level check rejects non-hosts. **CW-R-31a**: `POST /webinars/:id/start` and `POST /webinars/:id/end` accept `event.present` or `event.moderate`; a caller who holds neither gets 404 [D-CW-17].

**CW-R-31**: webinar registration enforces capacity with `SELECT ... FOR UPDATE` on the webinar row inside a transaction. This prevents double-booking under concurrent requests [D-CW-17].

**CW-R-32**: webinar listing (`GET /webinars`) returns only occurrences the caller is eligible for, evaluated from the audience policy against the caller's organisation and org-unit memberships [D-CW-17].

**CW-R-33**: no endpoint in this epic returns a participant list, registration list, message author or feedback row to a principal whose grants are organisation-scoped only (employer roles). The default-deny test plus authorisation golden cases prove this [D-CW-30].

### 7.4 Approver selection algorithm

When a follow-up appointment enters `awaiting_approval`, the service selects an approver using the `approval_authorities` table in `apps/api/src/db/schema/authorization.ts` (columns: `userId`, `orgId`, `orgUnitId`, `includeDescendants`, `categories`, `validFrom`, `validUntil`, `alternateUserId`, `isConfidentialApprover`). The selection runs as a numbered sequence [D-CW-37]:

1. Load the employee's active membership and its org-unit id from the `memberships` table.
2. Find approval authorities of the same organisation whose unit covers the employee's unit: `orgUnitId` equals the employee's unit or, with `includeDescendants = true`, is an ancestor of the employee's unit through the `org_unit_closure` table.
3. Filter to authorities whose `categories` array is empty (covers all categories) or includes `consultation_follow_up`.
4. Filter to authorities whose validity window covers today (`validFrom <= now` and `validUntil` is null or `>= now`).
5. `isConfidentialApprover` does not exclude an authority: the flag is an extra capability (its holder may also decide confidential items), not a reservation, and follow-up approval items carry no service category (LAW-14). When the employee is the authority's own holder and the organisation does not allow self-approval, the authority is used only if it names a different alternate; the employee then gets no request email, does not see the item and may not decide it. At decision time the guard's `authorize()` call checks `approval.decide` on the item's organisation, and the approval service runs `authorize()` a second time with the employee as `requesterId` so the engine's self-approval step applies (403 `self_approval_denied`); the decider's authority must also still cover the employee's unit, otherwise 404 (amended 2026-10-25, T-CW-1.10).
6. Pick the first by unit depth (closest to the employee's unit in the closure table), with ties broken by `createdAt` ascending.
7. The selected authority's `userId` becomes the approver; `alternateUserId` (if present) becomes the alternate.
8. If no authority matches, the proposal fails visibly with error code `approver_missing` (409). The audit event `appointment.approval.missing_approver` is recorded with `{ appointmentId, orgId, orgUnitId }`.

**CW-R-118**: the approver selection fails loudly with `approver_missing` rather than silently creating an unrouted approval item. The employee sees a message that the follow-up cannot be approved at this time and should contact their HR department [D-CW-37].

**CW-R-119**: the approver DTO allowlist contains only: the employee's display name, the fixed label key `approval.follow_up_label`, `startsAt` and `durationMinutes`. No service category, expert name, specialty or any content is exposed to the approver (LAW-14). A serialisation test asserts no other field is present in the approval notification payload [D-CW-37].

### 7.5 Audit events

Every mutation in this epic records an audit event through `AuditWriter.record(input)`. The event names follow the `domain.verb[.qualifier]` convention established by the existing audit events (e.g. `auth.sign_in.succeeded`, `grant.created`).

| Audit event | Category | Details (safe keys only) |
| --- | --- | --- |
| `appointment.created` | ADMIN | `{ appointmentId, orgId, expertUserId, employeeUserId, format }` |
| `appointment.canceled` | ADMIN | `{ appointmentId, canceledByUserId }` |
| `appointment.completed` | FINANCIAL | `{ appointmentId }` |
| `appointment.no_show` | FINANCIAL | `{ appointmentId, status }` |
| `appointment.follow_up.proposed` | ADMIN | `{ appointmentId, followUpOfId, expertUserId }` |
| `appointment.confirmed` | ADMIN | `{ appointmentId, confirmedByUserId }` |
| `appointment.declined` | ADMIN | `{ appointmentId, declinedByUserId }` |
| `appointment.times_suggested` | ADMIN | `{ appointmentId, windowCount }` |
| `appointment.approval.requested` | ADMIN | `{ approvalId, appointmentId, approverUserId }` |
| `appointment.approval.approved` | ADMIN | `{ approvalId, appointmentId, approverUserId }` |
| `appointment.approval.rejected` | ADMIN | `{ approvalId, appointmentId, approverUserId }` |
| `appointment.approval.expired` | ADMIN | `{ approvalId, appointmentId }` |
| `appointment.approval.missing_approver` | ADMIN | `{ appointmentId, orgId, orgUnitId }` |
| `org.follow_up_policy.changed` | ADMIN | `{ orgId, oldPolicy, newPolicy }` |
| `call.session.created` | ADMIN | `{ sessionId, appointmentId, format }` |
| `call.joined` | SECURITY | `{ sessionId, participantId, role }` |
| `call.ended` | ADMIN | `{ sessionId, endedByUserId }` |
| `call.outcome.recorded` | FINANCIAL | `{ sessionId, outcomeStatus }` |
| `call.feedback.submitted` | ADMIN | `{ sessionId }` |
| `call.diagnostics.viewed` | CONTENT_ACCESS | `{ sessionId, viewedByUserId }` |
| `call.ticket.issued` | SECURITY | `{ appointmentId, participantId }` |
| `webinar.created` | ADMIN | `{ webinarId, createdByUserId }` |
| `webinar.published` | ADMIN | `{ webinarId }` |
| `webinar.canceled` | ADMIN | `{ webinarId }` |
| `webinar.started` | ADMIN | `{ webinarId, sessionId }` |
| `webinar.ended` | ADMIN | `{ webinarId, sessionId }` |
| `webinar.registered` | ADMIN | `{ webinarId, userId }` |
| `webinar.unregistered` | ADMIN | `{ webinarId, userId }` |
| `webinar.joined` | SECURITY | `{ webinarId, participantId }` |
| `webinar.message.submitted` | CONTENT_ACCESS | `{ webinarId, messageId }` |
| `webinar.message.published` | CONTENT_ACCESS | `{ webinarId, messageId }` |
| `webinar.message.answered` | CONTENT_ACCESS | `{ webinarId, messageId }` |
| `webinar.message.dismissed` | CONTENT_ACCESS | `{ webinarId, messageId }` |
| `webinar.floor.given` | CONTENT_ACCESS | `{ webinarId, participantId, recordingNoticeShown: true }` |
| `webinar.floor.taken` | CONTENT_ACCESS | `{ webinarId, participantId }` |
| `webinar.poll.opened` | ADMIN | `{ webinarId, pollId }` |
| `webinar.poll.closed` | ADMIN | `{ webinarId, pollId }` |
| `webinar.recording.started` | CONTENT_ACCESS | `{ webinarId, sessionId }` |
| `webinar.recording.stopped` | CONTENT_ACCESS | `{ webinarId, sessionId }` |
| `webinar.recording.ready` | CONTENT_ACCESS | `{ webinarId, recordingId }` |
| `webinar.recording.handed_off` | CONTENT_ACCESS | `{ webinarId, recordingId }` |
| `webinar.certificate.issued` | ADMIN | `{ webinarId, certificateId, userId }` |
| `webinar.updated` (addition) | ADMIN | `{ webinarId, changedFields }` |
| `webinar.attendance.viewed` (addition, WBN-33) | CONTENT_ACCESS | `{ webinarId }`, recorded after the read is allowed |
| `webinar.recording.failed` (addition, T-CW-2.5) | CONTENT_ACCESS | `{ webinarId, sessionId, recordingId, reason }` |

**CW-R-33a**: audit event details never include `token`, `JoinToken`, `credentials`, `email`, `body`, `notes` or any key in the `FORBIDDEN_KEYS` set. A colocated test scans every `audit.record()` call site in the calls and webinars modules and asserts that no forbidden key appears in the details argument [D-CW-08].

**CW-R-33b**: `call.joined` and `webinar.joined` are categorised as `SECURITY` (they prove who was in the room). `call.outcome.recorded` and `appointment.completed` are `FINANCIAL` (they feed settlement). Recording events are `CONTENT_ACCESS` [D-CW-25].

---

## 8. Real-time layer (Socket.IO)

New rooms and events are added to the existing `EventsGateway`. A client sends `subscribe { room }`; `action` and `resource` are optional and ignored. The served room names are the table at the top of `apps/api/src/ws/ws-messages.ts`, and `SubscriptionAuthorizer.authorizeRoom` derives the action and the resource below from the room on the server (the owning module's resolver in `RoomAccessRegistry`) before it calls `authorize()`.

A call room stays subscribable for its participants after the session ends, so the post-call screens receive the follow-up events (D-CW-37); there is no time bound for now.

| Room | Action | Events |
| --- | --- | --- |
| `call:{sessionId}` | `consultation.join` | `call.participant.joined`, `call.participant.left`, `call.session.ended`, `call.signal`, `appointment.follow_up.proposed`, `appointment.follow_up.confirmed`, `appointment.follow_up.declined`, `appointment.times_suggested` |
| `webinar:{webinarId}` | `event.register` | `webinar.state`, `webinar.message.published`, `webinar.message.answered`, `webinar.poll.opened`, `webinar.poll.closed`, `webinar.poll.results`, `webinar.recording` (started, stopped), `webinar.ended` |
| `webinar:{webinarId}:moderation` | `event.moderate` | `webinar.message.submitted`, `webinar.hand.raised`, `webinar.hand.lowered`, `webinar.attendance.count` |

**CW-R-34**: `webinar.floor.given` and `webinar.floor.taken` are emitted only to the given participant's socket, not to the room. The floor events carry `{ participantId }` and are scoped to one connection [D-CW-15, D-CW-35].

**CW-R-34a**: attendees subscribed to `webinar:{webinarId}` receive only messages with status `PUBLISHED` or `ANSWERED`. Pending and dismissed messages are visible only in the `webinar:{webinarId}:moderation` room [D-CW-35].

**CW-R-35**: the `call.signal` event carries only the signal type (`cannot_hear`, `cannot_see`, `running_late`); no user name or personal data. Signals are not persisted beyond the session [D-CW-27].

**CW-R-36**: event payloads are validated with Zod schemas in `ws-messages.ts` before emission. New schemas follow the existing `SubscribeMessage` and `UnsubscribeMessage` pattern. The `SubscribeMessageSchema` room field gains a `refine()` (or a dedicated `CallSubscribeSchema`) that validates the room patterns `call:{id}`, `webinar:{id}` and `webinar:{id}:moderation`, so that only well-formed room names are accepted by the gateway.

New Socket.IO payload schemas in `ws-messages.ts`:

```ts
export const FollowUpProposedPayloadSchema = z.object({
  appointmentId: z.string().min(1),
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int(),
});

export const FollowUpConfirmedPayloadSchema = z.object({
  appointmentId: z.string().min(1),
});

export const FollowUpDeclinedPayloadSchema = z.object({
  appointmentId: z.string().min(1),
});

export const TimesSuggestedPayloadSchema = z.object({
  appointmentId: z.string().min(1),
  windows: z.array(z.object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })).min(1).max(3),
});

export const WebinarMessagePublishedPayloadSchema = z.object({
  messageId: z.string().min(1),
  text: z.string(),
  kind: z.enum(['host', 'attendee', 'question']),
  showFirstName: z.boolean(),
  firstName: z.string().nullable(),
  publishedAt: z.string().datetime(),
});

export const WebinarMessageAnsweredPayloadSchema = z.object({
  messageId: z.string().min(1),
  answerText: z.string(),
});

export const FloorEventPayloadSchema = z.object({
  participantId: z.string().min(1),
});

export const WebinarRecordingPayloadSchema = z.object({
  status: z.enum(['started', 'stopped']),
});
```

**CW-R-120** [D-CW-35, D-CW-37].

Quick signals ("I cannot hear you", "I cannot see you", "running late") are delivered through `POST /appointments/:id/signal` and broadcast to the `call:{sessionId}` room. They are not persisted beyond the session [D-CW-27].

Workshop session chat is delivered through the `call:{sessionId}` room with event type `call.chat.message`. Messages are persisted in a dedicated `call_messages` table (not in `call_events`, which holds provider events only) and deleted 24 hours after the session ends by a maintenance job [D-CW-27, D-CW-29].

```ts
export const callMessages = pgTable('call_messages', {
  id: idColumn(),
  sessionId: text().notNull(),
  participantId: text().notNull(),
  body: text().notNull(), // max 2000 characters, validated in the service
  sentAt: ts().notNull(),
  createdAt: createdAt(),
}).enableRLS();
```

The `call_messages` table carries RLS like `call_participants` (tenant-scoped through the session's `orgId`). Retention is 24 hours after the session ends; the cleanup maintenance job deletes rows whose session `endedAt + interval '24 hours'` has passed. **CW-R-36c**: workshop chat messages live in `call_messages`, not in `call_events`. The table schema, RLS policy and 24-hour retention rule match D-CW-27 and D-CW-29.

**CW-R-36a**: the moderation room `webinar:{webinarId}:moderation` is accessible only to principals with `event.moderate` on the webinar resource. Attendee-submitted questions, hand-raise events and attendance count updates flow through this room to keep them invisible to other attendees [D-CW-16].

**CW-R-36b**: when the moderator ends the webinar, `webinar.ended` is emitted to both the main webinar room and the moderation room. The client disconnects from the Chime meeting session within 2 seconds of receiving this event (guideline choice).

---

## 9. Background worker and job scheduling

Call-specific jobs run on a separate service, `CallsJobSchedulerService` (`apps/api/src/jobs/calls-job-scheduler.service.ts`), with its own BullMQ `Queue` and `Worker` on the `nestself-calls` queue. This avoids blocking the maintenance queue and follows the same structural pattern as `JobSchedulerService` on `nestself-maintenance`.

`CallsJobSchedulerService` provides two scheduling modes:

- **Per-entity delayed jobs**: `queue.add(name, data, { delay, jobId })` for reminder, cleanup and follow-up jobs. The `jobId` is deterministic (for example `appointment.remind:{appointmentId}:{offset}`) so that re-scheduling the same job is idempotent and cancellation can remove it by id.
- **Recurring jobs**: `queue.upsertJobScheduler('calls.reconcile', { pattern, tz })` for the 5-minute reconcile sweep.

The service is started in the worker process alongside `JobSchedulerService.start()` in `apps/api/src/worker/main.ts`. It follows the same `start()` / `onModuleDestroy()` lifecycle.

| Job name | Trigger | Queue | Schedule |
| --- | --- | --- | --- |
| `appointment.remind` | Delayed, scheduled at appointment creation for each offset | `nestself-calls` | at `startsAt - 1440 min` and `startsAt - 60 min` |
| `webinar.remind` | Delayed, scheduled at registration for each offset | `nestself-calls` | at `startsAt - 1440 min` and `startsAt - 60 min` |
| `calls.cleanup` | Delayed, scheduled at session creation | `nestself-calls` | at `endsAt + 15 min` |
| `calls.reconcile` | Recurring | `nestself-calls` | every 5 minutes, `Europe/Belgrade` |
| `calls.no_show_followup` | Delayed | `nestself-calls` | 48 hours after `endsAt` |
| `webinar.recording.start` | Enqueued when the moderator starts the webinar | `nestself-calls` | immediate |
| `webinar.recording.finalize` | Triggered when all segments arrive | `nestself-calls` | immediate |
| `webinar.certificates.issue` | Triggered after webinar ends | `nestself-calls` | immediate |
| `appointment.approval.remind` | Delayed 5 working days after approval creation | `nestself-calls` | see below |
| `chime.events.consume` | Long-running poller in the worker | n/a (custom loop) | continuous |

**CW-R-37a**: `CallsJobSchedulerService` owns all delayed and recurring jobs for this epic. Delayed jobs use a deterministic `jobId` so that re-scheduling is idempotent and cancellation removes the correct job. When an appointment or webinar is canceled, the service removes all pending jobs for that entity by id.

**CW-R-37**: every delayed job carries the appointment or webinar id and the session id. When the job fires, it re-reads the current state; if the appointment has been canceled in the meantime, the job exits without action [D-CW-09].

**CW-R-38**: `calls.reconcile` is idempotent and crash-safe. It queries `call_sessions` where `status = 'active'` and `endsAt + interval '15 minutes' < now()` and calls `endSession` for each. Duplicates with the cleanup job are harmless [D-CW-09].

**CW-R-121**: `webinar.recording.start` is enqueued by the webinar start handler. It creates the media capture pipeline with `SelectedVideoStreams` and `CompositedVideo PresenterOnly` at HD. If the pipeline fails, the job logs the error and sets `webinar_recordings.status` to `FAILED`; the webinar continues without recording and the moderator is notified via the moderation room [D-CW-18, D-CW-34].

**CW-R-122**: `appointment.approval.remind` is a delayed job scheduled 5 working days after the approval item is created. Working days are Monday through Friday in `Europe/Belgrade`; Serbian public holidays are not modelled in this epic (a holiday table is a future enhancement). The job sends a reminder notification to the approver and the alternate (if present). When a follow-up is confirmed, the reminder job is removed by its deterministic id (`appointment.approval.remind:{approvalId}`). When a follow-up is declined or canceled, the reminder job is also removed [D-CW-37].

### 9.1 Chime event consumption

The Chime event consumer is a standalone `ChimeEventsConsumer` class (`apps/api/src/calls/chime-events-consumer.ts`) with its own `ReceiveMessage` polling loop, not a BullMQ job. It is started alongside `JobSchedulerService.start()` and `CallsJobSchedulerService.start()` in `apps/api/src/worker/main.ts` and registers a `SIGTERM` handler for graceful shutdown (finish processing the current batch, then stop polling). The consumer polls the SQS queue using `ReceiveMessage` with `WaitTimeSeconds: 20` (long polling) and `VisibilityTimeout: 60` [D-CW-12]. Each message is parsed, deduplicated against `call_events` using the composite unique key `(provider_meeting_id, event_type, provider_attendee_id, occurred_at)` and applied to the session and participant state.

**CW-R-39**: events are applied out of order safely. `AttendeeJoined` sets `first_joined_at` only if currently null. `AttendeeLeft` and `AttendeeDropped` set `last_left_at` to `GREATEST(last_left_at, event_timestamp)`. `MeetingEnded` transitions the session to `ended` exactly once [D-CW-12, OPS-12, OPS-15].

**CW-R-40**: the dead-letter queue receives messages after 5 failed receives. A CloudWatch alarm fires when the DLQ depth exceeds 0 [D-CW-12].

**CW-R-41**: locally and in tests, `FakeVideoProvider` emits events through an in-process `EventEmitter` that the same handler subscribes to. The SQS client is never instantiated when `VIDEO_PROVIDER=none` [D-CW-05, D-CW-12].

---

## 10. Notifications

### 10.1 Mailer generalisation

The existing `InvitationMailer` is specific to invitations (one abstract class with `send(input: InvitationMailInput)`, one logging implementation, English only). This epic generalises mailer infrastructure into `apps/api/src/mailer/` [D-CW-26]:

- `Mailer` (abstract class): `send(input: MailInput)` where `MailInput` is `{ to: string; locale: string; subjectKey: string; bodyKey: string; vars: Record<string, string> }`. The input-object pattern matches the existing `InvitationMailer.send(input)` convention.
- `SesMailer`: the production implementation using `SESClient` and `SendEmailCommand`. It resolves `subjectKey` and `bodyKey` against the i18n package's `calls.email.*` namespace for the given locale, interpolates `vars`, and sends the email.
- `LoggingMailer`: logs the subject key, locale and recipient in development (redacts the body).
- `InvitationMailer` becomes a thin wrapper around `Mailer`: its `send(input: InvitationMailInput)` maps to `Mailer.send({ to: input.email, locale, subjectKey: 'invitation.subject', bodyKey: 'invitation.body', vars: { ... } })`. No parallel implementation.

**CW-R-42**: every email template exists in all four locales (`en`, `sr-Latn`, `sr-Cyrl`, `hu`). Email subjects and bodies come from the `calls.email.*` i18n keys in `packages/i18n/locales/{locale}/calls.json`, rendered server-side with the i18n package (not inline strings). The Cyrillic translations are generated from Latin by `pnpm --filter @nestself/i18n build:cyrillic` and therefore require no manual maintenance [D-CW-26].

**CW-R-43**: email subjects are neutral. Consultation reminders use "Your NestSelf session"; webinar reminders use "Your NestSelf webinar". No service category, no expert name, no employer name in the subject [D-CW-26, UX-24].

### 10.5 Follow-up and approval email templates

New email template keys in `calls.email.*` [D-CW-37]:

| Template key | Recipient | Subject (neutral) |
| --- | --- | --- |
| `followUp.proposed` | Employee | "A follow-up session was proposed" |
| `followUp.confirmed` | Expert and employee | "Your follow-up session is confirmed" |
| `followUp.declined` | Expert | "The follow-up session was declined" |
| `approval.requested` | Approver and alternate | "A session approval is waiting for your decision" |
| `approval.reminder` | Approver and alternate | "A session approval is still waiting" |
| `approval.decided` | Employee | "Your session approval has a decision" |
| `webinar.recorded_notice` | Presenters | "Your webinar recording is ready for review" |

**CW-R-123**: all follow-up and approval templates exist in all four locales. Subjects are neutral and reveal no service category, expert specialty or clinical detail. The approval notification to the approver includes only the employee's display name, the label "follow-up session with a NestSelf expert", the date and the duration [D-CW-37, LAW-14].

### 10.2 ICS attachments

`apps/api/src/calendar/ics.ts` generates RFC 5545 ICS files. It handles line folding (75-octet rule), escaping of special characters, UTC timestamps, and VTIMEZONE components. No external dependency.

```ts
export function generateIcs(event: IcsEvent): string;

interface IcsEvent {
  uid: string;
  summary: string;        // neutral, e.g. "NestSelf session"
  description: string;    // authenticated join link
  dtstart: Date;
  dtend: Date;
  timeZone: string;
  classification: 'PRIVATE';
  busyStatus: 'BUSY';     // X-MICROSOFT-CDO-BUSYSTATUS
}
```

**CW-R-44**: the ICS `SUMMARY` is neutral ("NestSelf session" or "NestSelf webinar"), `CLASS:PRIVATE`, and `X-MICROSOFT-CDO-BUSYSTATUS:BUSY` [D-CW-26, UX-24, UX-32].

**CW-R-45**: the ICS generator has unit tests covering folding at 75 octets, multi-byte character handling, timezone conversion and escaping of commas, semicolons and backslashes.

### 10.3 Reminder scheduling

Reminders are scheduled as BullMQ delayed jobs at appointment creation (two jobs: 24 hours and 1 hour before start) and at webinar registration (same offsets). If the appointment or webinar is canceled, the reminder jobs are removed from the queue [D-CW-26].

**CW-R-46**: reminder offsets are imported from `REMINDER_OFFSETS_MINUTES` in `@nestself/contracts`, not hard-coded in the job scheduler.

### 10.4 In-app notifications

When a reminder fires and the user has an active WebSocket connection, a toast notification is pushed through the user's socket. The workspace and admin apps show the toast using `useToast` from `@nestself/ui`. **CW-R-47**: the toast uses the `dialog` motion preset with `standard` duration (200 ms) [CLAUDE.md Motion rule].

---

## 11. Client package (`@nestself/video`)

`packages/video` is a workspace package that exports TypeScript source directly (no `dist` step, per the JIT convention in CLAUDE.md). It depends on `amazon-chime-sdk-js` (pinned to `3.32.0`) and `@nestself/ui` for primitives and motion [D-CW-20].

### 11.1 CallSessionController

A framework-agnostic controller (plain TypeScript class, not a React hook) that wraps the Chime SDK's `MeetingSession`. It manages:

- Device enumeration, selection and permission requests.
- Meeting session creation from the credentials returned by the join endpoint.
- Audio and video observer registration (`AudioVideoObserver`).
- Reconnection (the SDK's built-in 2-minute retry, with a `connectionState` observable).
- Metrics collection: `getStats()` every 30 seconds, aggregated into the shape `POST /calls/:sessionId/client-events` expects [D-CW-13].
- Degraded-mode logic: when outgoing bitrate drops below the threshold, lower resolution first, then pause outgoing video with a banner; resume when quality recovers (UX-12, UX-38).

**CW-R-48**: the controller never calls the Chime SDK's event ingestion endpoint (`EventIngestionUrl`). All client telemetry goes only to the NestSelf API [D-CW-13].

### 11.2 React hooks

| Hook | Purpose |
| --- | --- |
| `useCallSession` | Manages the `CallSessionController` lifecycle, exposes `join`, `leave`, `endForEveryone`, connection state, session timer |
| `useDevices` | Camera, microphone, speaker enumeration and selection; permission state |
| `useConnectionQuality` | RTT, jitter, packet loss, bitrate; three-state badge (good, fair, poor) |
| `useVideoTiles` | Active video tiles, bind/unbind to DOM elements |
| `useWebinarStage` | Presenters, attendees with the floor, hand-raise state, chat, polls |

**CW-R-49**: hooks import `m`, `AnimatePresence`, `MotionFeatures` and `useMotionPreset` from `@nestself/ui`, never from `motion/*` or `framer-motion` [CLAUDE.md Motion rule].

### 11.3 Components

`PreJoinCheck`, `CallStage`, `ControlBar`, `ConnectionBadge`, `SessionTimer`, `FollowUpCard`, `WebinarStage`, `ChatPanel`, `PollPanel`, `ModeratorQueue`, `HandRaiseButton`, `CrisisBlock` [D-CW-20].

`FollowUpCard` appears on the post-call screens for both the expert and the employee [D-CW-37]:
- Expert variant: shows the outcome capture and, once the outcome is `completed`, a "Propose a follow-up" form (date, time in the appointment's time zone, duration defaulting to the current session's duration). States: idle, proposed (waiting for employee), confirmed, declined.
- Employee variant: shows the feedback prompt and, when a proposal arrives, a card with "Confirm" and "Suggest another time" (up to three time windows). If the organisation requires approval, the confirmed state shows "Awaiting approval" until the approver decides. States: no proposal, proposed, awaiting approval, confirmed, declined.

`ChatPanel` replaces the earlier `QaPanel` concept [D-CW-35]:
- Attendee view: a compose field to write to hosts (text up to 1000 characters, `showFirstName` toggle, `kind` selector for message or question), and a feed of published messages and answers. Pending and dismissed messages are not visible.
- Host view: all messages (pending, published, answered, dismissed) with publish, answer and dismiss actions. Answered messages show the answer text inline.

**CW-R-124**: the attendee client has no camera control. The `ControlBar` for webinar attendees omits the camera button and the camera device selector. The `PreJoinCheck` for webinar attendees skips the camera preview and the "join with camera off" toggle [D-CW-35].

**CW-R-125**: the floor dialog shown to an attendee given the floor reads: "You can speak now. Unmute to talk. Your voice is part of the recording." The attendee must acknowledge the dialog before the unmute control is enabled. The dialog follows the Motion rule (the `dialog` preset) [D-CW-15, D-CW-35].

**CW-R-126**: the lobby and registration copy for webinars states that the webinar is recorded and that only the presenters are on the recording. The sentence "your camera stays off; you can write to the hosts and raise your hand to ask for the floor" is shown in the lobby [D-CW-34, D-CW-35].

**CW-R-50**: every component uses semantic colour tokens only (`bg-primary`, `text-text-secondary` and the other tokens). No hex literals [CLAUDE.md colour rule].

**CW-R-51**: every panel, sheet, banner and disclosure in the client package follows the Motion rule. Panels that appear and disappear use `AnimatePresence` with a motion preset; controls that change state use CSS transitions on the tokens. Reduced motion switches to an opacity fade of at most 50 ms [CLAUDE.md Motion rule].

**CW-R-52**: the `CrisisBlock` component is the same one the wellbeing check-ins use. It shows Serbian hotlines only (Hungarian hotlines are added only with a Hungarian launch, D-CW-38), the platform disclaimer, and for the expert the emergency guidance. It is reachable in one tap at all times during a call [D-CW-22, D-CW-38, UX-17].

**CW-R-53**: at 390 px viewport width, the remote video fills the screen, the self-view floats, the control bar has 44 px tap targets and secondary controls collapse into an overflow menu [D-CW-22, UX-20].

**CW-R-54**: all controls are keyboard-operable with visible focus. State changes (mute, camera, connection) are announced through the existing `LiveRegion` [D-CW-22, UX-19].

### 11.4 Content security policy

The client needs `*.sdkassets.chime.aws` in `script-src` and `connect-src`, and `*.chime.aws` in `connect-src`, for background blur, Voice Focus and the media session [D-CW-20, CORE-30]. The two places where response headers are set are: the Vite preview server configuration (for local development) and the CloudFront response-headers policy in `infra/cdk/lib/edge-stack.ts` (`securityHeadersBehavior` block) for deployed environments. Both must include the new CSP origins. **CW-R-55**: the CSP additions are configured in the Vite preview headers and in the CloudFront response-headers policy in `edge-stack.ts`, and documented in the client-company network note and the support runbook.

### 11.5 Pre-join flow

The `PreJoinCheck` component is mandatory before any join [D-CW-21]. It runs the Chime SDK's `MeetingReadinessChecker` (OPS-30) and renders:

1. Camera preview (self-view) with permission state and browser-specific help if blocked.
2. Microphone level meter with permission state.
3. Speaker test (plays a short tone, asks the user to confirm they heard it).
4. Network check: the readiness checker probes the Chime meeting endpoint; the result is shown as "connection: good / fair / poor".
5. Device selection dropdowns for camera, microphone and speaker.
6. "Join with camera off" toggle. After the pre-join preview, camera and microphone are on by default for consultation and workshop participants of every role; the employee's "join with camera off" choice is remembered per device; webinar attendees have no camera or microphone by construction [D-CW-21].
7. Background blur toggle (opt-in, the state is persisted per device in `localStorage` with a `try/catch` wrapper).

For consultations, the waiting state after the pre-join shows the expert's first name, photo (from the expert profile, not from the provider), credentials, the appointment time, session tips, and the "running late" message if the expert sent one through `POST /appointments/:id/signal` [D-CW-21, UX-05 to UX-07]. For webinars, the lobby shows the title, presenter names, start time, a countdown, the sentence "this webinar is recorded; only the presenters are on the recording" and the sentence "your camera stays off; you can write to the hosts and raise your hand to ask for the floor" [D-CW-21, D-CW-34, D-CW-35, UX-28].

**CW-R-55a**: the pre-join check completes before the `join` endpoint is called. The join button is disabled until the readiness check has completed [D-CW-21].

**CW-R-55b**: background blur requires `*.sdkassets.chime.aws` for the WASM module. If the CSP blocks it, background blur is silently unavailable and the toggle is hidden; the component does not fail [CORE-30] (guideline choice).

### 11.6 Connection quality and degraded mode

`useConnectionQuality` exposes three states based on the 30-second `getStats()` aggregate:

| State | Criteria | UI |
| --- | --- | --- |
| Good | RTT under 150 ms, jitter under 30 ms, packet loss under 1% | green badge |
| Fair | RTT 150 to 300 ms, or jitter 30 to 60 ms, or packet loss 1% to 2% | yellow badge |
| Poor | RTT above 300 ms, or jitter above 60 ms, or packet loss above 2% | red badge, degraded mode triggers |

Degraded mode first lowers outgoing resolution to 360p. If metrics remain poor for two consecutive intervals (60 seconds), outgoing video is paused and a banner reads "Your video is paused due to connection quality. Audio continues." (translated). Recovery: when metrics return to "fair" or better for 10 seconds, outgoing video resumes automatically. The banner disappears with an exit animation [D-CW-22, UX-12, UX-38, UX-36, UX-39]. **CW-R-55c**: degraded-mode thresholds use the values from UX research (UX-36): RTT above 300 ms, jitter above 60 ms, packet loss above 2%. They are defined as constants in `packages/video/src/quality-thresholds.ts`, not inlined (guideline choice).

### 11.7 Reconnection

The Chime SDK's built-in reconnection retries for up to 2 minutes (the default timeout, CORE-17). During reconnection, the client shows "Connection lost, reconnecting..." with a spinner. If reconnection fails, the client offers a "Rejoin" button that calls the join endpoint again (the cached credentials in Redis are still valid within the window) [D-CW-08, UX-13, UX-34]. **CW-R-55d**: the reconnection banner appears in under 500 ms of the connection drop and disappears with a fade animation when the connection restores.

---

## 12. App integration

### 12.1 Workspace app

New routes (TanStack Router, file-based):

| Route file | Layout | Purpose |
| --- | --- | --- |
| `_authenticated/appointments/index.tsx` | `_authenticated` | Appointment list (replaces the stub) |
| `_authenticated/appointments/$appointmentId.tsx` | `_authenticated` | Appointment detail, pre-join, waiting room |
| `call/$appointmentId.tsx` | root (outside `_authenticated`) | Ticket-based call route for mobile in-app browser |
| `_authenticated/webinars/index.tsx` | `_authenticated` | Webinar listing (eligible occurrences) |
| `_authenticated/webinars/$webinarId.tsx` | `_authenticated` | Webinar detail, registration, lobby |
| `_authenticated/webinars/$webinarId.live.tsx` | `_authenticated` | Webinar live view (attendee) |

**CW-R-56**: in sample mode (`VITE_DATA_SOURCE=sample`), appointment and webinar routes render `SAMPLE_APPOINTMENTS`, `SAMPLE_WEBINARS` and related fixtures from `@nestself/sample-data` and do not call the API. The `SampleDataBanner` is visible [CLAUDE.md sample-data rule].

**CW-R-57**: the appointment list, webinar list and detail pages show a `StatusBlock` for empty states, error states and permission-denied states. Every API call failure puts a readable, translated message on screen [CLAUDE.md error-visibility rule].

**CW-R-57a**: sample data fixtures are defined in `packages/sample-data/src/fixtures/`: `SAMPLE_APPOINTMENTS` (five appointments: one upcoming confirmed, one completed with an outcome, one canceled, one `proposed` follow-up and one `awaiting_approval` follow-up), `SAMPLE_CALL_SESSIONS` (two sessions: one active with two participants, one ended), `SAMPLE_WEBINARS` (two webinars: one published future occurrence with registrations, one ended with a recording), `SAMPLE_WEBINAR_MESSAGES` (four messages in various statuses: one host message, one published attendee message, one pending question, one answered question), `SAMPLE_WEBINAR_POLLS` (one open poll with aggregate results). Each fixture carries `sample: true` and uses `SAMPLE_` prefix. The API seed inserts the same fixtures. `assertNotProduction()` prevents the seed from running in production [D-CW-25, CLAUDE.md sample-data rule].

### 12.2 Admin app

New routes under `_authenticated/`:

| Route file | Gate | Purpose |
| --- | --- | --- |
| `consultations/index.tsx` | `can(principal, 'delivery.record')` | Expert's consultation list |
| `consultations/$appointmentId.tsx` | participant check | Expert's appointment detail, pre-join and post-call (outcome, follow-up proposal) |
| `webinars/index.tsx` | `can(principal, 'event.manage')` | Webinar management list |
| `webinars/$webinarId.tsx` | `can(principal, 'event.manage')` | Occurrence editor |
| `webinars/$webinarId.live.tsx` | `can(principal, 'event.moderate')` | Moderator live view |

**CW-R-58**: every new route's `beforeLoad` checks the role from router context using `can(principal, action)` from `@nestself/contracts`. A failed check redirects, not 403 [survey section 5, gating pattern].

### 12.3 API client

`packages/api-client/src/calls.ts` and `packages/api-client/src/webinars.ts` export typed API wrapper classes following the `AuthApi` pattern. Each method calls `client.request(path, { method, schema, body })` with the corresponding Zod response schema from `@nestself/contracts`.

`packages/api-client/src/queries/calls.ts` and `queries/webinars.ts` export TanStack Query `queryOptions` and `mutationOptions` for each endpoint.

**CW-R-59**: the `join` mutation's `onSuccess` does not cache the credentials. The join token is used once to initialise the `CallSessionController` and is not stored in React Query's cache, React state or `localStorage` [D-CW-08].

### 12.4 Error mapping

`apps/workspace/src/calls/map-call-error.ts` and `apps/admin/src/calls/map-call-error.ts` map `CallErrorCode` values to translated messages using `TFunction` from `i18next`, following the pattern in `apps/workspace/src/auth/map-auth-error.ts`.

**CW-R-60**: every error code in `CALL_ERROR_CODES` has a mapping. Unknown codes fall back to `errors.unknown` [CLAUDE.md error-visibility rule].

**CW-R-61**: error messages are translated in all four locales. Raw API `message` strings are never shown to the user [CLAUDE.md error-visibility rule].

---

## 13. Mobile ticket route

The mobile employee app joins consultations through a dedicated web route, not a native Chime SDK module [D-CW-24]. The flow:

1. The mobile app calls `POST /appointments/:id/call-ticket` (bearer token) and receives a 30-second, single-use ticket (same `KeyValueStore` + `getDel` pattern as `POST /auth/ws-ticket`).
2. The app opens `{WORKSPACE_URL}/call/{appointmentId}?ticket={ticket}` in an in-app browser (`react-native-webview` with WKWebView on iOS, Chromium WebView on Android).
3. The web route calls `POST /appointments/:id/join` with the ticket in the request body. The server validates the ticket via `KeyValueStore.getDel('call_ticket:{hash}')`, which atomically reads and deletes.
4. The web route receives meeting credentials and initialises `CallSessionController`.

**CW-R-62**: the ticket is stored under `call_ticket:{sha256(ticket)}` with TTL `CALL_TICKET_TTL_SECONDS` (30 seconds). The raw ticket is a `crypto.randomBytes(32).toString('base64url')` value. The hash prevents timing attacks on the key store [D-CW-24].

**CW-R-63**: `POST /appointments/:id/call-ticket` is only available with bearer authentication (mobile). Cookie-mode callers use `POST /appointments/:id/join` directly [D-CW-24].

**CW-R-64**: the call route (`call/$appointmentId.tsx`) is outside the `_authenticated` layout; it authenticates via the ticket, not the session cookie [D-CW-24].

**CW-R-65**: SPIKE-CW-05 must pass (audio and video work in WKWebView and Android WebView) before M4 ships [D-CW-24].

---

## 14. Infrastructure (CDK)

### 14.1 Video stack

`infra/cdk/lib/video-stack.ts` defines `NestSelf-<stage>-Video`. It is instantiated in `bin/app.ts` for every stage, following the auth-stack pattern (the dev stage deploys it alone, without compute) [D-CW-31].

Resources:

1. **SQS queue** `chime-events`: server-side encryption with the platform KMS key, dead-letter queue after 5 receives, a resource policy allowing `meetings.chime.amazonaws.com` to send messages with `aws:SourceAccount` condition [D-CW-12, OPS-16].
2. **EventBridge rule**: `source: aws.chime`, `detail-type: Chime Meeting State Change`, target is the SQS queue. This is the backstop; direct SQS notification from `CreateMeeting` is the primary path [D-CW-12, OPS-09].
3. **S3 bucket** `recordings`: SSE-KMS on the platform key, block-public-access, bucket policy for `mediapipelines.chime.amazonaws.com` with `aws:SourceAccount` and `aws:SourceArn` conditions, lifecycle rule expiring the raw segments under `raw/` after 30 days. Layout: capture segments under `raw/{webinarId}/`, the concatenated MP4 under `final/{webinarId}/` (a lifecycle filter is a literal prefix, so the segments lead the key) [D-CW-18, WEB-27, T-CW-2.5].
4. **IAM managed policy** `VideoApiPolicy`: `chime:CreateMeeting`, `chime:CreateMeetingWithAttendees`, `chime:CreateAttendee`, `chime:UpdateAttendeeCapabilities`, `chime:DeleteAttendee`, `chime:DeleteMeeting`, `chime:GetMeeting` on `Resource: *` with a cdk-nag `AwsSolutions-IAM5` suppression (meeting actions carry no resource-level permissions, OPS-21, OPS-22) [D-CW-31].
5. **IAM managed policy** `VideoWorkerPolicy`: SQS receive and delete on the queue, media pipeline actions on `Resource: *` with cdk-nag suppression, S3 put, get and list on the recordings bucket [D-CW-31].

The compute stack attaches `VideoApiPolicy` to `apiTaskRole` and `VideoWorkerPolicy` to `workerTaskRole` when `videoEnabled` is true for the stage [D-CW-31].

**CW-R-66**: the `dev` stage deploys `NestSelf-dev-Video` alone (no compute stack), and `env-from-outputs.mjs` learns the new outputs: `ChimeEventsQueueUrl`, `ChimeEventsQueueArn`, `RecordingsBucketName`, `VideoApiPolicyArn`, `VideoWorkerPolicyArn` [D-CW-31].

**CW-R-67**: the video stack has its own cdk-nag test (`infra/cdk/test/video-stack.test.ts`) that synthesizes the stack with `AwsSolutionsChecks` and asserts no unhandled violations [D-CW-31].

### 14.2 Env vars

New entries in `apps/api/src/config/env.ts`:

```ts
VIDEO_PROVIDER: z.enum(['none', 'chime']).default('none'),
CHIME_REGION: z.literal('eu-central-1').optional(),
CHIME_EVENTS_QUEUE_URL: optionalUrl,
CHIME_EVENTS_QUEUE_ARN: optionalString,
RECORDINGS_BUCKET: optionalString,
VIDEO_SMOKE_ENABLED: z.coerce.boolean().default(false),
```

`optionalUrl` and `optionalString` are Zod schema values (not factory functions) and are used without parentheses, matching the existing `env.ts` convention. `CHIME_REGION` uses `z.literal('eu-central-1').optional()` so that even outside the refinement only `eu-central-1` is accepted. `VIDEO_SMOKE_ENABLED` uses `z.coerce.boolean().default(false)`.

A `superRefine` block requires `CHIME_REGION`, `CHIME_EVENTS_QUEUE_URL`, `CHIME_EVENTS_QUEUE_ARN` and `RECORDINGS_BUCKET` when `VIDEO_PROVIDER` is `'chime'`, following the same pattern as the existing Cognito refinement [D-CW-06].

**CW-R-68**: `CHIME_REGION` must be `eu-central-1` and nothing else. The Zod schema uses `z.literal('eu-central-1')`, not `z.string()` [D-CW-06].

---

## 15. Security checklist

This section enumerates security constraints that apply across the epic. Each is tested by at least one unit test, one E2E golden case, or both.

**CW-R-69**: join tokens never appear in PostgreSQL, application logs, audit events, error details, HTTP response bodies (other than the join response itself) or client-side storage. The audit writer's `FORBIDDEN_KEYS` set already blocks `token`, `tokens`, `accessToken`, `idToken`, `refreshToken` and `secret`; this epic adds `joinToken` and `JoinToken` to the set so that the recursive sanitiser catches the Chime SDK's field name regardless of casing [D-CW-08].

**CW-R-70**: the join response HTTP header includes `Cache-Control: no-store` [D-CW-08].

**CW-R-71**: `ExternalUserId` is the `call_participants.id` (a per-session random id), never the user id, name or email. A test asserts that the value passed to `CreateAttendee` matches the participant row's id and does not match the user row's id [D-CW-11].

**CW-R-72**: employer-scoped principals (organisation owner, HR admin, team manager, reporting user) receive 404 on every route in this epic that returns participant, registration, question-author or feedback data. The default-deny test and authorisation golden cases prove this [D-CW-30].

**CW-R-73**: the diagnostic DTO (`GET /ops/calls/:sessionId/diagnostics`) exposes exactly the 4.7.5 field set. A serialisation test compares the DTO keys against a frozen allowlist [D-CW-28].

**CW-R-74**: webinar registration capacity is enforced with `SELECT ... FOR UPDATE` to prevent race conditions [D-CW-17].

**CW-R-75**: webinar attendees have receive-only capabilities. The server, not the client, enforces this through `CreateAttendee` with `Capabilities.Audio = 'Receive'`, `Capabilities.Video = 'Receive'`, `Capabilities.Content = 'Receive'` [D-CW-15, WEB-01].

**CW-R-76**: attendee names are never sent to other attendees. The roster, counts and names come from the NestSelf database; `ListAttendees` is never called from the client [D-CW-15].

**CW-R-77**: an attendee given the floor confirms in a dialog that their audio will be enabled and their voice is part of the recording. The server calls `UpdateAttendeeCapabilities` only after the attendee acknowledges; video stays at `Receive` [D-CW-15, D-CW-35].

**CW-R-78**: the recording indicator ("REC") is shown to all participants when recording is active. The registration page, confirmation email and lobby state that the webinar is recorded and that only the presenters are on the recording [D-CW-18, D-CW-34, UX-45, F8 step 3].

**CW-R-79**: the recordings S3 bucket has block-public-access, SSE-KMS and a bucket policy scoped to `mediapipelines.chime.amazonaws.com` with `aws:SourceAccount` and `aws:SourceArn` conditions [D-CW-18, WEB-27].

**CW-R-79a**: consultations and workshops are never recorded in this epic. No media-pipeline IAM permission is granted to the API task role; only the worker role carries media-pipeline permissions, and only for webinars. `POST /appointments/:id/recording/*` does not exist [D-CW-19].

**CW-R-79b**: the `call_consents` table schema is defined but no production code path writes to it. The table has columns for `sessionId`, `participantId`, `consentType` (enum: `recording`, `transcription`), `givenAt`, `revokedAt` and is ready for a future epic that enables consultation recording after the founder's F-CW-01 decision and the DPIA [D-CW-19, LAW-12, LAW-28, LAW-29].

**CW-R-127**: the approval item for follow-up sessions carries no service category (LAW-14). The approver sees only the employee's display name, the fixed label key `approval.follow_up_label`, the date and the duration. This is enforced by the serialisation allowlist and proven by a unit test [D-CW-37].

**CW-R-128**: when an attendee is given the floor, the `webinar.floor.given` audit event carries `{ participantId, recordingNoticeShown: true }` to prove that the recording consent dialog was displayed before the attendee's audio was enabled. The Serbian legal basis for this processing is documented in the data inventory (Art. 143 of the Serbian Criminal Code: explicit consent for anyone whose voice is captured) [D-CW-34, D-CW-38, LAW-10].

**CW-R-129**: the data inventory for the DPIA lists the Serbian ZZPL (Art. 54) and GDPR (Art. 35) legal bases. The launch jurisdiction is Serbia only. Hungarian items from the research (LAW-19 to LAW-25) are kept as notes for a later Hungarian launch and are not development tasks [D-CW-38].

**CW-R-79c**: webinar recording uses `SelectedVideoStreams` set to the presenter participants' attendee ids and `CompositedVideo` layout `PresenterOnly` at HD. Attendees are receive-only, so no attendee video can appear in the capture. An attendee given the floor has audio `SendReceive` only; their voice may be captured. The floor dialog warns the attendee that their voice is part of the recording before they unmute [D-CW-18, D-CW-35, WEB-23 to WEB-26].

**CW-R-79d**: when the recording stops (the moderator's early stop or the end of the webinar), the `webinar.recording.finalize` job deletes the capture pipeline and runs a concatenation pipeline from it: the segments under `raw/{webinarId}/` become a single MP4 under `final/{webinarId}/`, and `webinar_recordings.status` moves to `ready` [D-CW-18, WEB-29]. The raw segments expire after 30 days via the bucket's `raw/` lifecycle rule.

**CW-R-79e**: the CMS handoff creates a draft content item through the CMS media module interface (NS-CONTENT-01). Until that interface exists, the handoff writes the S3 key and metadata to `webinar_recordings` with `handoff_status = 'pending'` [D-CW-03].

---

## 16. Observability and runbook pointers

### 16.1 Structured logging

Every Chime SDK call is logged at `info` level on success and `error` on failure. Log entries include the `sessionId`, `participantId` (never the user id), the SDK method name and the latency. Join tokens and attendee credentials are never logged [D-CW-08].

### 16.2 Metrics and alarms

| Metric | Source | Alarm threshold |
| --- | --- | --- |
| Join failure rate | `call_client_events` where `meetingStartFailed` | above 5% over 15 minutes [D-CW-13, OPS-44] |
| p95 `meetingStartDurationMs` | `call_client_events` where `meetingStartSucceeded` | above 5 seconds [D-CW-13] |
| `meetingFailed` burst | `call_client_events` | more than 3 in 5 minutes (planning assumption) |
| SQS DLQ depth | CloudWatch metric on the DLQ | above 0 [D-CW-12] |
| Active sessions exceeding `endsAt + 20 min` | `calls.reconcile` output | any (the reconcile job handles it, but the alarm flags persistent failures) |

**CW-R-80**: client events go to `POST /calls/:sessionId/client-events` and are stored in `call_client_events` with 90-day retention. They carry metrics, device error names, browser and OS only; never device labels, names or content [D-CW-13, D-CW-29].

### 16.3 Retention defaults

Retention defaults are seeded in the retention configuration, not enforced by code in this epic. The values are subject to change after the DPIA and the founder's L-02 and L-03 answers [D-CW-29, F-CW-09]:

| Data | Retention | Category |
| --- | --- | --- |
| Appointment and session metadata, participants, outcomes, provider events | 7 years | FINANCIAL |
| Appointment approvals | 7 years (with the appointment) | FINANCIAL |
| Client diagnostics (`call_client_events`) | 90 days | ADMIN |
| Webinar messages | 12 months after the occurrence, then author links removed | CONTENT_ACCESS |
| Feedback | 24 months | ADMIN |
| Workshop chat messages | 24 hours after the session | ADMIN |
| Raw recording segments in S3 | 30 days (bucket lifecycle) | CONTENT_ACCESS |
| Concatenated replays | CMS content lifecycle | CONTENT_ACCESS |
| Ephemeral location text (F-CW-04) | Deleted when the session ends | SECURITY |

**CW-R-80a**: the optional location prompt at the start of psychological consultations (F-CW-04, story CALL-34) stores the employee's free-text location in the `call_sessions` row (a nullable `location_text` column) and deletes it when the session ends. The value is visible only to the assigned expert and is never stored in audit events or logs [D-CW-29, F-CW-04].

The retention seed values defined above are defaults. A test asserts that the seed exists and covers every table this epic adds. The actual retention enforcement (archival, deletion) is implemented as a maintenance job with a cron schedule; the job reads the retention configuration and deletes or anonymises rows past their retention period (guideline choice).

### 16.3 Runbook pointers

The support runbook (outside this document) covers:

- Participant cannot join: check `call_sessions.status`, `call_events` for `AttendeeJoined`/`AttendeeDropped`, client events for `meetingStartFailed`.
- Audio one-way: check `call_client_events` for packet loss, jitter, RTT thresholds (UX-36: RTT above 300 ms problematic, jitter above 30 ms degraded, packet loss above 2% audible).
- Recording missing: check `webinar_recordings.status`, the worker logs for the concatenation pipeline, the S3 bucket for raw segments.
- DLQ non-empty: re-drive messages after inspecting the dead-letter content for malformed events.

---

## 17. Testing strategy

### 17.1 Unit tests

Unit tests are colocated next to the source file as `*.test.ts` or `*.test.tsx`, run by Vitest.

**CW-R-81**: the `ChimeVideoProvider` adapter has unit tests using `aws-sdk-client-mock` for every SDK method: `CreateMeetingWithAttendees`, `CreateAttendee`, `UpdateAttendeeCapabilities`, `DeleteAttendee`, `DeleteMeeting`, `GetMeeting`, `CreateMediaCapturePipeline`, `DeleteMediaCapturePipeline`. Each test verifies the request shape and the error-mapping branch [D-CW-32, D-CW-33].

**CW-R-82**: the join service has tests for: non-participant returns 404, outside-window returns 403 `join_window_closed`, canceled appointment returns 409 `appointment_not_joinable`, rejoin returns identical cached credentials, concurrent first join creates exactly one meeting (two concurrent calls, one lock winner, one loser that waits), employer-scoped principal returns 404 on every route [D-CW-33].

**CW-R-130**: follow-up and approval golden cases:
- Expert proposes a follow-up before the outcome is `COMPLETED`: 409 `follow_up_not_allowed`.
- Employee confirms a non-proposed appointment: 409 `appointment_not_proposed`.
- Self-approval denied: the approver is the same user as the employee and `selfApprovalAllowed` is `false` on the organisation.
- Approver outside the employee's unit: 404 (the approval authority does not cover the unit).
- Organisation with `AUTOMATIC` policy: confirmation creates no approval item; the appointment goes directly to `confirmed`.
- Employer-scoped principal: 404 on follow-up proposal, confirmation, decline and approval routes.
- Approver missing: no matching approval authority returns 409 `approver_missing` and audits `appointment.approval.missing_approver`.

**CW-R-131**: chat golden cases:
- Attendee cannot read pending messages: `GET /webinars/:id/messages` for an attendee returns only `PUBLISHED` and `ANSWERED` messages.
- Host publish fans out: publishing a pending message emits `webinar.message.published` to the `webinar:{webinarId}` room.
- Anonymous by default: published messages omit the author's name unless `showFirstName` is `true`.

**CW-R-132**: floor golden cases:
- Video is never enabled for an attendee given the floor: a test asserts that `UpdateAttendeeCapabilities` sets `Audio: 'SendReceive'`, `Video: 'Receive'`, `Content: 'Receive'`.
- The adapter rejects any update where an attendee's video is `SendReceive`.

**CW-R-133**: recording golden cases:
- `webinar.recording.start` is enqueued when the moderator starts the webinar.
- `webinar.recording.stop` is called when the moderator ends the webinar.
- Early stop (`POST /webinars/:id/recording/stop`) is allowed for the moderator only; a presenter gets 404.
- The recording status transitions through `SCHEDULED -> RECORDING -> PROCESSING -> READY -> HANDED_OFF`.

**CW-R-83**: the event consumption handler has tests for: duplicate events are dropped (same composite key), out-of-order `AttendeeJoined` and `AttendeeLeft` produce correct timestamps, `MeetingEnded` transitions the session to `ended` exactly once [D-CW-12, D-CW-33].

**CW-R-84**: the ICS generator has tests covering line folding at 75 octets, multi-byte characters (Serbian Cyrillic, Hungarian accented), timezone conversion and escaping [D-CW-26].

**CW-R-85**: every Zod schema in `packages/contracts` that this epic adds has a colocated contract test asserting parse success on valid input and parse failure with the correct error path on invalid input [D-CW-33].

**CW-R-86**: the diagnostic DTO serialisation test asserts the response keys match a frozen allowlist: `sessionId`, `appointmentId`, `webinarId`, `startedAt`, `endedAt`, `status`, `provider`, `providerMeetingId`, `participants` (array of `{ role, joinedAt, leftAt, reconnectCount, qualityMetrics, errorCodes, browser, os }`). No other field is present [D-CW-28].

### 17.2 Supertest (API integration)

Supertest suites in `apps/api/test/` use `AUTH_MODE=stub`, `VIDEO_PROVIDER=none` and a per-suite test database. They cover every route's authorisation golden case and the default-deny assertion.

**CW-R-87**: the default-deny route test is extended to cover every new controller. A controller that appears without `@Public()`, `@Authenticated()` or `@Authorize()` on a route fails CI [D-CW-33].

### 17.3 Playwright (E2E)

Playwright journeys in `e2e/` run against `FakeVideoProvider` with Chromium fake media flags (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, OPS-32) [D-CW-33].

Journeys:

- Pre-join: device check completes, "join with camera off" works, permission help appears for blocked media.
- Consultation: expert and employee join, see each other's video tile, expert ends the session, the employee sees the "session ended" screen.
- Webinar attendee: register, join, see presenter video, submit a question, vote in a poll, leave.
- Moderator: start webinar, publish a message, answer a question, open and close a poll, give an attendee the floor (attendee acknowledges the recording dialog), stop recording, end webinar.

**CW-R-88**: every Playwright journey includes an assertion that the `SampleDataBanner` is not visible (the journey runs in API mode, not sample mode).

### 17.4 Motion suite

New entries in `e2e/motion/` for every component that appears, disappears or slides:

- `PreJoinCheck` panel entry and exit.
- `ControlBar` overflow menu open and close.
- `ChatPanel` sheet open and close.
- `PollPanel` sheet open and close.
- `ModeratorQueue` sheet open and close.
- `ConnectionBadge` tooltip open and close.
- `SessionTimer` "5 minutes remaining" banner entry and exit.
- Floor dialog open and close.
- `FollowUpCard` entry and exit.

**CW-R-89**: each motion test records frames, asserts token durations and easing, compositor-only properties (`opacity` and `transform`), in-between frames on entry and exit, no flicker, and the reduced-motion fade (opacity at most 50 ms, no translate or scale) [CLAUDE.md Motion rule, D-CW-33].

### 17.5 Nightly smoke test

A GitHub Actions workflow `video-smoke` runs nightly. It creates a real Chime meeting in the dev account from two Chromium contexts, verifies audio and video exchange, and tears down. It is gated on the `VIDEO_SMOKE_ENABLED` secret and is allowed to be skipped locally [D-CW-33, OPS-33].

**CW-R-90**: the smoke test is skipped (not failed) when `VIDEO_SMOKE_ENABLED` is false. It never runs in a PR check; it runs only on the nightly schedule.

### 17.6 Motion contract check

`pnpm check` runs `motion-contract.test.ts`, which parses `packages/ui/src`, `packages/video/src` and the web apps. It fails on an un-animated Base UI popup, portal, toast or collapsible panel; on literal timing in classes, inline styles or Motion props; and on imports from `motion/*` or `framer-motion` instead of `@nestself/ui` [CLAUDE.md Motion rule].

**CW-R-91**: the motion contract check's file scan list is extended to include `packages/video/src`.

---

## 18. Performance and accessibility budgets

### 18.1 Performance

| Metric | Budget | Measurement |
| --- | --- | --- |
| Time from "join" click to audio connected | under 4 seconds on a 50 Mbps connection (planning assumption) | `meetingStartDurationMs` in client events |
| Pre-join device check duration | under 3 seconds | `MeetingReadinessChecker` timing in client events |
| Client bundle size delta for `@nestself/video` | under 300 KB gzipped (the Chime SDK JS is the bulk) | build output analysis (guideline choice) |
| WebSocket message latency for chat and signals | under 200 ms p95 on a local network | E2E timing assertion (guideline choice) |

**CW-R-92**: degraded-mode thresholds follow the research: RTT above 300 ms triggers resolution reduction; packet loss above 2% triggers outgoing video pause; recovery resumes outgoing video after 10 seconds of stable quality (UX-36, UX-38, UX-39) (guideline choice).

### 18.2 Accessibility

**CW-R-93**: every interactive element in the call and webinar UI is keyboard-operable. Tab order follows visual order. Focus is trapped inside modal dialogs (promotion confirmation, end-session confirmation) [D-CW-22, UX-19].

**CW-R-94**: state changes (mute toggled, camera toggled, connection state changed, participant joined, participant left, recording started, recording stopped, session ending warning) are announced through the existing `LiveRegion` from `@nestself/ui` [D-CW-22, UX-19].

**CW-R-95**: the pre-join check, control bar and webinar stage pass `axe-core` checks at the AA level. The E2E accessibility suite (`pnpm e2e`, `a11y.spec.ts`) includes the new pages [D-CW-33].

**CW-R-96**: at 400% zoom (reflow test), no horizontal scroll appears and all controls remain usable. The E2E reflow suite (`reflow.spec.ts`) includes the new pages [D-CW-33].

### 18.3 Connection quality thresholds

The connection quality badge and degraded mode use the thresholds from UX research (UX-36, UX-39):

| Metric | Excellent | Acceptable | Problematic |
| --- | --- | --- | --- |
| Round-trip time | under 150 ms | 150 to 300 ms | above 300 ms |
| Jitter | under 30 ms | 30 to 60 ms | above 60 ms |
| Packet loss | under 1% | 1% to 2% | above 2% (audible) |
| Available outgoing bitrate | above 1.5 Mbps | 0.5 to 1.5 Mbps | below 0.5 Mbps |

**CW-R-97**: the thresholds are defined once in `packages/video/src/quality-thresholds.ts` and imported by both the `useConnectionQuality` hook and the `CallSessionController`'s degraded-mode logic. Changing a threshold in one place changes it everywhere (guideline choice).

### 18.4 Bundle and loading

**CW-R-98**: `amazon-chime-sdk-js` is loaded only on call and webinar routes, not in the main bundle of the workspace or admin app. Each call and webinar route file uses TanStack Router's lazy-route pattern (the route module exports `createLazyFileRoute` and the component is dynamically imported) so that the Chime SDK JS (approximately 200 KB gzipped) lands in its own chunk and does not affect the initial page load. The Storybook story files for the video components are `PreJoinCheck.stories.tsx`, `CallStage.stories.tsx`, `ControlBar.stories.tsx`, `ConnectionBadge.stories.tsx`, `SessionTimer.stories.tsx`, `FollowUpCard.stories.tsx`, `WebinarStage.stories.tsx`, `ChatPanel.stories.tsx`, `PollPanel.stories.tsx`, `ModeratorQueue.stories.tsx`, `HandRaiseButton.stories.tsx` and `CrisisBlock.stories.tsx`, colocated with the component files in `packages/video/src/components/`.

**CW-R-99**: background blur and Voice Focus WASM modules are loaded on demand when the user enables the feature, not at pre-join mount. A loading indicator is shown while the WASM downloads [CORE-30] (guideline choice).

---

## 19. Things not to do, and glossary

### Things not to do

1. Do not import from `@aws-sdk/client-chime` (the legacy namespace). Use only `@aws-sdk/client-chime-sdk-meetings` and `@aws-sdk/client-chime-sdk-media-pipelines` [D-CW-05, CORE-37].
2. Do not import `motion`, `framer-motion` or any motion library directly in components. Use `m`, `AnimatePresence`, `MotionFeatures` and `useMotionPreset` from `@nestself/ui` [CLAUDE.md Motion rule].
3. Do not use hex colour literals outside `packages/tokens/tokens.css` and `packages/tokens/tokens.json`. Use semantic tokens [CLAUDE.md colour rule].
4. Do not hard-code durations, delays or easings in components. Use motion presets and CSS token variables [CLAUDE.md Motion rule].
5. Do not write join tokens, meeting credentials or personal data to audit event details [D-CW-08].
6. Do not call `ListAttendees` from the client. Roster data comes from the NestSelf database [D-CW-15].
7. Do not request `FHD` for the `Video` feature in `MeetingFeaturesConfiguration`. It caps meetings at 25 attendees [CORE-06].
8. Do not run `pnpm install`, `pnpm add`, `npx` or similar commands during parallel work. List missing dependencies for a single install step [CLAUDE.md no-installs rule].
9. Do not create a second Cognito pool or a second Chime meeting region. The dev pool and the eu-central-1 region already exist [CLAUDE.md AWS and CDK rules].
10. Do not use `amazon-chime-sdk-component-library-react`. It ships styled-components and its own theme, incompatible with the colour and motion rules [D-CW-20, CORE-22].
11. Do not expose any endpoint that returns participant lists, registration lists, message authors or feedback to employer-scoped principals [D-CW-30].
12. Do not use Chime data messages for chat, polls or hand-raise. Use Socket.IO rooms and PostgreSQL [D-CW-16].
13. Do not claim "end-to-end encrypted" in any product copy. The correct statement is "encrypted in transit and at rest" [D-CW-06, LAW-07].
14. Do not use `StartMeetingTranscription` for live captions. Serbian and Hungarian are not supported [D-CW-23, WEB-31].
15. Do not store individual poll votes with the voter id. Store aggregate counts per option [D-CW-16, WEB-35].
16. Do not edit `sr-Cyrl` JSON files by hand. They are generated from Latin by transliteration [CLAUDE.md Cyrillic rule].
17. Do not add a free-text "notes" field to `call_outcomes`. Professional notes are forbidden by D-22 [D-CW-25].
18. Do not toggle visibility of a panel, sheet or banner using `display` alone. Every appearance and disappearance is animated [CLAUDE.md Motion rule].
19. Do not enable attendee video send capability in webinars. The adapter must reject any `UpdateAttendeeCapabilities` where an attendee's video is `SendReceive` [D-CW-35].
20. Do not add a `recordingPolicy` column to the `webinars` table. Every webinar is recorded by construction; there is no per-occurrence switch [D-CW-34].

### Glossary

| Term | Definition |
| --- | --- |
| Appointment | A confirmed time slot for a consultation or workshop between an expert and one or more employees, owned by this epic's minimal spine [D-CW-02] |
| Call session | The real-time video/audio session backed by a Chime SDK meeting, linked to an appointment or webinar |
| Consultation | A private 1:1 session between an expert and an employee [D-CW-01] |
| Workshop | A small group session (up to 25 participants) where everyone is on video [D-CW-01] |
| Webinar | A one-to-many presentation (up to 250 attendees in the first version) where attendees are receive-only [D-CW-01, D-CW-14] |
| Occurrence | A single scheduled instance of a webinar (the `webinars` row) |
| Participant | A `call_participants` row linking a user to a session with a role |
| Provider | The `VideoProvider` abstraction; either `ChimeVideoProvider` (production) or `FakeVideoProvider` (development, tests) [D-CW-05] |
| Join token | The Chime SDK credential returned by `CreateAttendee`, valid for the lifetime of the meeting, never persisted to PostgreSQL [D-CW-08, CORE-17] |
| Call ticket | A 30-second, single-use bearer-to-web bridge token for mobile in-app browser join [D-CW-24] |
| The floor | Giving a webinar attendee audio send capability so they can speak; video stays receive-only. The host gives the floor, the attendee acknowledges the recording notice and unmutes, and the host can take the floor back at any time [D-CW-15, D-CW-35] |
| Host | A presenter or moderator of a webinar; hosts have full send capabilities and can publish attendee messages, give the floor and manage polls [D-CW-35] |
| Proposal | An expert's suggestion of a follow-up appointment, made on the post-call screen after a completed consultation. The employee confirms, declines or suggests alternative times [D-CW-37] |
| Approval item | An `appointment_approvals` row routed to an approval authority holder when the organisation's follow-up policy requires manager approval. The approver sees only the employee name, a fixed label, the date and the duration [D-CW-37, LAW-14] |
| Degraded mode | Automatic quality reduction (lower resolution, then pause outgoing video) when network metrics drop below thresholds [D-CW-22, UX-38] |
| Media capture pipeline | A Chime SDK service that records presenter video and audio to S3 [D-CW-18] |
| Concatenation | Post-processing of raw recording segments into one MP4 [D-CW-18, WEB-29] |
| CMS handoff | Passing the finished recording MP4 to the CMS media module as a draft content item [D-CW-03] |
| Neutral notification | An email or in-app message that reveals no service category, expert name or clinical detail [D-CW-26] |
| Platform scope | An RLS scope where `org_id` is null, allowing cross-organisation access for NestSelf operations [D-CW-25] |
| Operations route | A route under `/ops/` accessible to NestSelf operations and support staff |
