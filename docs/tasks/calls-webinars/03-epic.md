# NS-CALLS-01: Consultations and webinars on Amazon Chime SDK

Epic charter v1.1, 24 October 2026. Revised with D-CW-34 to D-CW-38 and the founder's answers (F-CW-01 to F-CW-10). Binding decisions, scope and verification criteria for the story catalog (`04-user-stories.md`), task breakdown (`05-tasks.md`) and implementation guidelines (`06-implementation-guidelines.md`). Grounded in the decision record (`02-decisions.md`), five research documents (`research/01` to `research/06`) and the product flows (`sources/product-flows-and-user-stories-v0.1.md`).

## 1. The loop this epic closes

NestSelf delivers wellbeing support to employees through expert consultations, shared webinars and small group workshops. None of these can happen today: the code has actions (`consultation.join`, `event.register`, `event.present`, `delivery.record`) and permission templates, but no modules, no tables, no video provider and no real-time session infrastructure.

This epic closes two loops.

**Consultation loop.** An expert proposes or a coordinator books a confirmed appointment. The employee receives a neutral reminder. Both enter a pre-join screen that tests their devices and network. The first to join creates the private room. They meet on video with a crisis block one tap away, a connection badge, a session timer and quick signals when audio fails. The expert ends the session and both land on post-call screens: the expert records the outcome and, when it is `completed`, proposes a follow-up with a date, time and duration; the employee leaves optional private feedback and, when a proposal arrives, confirms it or suggests up to three time windows. If the organisation's `follow_up_approval_policy` is `manager_approval`, confirmation routes an approval item to the holder of an approval authority covering the employee's unit; the approval item carries the employee's name and the date but never the service category. If neither joins, a no-show follow-up runs within 48 hours. The employer never learns who attended.

**Webinar loop.** An operator publishes an occurrence. Eligible employees discover and register. Reminders arrive at 24 hours and 1 hour before. Attendees enter a lobby with a countdown, join as receive-only viewers (never with a camera), write to the hosts through the webinar chat, raise a hand and may be given the audio-only floor by a host, vote in polls, and leave at any time. Hosts post to everyone; attendee messages reach the audience only when a host publishes them, anonymous by default. The moderator manages the message queue, the floor and polls. Recording starts automatically when the moderator starts the webinar and stops when it ends; the worker concatenates the segments into one MP4 and hands it to the CMS epic for review and replay publication. Attendees who met the attendance threshold may request a certificate. The employer sees aggregate attendance at most.

A workshop loop is a variant: up to 25 participants on video with a facilitator, gallery view, a session chat retained for 24 hours, and the same outcome capture and feedback path as consultations.

## 2. What this epic delivers and what it does not

### Delivers

Three live session formats on a single Amazon Chime SDK adapter: private 1:1 consultations, webinars for up to 250 attendees in the first version, and workshops for up to 25 participants (D-CW-01). A minimal appointment spine with participants, schedule, status and transitions, scoped to what the call layer reads (D-CW-02). Post-call follow-up proposal, confirmation, suggested-time negotiation and manager-approval routing with `appointment_approvals` (D-CW-37). Webinar occurrences including registration, capacity enforcement, interaction (chat, polls, hand-raise and the audio-only floor), automatic presenter-only recording and the handoff of a finished MP4 to the CMS content pipeline (D-CW-03, D-CW-34, D-CW-35). A pre-join experience with device checks, network quality, self-view preview and a waiting room. In-call controls, degraded-mode handling, reconnection, a session timer, a crisis block, connection diagnostics and post-call outcome capture. Mobile join through the web client inside the Expo app. Neutral email reminders with ICS attachments, localised into all four locales. Client diagnostics for support without content access. Sample data, Playwright journeys and a nightly real-provider smoke test.

### Does not deliver

Phone dial-in and SMS. Professional notes of any kind. Insurer or employer settlement from delivery status. Employer reports beyond the guarantee that no employer-facing endpoint lists participants. Live captions in any language. Webinars above 1,000 attendees (the path is documented, not built). Native mobile Chime SDK modules. Chat as a messaging channel in consultations. Availability management, slot selection, direct booking, matching, funding reservation, insurer units, approvals, rescheduling fees and cancellation terms: these belong to `NS-BOOKING-01` (D-CW-04).

### Seams

**`NS-BOOKING-01` (future).** This epic owns the `Appointment` contract in `packages/contracts/src/appointments.ts`. The booking epic replaces the creation path (adding availability, slots, holds, funding) and keeps the spine. The fields the call layer reads are fixed: `id`, `orgId`, `expertUserId`, `employeeUserId`, `startsAt`, `endsAt`, `status`, `serviceCategory`, `timeZone`. The booking epic may add columns but must not change these (D-CW-02).

**`NS-CONTENT-01` (CMS).** A finished webinar replay is a content item. This epic writes the MP4 to the recordings bucket and creates a `webinar_recordings` row with `handoff_status = 'pending'`. The CMS media module picks it up for review, publication and protected delivery. Until that module exists, the handoff writes the object and the row; a one-line adapter is added when the interface lands (D-CW-03).

## 3. Who it serves and what each gains

**Employee.** Joins a private consultation from a phone or laptop. Sees the expert's name and credentials in the waiting room, not the other way around. On the post-call screen, leaves optional private feedback and, when a follow-up is proposed, confirms it, suggests up to three time windows, or declines (D-CW-37). Registers for webinars, attends anonymously, writes to the hosts through the chat, votes in polls, may request a certificate. Receives neutral reminders. Reports technical problems from the post-call screen. Sees a crisis block at all times during psychological sessions.

**Expert.** Enters the same private room, records the outcome (`completed`, `no_show_employee`, `technical_failure`, `canceled`), sends "running late" signals, ends the session for both parties. On the post-call screen, proposes a follow-up once the outcome is `completed` (D-CW-37). Does not write professional notes inside NestSelf. Presents webinars with a live attendance count, chat panel and timer.

**Approver.** A manager or alternate who holds an approval authority (`approval.decide`) covering the employee's organisational unit. Sees the employee's name, "follow-up session with a NestSelf expert", the date and the duration. Never sees the service category, the expert's specialty or any session content (D-CW-37). Approves or rejects within 5 working days; a reminder goes to the approver and the alternate if no decision is made.

**HR administrator.** Sets the organisation's `follow_up_approval_policy` (`automatic` or `manager_approval`) through the admin interface (`program.overview`). Reviews aggregate follow-up counts in the reporting epic, not here.

**Service coordinator.** Creates appointments on behalf of employees. Moderates webinars: manages the message queue, gives and takes the floor, controls polls. Holds `event.moderate`.

**Webinar presenter.** Delivers the live session. Sees attendance count and published messages. Does not see attendee names during the session (the moderator does).

**Moderator.** Manages the message queue (publish, answer, dismiss), hand-raise list, the floor and polls. Sees registered names for the floor and follow-up. The presenter sees "a participant asked to speak" (D-CW-15).

**NestSelf operations.** Creates and publishes webinar occurrences. Reviews attendance and diagnostics. Holds `event.manage` and `event.moderate`.

**Support operator.** Troubleshoots call failures using redacted diagnostics: session id, timing, status, per-participant role, quality metrics, browser, OS. Never sees call content (D-CW-28).

**Employer.** Gains nothing from this epic besides the guarantee that no route exposes a participant list, a registration list, a question author or a feedback row to an employer-scoped principal (D-CW-30). Aggregate counts with a k-anonymity threshold of 5 are produced by the reporting epic, not here.

## 4. Starting condition

### What the repository already has

The codebase provides the infrastructure this epic builds on.

**Authentication and authorization.** `AuthenticationGuard`, `AuthorizationGuard`, `@Authorize()`, the pure `authorize()` engine, grant templates and the default-deny CI test (`apps/api/src/auth/`, `apps/api/src/authz/`). The actions `consultation.join`, `delivery.record`, `appointment.propose`, `appointment.cancel`, `event.register`, `event.present`, `bookings.coordinate` and `support.troubleshoot` are already in `packages/contracts/src/actions.ts`. The `expert` template already holds `consultation.join`, `delivery.record` and `appointment.propose`; the `employee` template already holds `consultation.join`, `event.register` and `appointment.cancel`. The `expert` template gains `event.present` in this epic.

**Real-time infrastructure.** Socket.IO gateway with `subscribe`/`unsubscribe`, `SubscriptionAuthorizer`, `WsConnectionRegistry` and `WsInvalidationService` (`apps/api/src/ws/`). BullMQ job scheduler with `JobAuthorization` and a `nestself-maintenance` queue (`apps/api/src/jobs/`).

**Data layer.** Drizzle ORM with forced RLS, `DbService.withOrgScope`, `tenantPredicate`, `AuditWriter` with forbidden keys, `KeyValueStore` with NX+TTL locking (`apps/api/src/db/`, `apps/api/src/redis/`, `apps/api/src/audit/`).

**Design system.** `@nestself/ui` with Motion presets (`backdrop`, `dialog`, `popover`, `sheet-bottom`, `toast`, `disclosure`), `AnimatePresence`, `MotionFeatures`, `LiveRegion`, `FormErrorSummary`, `Alert`, `StatusBlock`, `TimeSlotGrid`, `CrisisBlock`, `Sheet`, `Dialog` and the token system. Reduced-motion support is built in.

**AWS SDK pattern.** `@aws-sdk/client-cognito-identity-provider` and `@aws-sdk/client-ses` at `3.1155.0` in the catalog, injected via constructors with abstract providers and SES implementation.

**CDK.** `infra/cdk/lib/` with `auth-stack.ts`, `compute-stack.ts`, `data-stack.ts`, `security-baseline-stack.ts` (platform KMS key), `env-from-outputs.mjs`. The `EcsTaskRoles` construct provides task and execution roles.

**Sample mode, i18n, e2e.** `@nestself/sample-data` with `SAMPLE_BOOKING` and `SAMPLE_EVENT_REQUEST`. Four locales in `packages/i18n/locales/` with Cyrillic generation. Playwright suites for accessibility, visual regression and motion.

### What is missing

No `appointments/`, `calls/`, `webinars/` or `video/` modules exist under `apps/api/src/`. No Drizzle tables for any of the 17 call-domain tables. No consultation or appointment Zod schemas in `packages/contracts/src/`. No `packages/video` client package. No Chime SDK dependencies in the catalog. No ICS generation code. No generic mailer module (only `InvitationMailer`, English-only inline templates). No EventBridge rules, SQS queues or media buckets in CDK. No `aws-sdk-client-mock` in the catalog. The `appointments.tsx` route in workspace is a stub with an empty `StatusBlock`. No feature-flag system exists.

## 5. Why Amazon Chime SDK and why eu-central-1

The auth strategy (D-22) chose Amazon Chime SDK for video, and the research confirmed end-to-end availability in Frankfurt. The alternative evaluation is settled and not re-litigated here. Two facts anchor the choice.

First, eu-central-1 is a Chime SDK control region, media region and media-pipeline control region (CORE-09, CORE-10, CORE-12, LAW-05). Hardcoding all three to eu-central-1 keeps meeting metadata, media processing, recording pipelines, lifecycle events and captured artifacts in Frankfurt. The adapter validates `CHIME_REGION` at start-up; any value other than `eu-central-1` fails the application (D-CW-06). This satisfies the data residency requirement for users in Serbia (including the Hungarian-speaking minority in Vojvodina) without claiming that no byte leaves the EU: AWS billing telemetry may be processed globally (LAW-06), and audio is decrypted server-side for mixing (LAW-07). Product copy says "encrypted in transit and at rest", never "end-to-end encrypted".

Second, the pricing model is simple and predictable. At $0.0017 per attendee-minute (COST-01), a 45-minute consultation costs $0.153. Launch-scale estimates: about $87 to $114 per month at 500 consultations of 45 minutes and one monthly webinar of 100 to 300 attendees with a replay, about $385 to $394 at 2,000 consultations and a 1,000-attendee webinar (COST model in `research/03-compliance-consent-cost.md`). Volume discounts are available from AWS with minimum commitments (COST-10).

## 6. Architecture overview

### Request path

```
Browser / Expo WebView
  |
  POST /appointments/:id/join (cookie or call-ticket)
  |
  apps/api/src/calls/   -- authorize, create or retrieve session
  |
  apps/api/src/video/ChimeVideoProvider
  |            CreateMeetingWithAttendees / CreateAttendee
  |            (eu-central-1, SQS notification config)
  |
  <-- Meeting + Attendee + JoinToken returned to client
  |
  packages/video/CallSessionController
  |            amazon-chime-sdk-js 3.32.0
  |            WebRTC to *.chime.aws (UDP 3478, TCP 443 fallback)
  |
  Chime events --> SQS chime-events queue
                      |
                      apps/api/src/worker/
                        chime.events.consume (long-polling)
                        |
                        call_events table (idempotent, out-of-order safe)
                        |
                        session and participant state in PostgreSQL

  Socket.IO (call:{sessionId}, webinar:{webinarId})
    |
    chat, polls, hand-raise, signals, follow-up proposal, attendance count
```

### Modules and packages

| Canonical name | Location | Responsibility |
| --- | --- | --- |
| `VideoProvider` | `apps/api/src/video/video.provider.ts` | Abstract adapter: `createSession`, `createParticipant`, `updateParticipantCapabilities`, `removeParticipant`, `endSession`, `startRecording`, `stopRecording`, `describeSession` |
| `ChimeVideoProvider` | `apps/api/src/video/chime-video.provider.ts` | Wraps `@aws-sdk/client-chime-sdk-meetings` and `@aws-sdk/client-chime-sdk-media-pipelines` |
| `FakeVideoProvider` | `apps/api/src/video/fake-video.provider.ts` | Deterministic stubs; emits the same domain events through an in-process queue; selected when `VIDEO_PROVIDER=none` (the default) |
| Appointments module | `apps/api/src/appointments/` | Minimal spine: create, cancel, status transitions |
| Calls module | `apps/api/src/calls/` | Sessions, participants, join, end, outcomes, feedback, client events, diagnostics |
| Webinars module | `apps/api/src/webinars/` | Occurrences, registrations, live session, questions, polls, recordings, certificates |
| Mailer module | `apps/api/src/mailer/` | Generalised email with localised templates for all four locales, ICS attachment |
| Calendar module | `apps/api/src/calendar/` | In-house ICS generator (RFC 5545), `CLASS:PRIVATE`, neutral `SUMMARY` |
| Jobs | `apps/api/src/jobs/` | `appointment.remind`, `webinar.remind`, `calls.cleanup`, `calls.reconcile`, `calls.no_show_followup`, `webinar.recording.finalize`, `webinar.certificates.issue`, `chime.events.consume` |
| `@nestself/video` | `packages/video/` | `CallSessionController`, hooks (`useCallSession`, `useDevices`, `useConnectionQuality`, `useVideoTiles`, `useWebinarStage`), components (`PreJoinCheck`, `CallStage`, `ControlBar`, `ConnectionBadge`, `SessionTimer`, `FollowUpCard`, `WebinarStage`, `ChatPanel`, `PollPanel`, `ModeratorQueue`, `HandRaiseButton`, `CrisisBlock`) |
| CDK video stack | `infra/cdk/lib/video-stack.ts` | SQS queue, EventBridge rule, recordings bucket, `VideoApiPolicy`, `VideoWorkerPolicy` |

### Data model

Each entity is described at the field level. All appointment-side tables carry `org_id` and are under forced RLS with `tenantPredicate`. Webinar tables for `all_eligible` occurrences carry `org_id = null` with a platform-scope policy.

| Entity | Key fields |
| --- | --- |
| `appointments` | `id`, `orgId`, `expertUserId`, `employeeUserId`, `startsAt`, `endsAt`, `status` (proposed, awaiting_approval, confirmed, completed, canceled, declined, no_show), `serviceCategory`, `timeZone`, `fundingRef` (nullable), `followUpOf` (nullable, references `appointments.id`) |
| `appointment_approvals` | `id`, `appointmentId`, `orgId`, `employeeUserId`, `approverUserId`, `status` (pending, approved, rejected, expired), `reason` (nullable), `decidedAt`, `createdAt`. Routed to the holder of an approval authority (`approval.decide`) covering the employee's unit; never carries the service category (D-CW-37). |
| `call_sessions` | `id`, `appointmentId` or `webinarId`, `format` (consultation, webinar, workshop), `providerMeetingId`, `status` (pending, creating, active, ended, failed), `startsAt`, `endsAt` (scheduled window), `startedAt`, `endedAt` (actual) |
| `call_participants` | `id`, `sessionId`, `userId`, `role` (expert, employee, presenter, moderator, attendee, facilitator, participant), `providerAttendeeId`, `firstJoinedAt`, `lastLeftAt`, `reconnectCount` |
| `call_events` | `id`, `providerMeetingId`, `eventType`, `providerAttendeeId`, `occurredAt`, unique on `(providerMeetingId, eventType, providerAttendeeId, occurredAt)` |
| `call_client_events` | `id`, `sessionId`, `participantId`, `eventName`, `metrics` (JSONB), `browser`, `os`, `createdAt` |
| `call_outcomes` | `id`, `sessionId`, `status` (completed, no_show_employee, no_show_expert, technical_failure, canceled), `recordedBy`, `connectionMetadata` (JSONB) |
| `call_feedback` | `id`, `sessionId`, `userId`, `score` (1 to 5), `comment` (optional), `createdAt` |
| `call_consents` | Schema only in this epic (D-CW-19): `id`, `sessionId`, `participantId`, `consentType`, `grantedAt`, `revokedAt` |
| `call_messages` | Workshop chat (M4): `id`, `sessionId`, `participantId`, `text`, `sentAt`. Retained until the session ends plus 24 hours. |
| `webinars` | `id`, `orgId` (nullable), `title`, `description`, `audiencePolicy`, `capacity`, `chatPolicy`, `status` (draft, published, live, ended, canceled), `startsAt`, `endsAt`, `timeZone` |
| `webinar_hosts` | `id`, `webinarId`, `userId`, `role` (presenter, moderator) |
| `webinar_registrations` | `id`, `webinarId`, `userId`, `registeredAt`, `canceledAt` |
| `webinar_messages` | `id`, `webinarId`, `authorUserId`, `authorDisplayName` (nullable), `body`, `kind` (host, attendee, question), `status` (pending, published, answered, dismissed), `publishedBy`, `answeredBy` |
| `webinar_polls` | `id`, `webinarId`, `question`, `status` (draft, open, closed) |
| `webinar_poll_options` | `id`, `pollId`, `label`, `position` |
| `webinar_poll_results` | `id`, `pollId`, `optionId`, `count`. Individual votes stored without voter id (D-CW-16). |
| `webinar_recordings` | `id`, `webinarId`, `sessionId`, `bucketKey`, `status` (scheduled, recording, processing, ready, handed_off, failed), `handoffStatus` |
| `webinar_certificates` | `id`, `webinarId`, `userId`, `attendedMinutes`, `includesTopic`, `issuedAt` |

### Delivery models by audience size

| Audience | Model | Attendee capabilities | Cost per session-hour (planning assumption) |
| --- | --- | --- | --- |
| 1:1 consultation (2 participants) | Single meeting, `MaxCount` 4 | Both `SendReceive` audio and video; content `SendReceive` for expert, `Receive` for employee | 2 x 60 x $0.0017 = $0.204 (COST-01) |
| Webinar, up to 250 | Single meeting | Presenters and moderator `SendReceive`; attendees `Receive` only | 250 x 60 x $0.0017 = $25.50 (COST-01) |
| Workshop, up to 25 | Single meeting, `MaxCount` 30 | All `SendReceive`; content `SendReceive` for facilitator, `Receive` for others | 25 x 60 x $0.0017 = $2.55 (COST-01) |
| Webinar, 251 to 1,000 (M3) | Primary + replicas | Replica attendees receive-only; $0.0085/replica-session-minute on top | $25.50 + replicas (COST-02) |
| Webinar, above 1,000 (documented, not built) | Presenter meeting + media live connector to IVS | IVS viewers, chat on Socket.IO | $0.09/stream-min + IVS viewer-hours (COST-05, COST-06) |

Echo reduction is enabled for all formats (`Audio.EchoReduction = AVAILABLE`) because many employees use laptop speakers (CORE-26). Its price is not separately published (COST-09). `MaxCount` for consultations is 4, not 2, to allow a recording attendee and a support join in a later phase without a contract change (D-CW-10).

## 7. Privacy and trust model

This section describes what the system does, not what it promises.

**Opaque identities.** `ExternalUserId` sent to Chime is the `call_participants.id`, a random id created per session and participant, never the user id, name or email (D-CW-11, LAW-09). `TenantIds` carries the organisation id for consultations and workshops, the webinar id for webinars. Tags: `stage`, `format`, `orgId` only.

**Employer isolation.** No endpoint in this epic returns a participant list, a registration list, a question author or a feedback row to a principal whose grants are organisation-scoped only (D-CW-30). The default-deny test plus authorisation golden cases prove it for every route. Aggregate counts with a k-anonymity threshold of 5 are produced by the reporting epic, not here (LAW-14, LAW-24).

**Neutral notifications.** Reminders use the subject "Your NestSelf session" or "Your NestSelf webinar", carry no service category, and attach an ICS file with `CLASS:PRIVATE` and a neutral `SUMMARY` (D-CW-26, UX-24, UX-32).

**Anonymity in webinars.** Attendees get receive-only capabilities, so they cannot send audio or video; attendees never have cameras in any milestone (D-CW-35). The roster, counts and names come from NestSelf's database, never from `ListAttendees` on the client: attendees receive no roster at all, presenters receive a count, the moderator sees registered names for the floor and follow-up (D-CW-15, UX-25, UX-48). Messages from attendees are anonymous towards the audience by default; an attendee can attach their first name per message (D-CW-35). Hand-raise shows the moderator the registration name; the presenter sees "a participant asked to speak". An attendee given the floor is audio only; video stays `Receive`.

**No recording of consultations.** No media-pipeline IAM permission is granted to the API role, only to the worker role for webinars. `POST /appointments/:id/recording/*` does not exist. The dual-consent data model (`call_consents`) is specified in the guidelines so a later epic can enable it after F-CW-01 and the DPIA (D-CW-19, D-CW-34, LAW-28).

**Every webinar is recorded.** There is no per-occurrence recording switch (D-CW-34). Recording starts when the moderator starts the webinar and stops when it ends. The capture pipeline uses `SelectedVideoStreams` set to presenter attendee ids and `CompositedVideo` layout `PresenterOnly`. Attendees are receive-only, so no attendee media can exist in the capture; an attendee given the floor is told their voice is part of the recording before they unmute. A persistent "REC" indicator is shown to everyone. The registration page, the confirmation email and the lobby state that the webinar is recorded and that only the presenters are on the recording (D-CW-18, D-CW-34, UX-45, WEB-23 to WEB-26).

**Follow-up approval privacy.** The approval item routed to a manager carries the employee's name, "follow-up session with a NestSelf expert", the date and the duration. It never carries the service category, the expert's specialty or any session content (D-CW-37, F4 section 7 of the product flows).

**Diagnostics without content.** `GET /ops/calls/:sessionId/diagnostics` returns exactly the fields defined in auth strategy section 4.7.5: session id, appointment or webinar id, start and end, status, provider, provider meeting id, per-participant role, join and leave timestamps, reconnect count, aggregated quality metrics, error codes, browser and OS. A serialisation test asserts the DTO has no other field. Viewing diagnostics is audited (D-CW-28).

**Retention defaults.** Appointment and session metadata: 7 years (FINANCIAL tier, LAW-27). Approval items: with the appointment, 7 years. Client diagnostics: 90 days. Webinar messages: 12 months after the occurrence, then author links removed. Feedback: 24 months. Workshop chat: 24 hours. Webinar raw capture segments: 30 days; the concatenated replay follows the CMS content lifecycle. These are defaults; the DPIA (LAW-12, LAW-29) and the founder's L-02 and L-03 answers may change them (D-CW-29).

**Certificates.** Opt-in per attendee, neutral title "NestSelf webinar" and date, no topic unless the attendee chooses it, threshold 60 percent of live minutes or full replay (F-CW-03).

## 8. Milestones

Planning assumptions: a team of two to three engineers who already know the repository, working full-time after completing the current auth phase-2 work. Ranges reflect uncertainty about spike outcomes and the design review cycle. These are person-days, not elapsed days.

### M0: Foundation and spikes

**Outcome.** The provider adapter, all tables, the CDK video stack, the mailer module, the ICS generator and the contract schemas exist. `FakeVideoProvider` emits events through an in-process queue. The eight spikes are run and recorded. Sample data covers appointments and webinars.

**Demo.** `pnpm verify` passes. `POST /appointments/:id/join` with `VIDEO_PROVIDER=none` returns deterministic fake credentials and emits a `call.session.created` event. The video stack deploys in the dev account.

**Stories.** Covers the foundation group of CALL stories (session creation, fake provider, schema validation), the PLT group (infrastructure, env, CDK, policies, sample data) and all SPIKE stories.

**Range.** 8 to 14.5 person-days.

### M1: Consultations end to end with follow-up and approvals

**Outcome.** A confirmed appointment can be joined by both participants from the workspace and admin apps on desktop. The pre-join screen runs device and network checks. The in-call experience has speaker view, mute, camera, blur, device switch, connection badge, session timer, crisis block, quick signals, degraded mode and reconnection. The expert records the outcome, the employee leaves feedback. On the post-call screens the expert proposes a follow-up (when the outcome is `completed`), the employee confirms or suggests up to three time windows, and the organisation's `follow_up_approval_policy` routes an approval item to the appropriate authority when set to `manager_approval`. The approval item carries the employee's name, the date and the duration but never the service category. Neutral reminders with ICS attachments go out at 24 hours and 1 hour before. No-show follow-up runs at 48 hours. Diagnostics work for support. HR can set the follow-up approval policy per organisation.

**Demo.** Two Chromium contexts join a real meeting in the dev account (the nightly `video-smoke` workflow). The Playwright journey against `FakeVideoProvider` covers pre-join, join, in-call controls, end, post-call follow-up proposal, employee confirmation, approval routing and approval decision. Authorisation golden cases: non-participant 404, outside window 403, canceled 409, rejoin returns identical credentials, concurrent first join creates one meeting, employer-scoped principal 404 on every route, approval item carries no service category, self-approval denied.

**Stories.** Covers the CALL story groups for consultation join, in-call, outcome, feedback, diagnostics, signals, timer, crisis block, pre-join, reminders, follow-up proposal, confirmation, suggested times, approval routing and the organisation policy.

**Range.** 27.5 to 42.5 person-days.

### M2: Webinars live up to 250, always recorded, with chat, floor and replay handoff

**Outcome.** An operator creates and publishes a webinar. Eligible employees register. Attendees join a lobby and the live session with receive-only capabilities (never with a camera), the webinar chat, hand-raise, the audio-only floor, polls and a count visible to the moderator and presenter. Hosts post to everyone; attendee messages reach the audience only when a host publishes them, anonymous by default. The moderator manages the message queue, gives and takes the floor, and opens and closes polls. Recording starts automatically when the moderator starts the webinar and stops when it ends; the capture pipeline records presenter-only composited video. The worker concatenates the segments into one MP4 and writes the handoff row for the CMS. The session ends for all when the presenter or moderator clicks "end webinar".

**Demo.** A Playwright journey covers registration, lobby, attendee view, chat, the floor, poll and end. A recorded webinar produces an MP4 in the recordings bucket, and the `webinar_recordings` row transitions through `recording`, `processing`, `ready` and `handed_off`. The motion suite covers every new panel and sheet.

**Stories.** Covers the WBN story groups for occurrence creation, registration, lobby, live session, chat, hand-raise, the floor, polls, moderation, recording, concatenation, handoff and end, and the PLT group for the recordings bucket lifecycle.

**Range.** 22 to 33.5 person-days.

### M3: Webinar scale, certificates and load test

**Outcome.** Webinars above 250 attendees use media replication with replica meetings (up to 1,000 attendees). SPIKE-CW-06 runs first to confirm the audio behaviour of attendees given the floor in replica meetings. Certificates are issued to attendees who opt in and met the attendance threshold. A load test with the AWS client launcher validates the 250-attendee single-meeting path and the replication path.

**Demo.** A replicated webinar with 300 attendees works (if SPIKE-CW-06 confirms the replication path). A certificate PDF with a verification link is generated. The load test report is recorded.

**Stories.** Covers the WBN replication stories, certificate stories, load-test stories and the PLT group for quota requests.

**Range.** 6 to 9.5 person-days.

### M4: Mobile join, workshops and replay captions

**Outcome.** The employee app opens the call route in an in-app browser with the ticket pattern. Workshops use gallery view with facilitator controls and session chat. Replay captions use Amazon Transcribe batch (Serbian first, Hungarian for webinars held in Hungarian; WEB-32) converted to WebVTT and reviewed before publication.

**Demo.** The `call/$appointmentId.tsx` route joins a meeting with audio and video inside the Expo app on iOS and Android. A workshop with 10 participants shows gallery view.

**Stories.** Covers the CALL mobile join stories, WKS story groups for workshop format and PLT replay caption stories.

**Range.** 7 to 10 person-days.

**Total range across all milestones: 71 to 110 person-days (14.2 to 22 person-weeks).** With a buffer for design review cycles, spike outcomes and rebases against the parallel auth work, plan 90 to 135 person-days (18 to 27 person-weeks). This is a planning range. The lower bound assumes spike outcomes are favourable, the design review cycle is one round and the auth phase-2 merge is clean. The upper bound assumes one spike invalidates a decision (forcing a re-plan), the design review takes two rounds and the motion suite needs additional entries.

## 9. Spikes

All spikes run in M0. Results are recorded in `research/07-spikes.md`.

| Id | Question | Why it matters |
| --- | --- | --- |
| SPIKE-CW-01 | Does a repeated `ClientRequestToken` return the same meeting, a `ConflictException`, or a second meeting? | The concurrent first-join lock (D-CW-07) relies on this as a second line of defence. If the token creates a second meeting, the lock is the only idempotency mechanism. |
| SPIKE-CW-02 | Does `CreateAttendee` with a repeated `ExternalUserId` return the existing attendee? | Determines whether the rejoin path can skip the Redis lookup in a cold-cache scenario (D-CW-08). |
| SPIKE-CW-03 | Does a media-pipeline attendee count against `Attendee.MaxCount`, and does it keep the meeting alive past 5 empty minutes? | Determines whether the consultation `MaxCount` of 4 is sufficient when recording is enabled in a later phase, and whether the cleanup job must explicitly stop pipelines (D-CW-10, D-CW-18, OPS-42). |
| SPIKE-CW-04 | Do `SelectedVideoStreams` and `CompositedVideo PresenterOnly` combine into one presenter-only composited MP4? | The recording pipeline depends on this combination filtering out attendee media by construction (D-CW-18, WEB-25, WEB-26). |
| SPIKE-CW-05 | Does the ticket web route join a meeting with audio and video inside the Expo app on iOS (WKWebView) and Android? | The mobile join strategy depends on the JS SDK working inside a WebView opened from the native app (D-CW-24, CORE-23, CORE-36). |
| SPIKE-CW-06 | Do attendees given the floor in replica meetings lose audio after 40 to 50 minutes (WEB-39)? | Runs at the start of M3 before replication is built. If confirmed, the mitigation is time-limited promotions with a re-promotion cycle. |
| SPIKE-CW-07 | What is the delivery latency of direct SQS versus EventBridge to the queue? | Determines whether the dual-routing setup (SQS direct plus EventBridge backstop) is necessary or whether EventBridge alone is fast enough for real-time state updates (D-CW-12). |
| SPIKE-CW-08 | Can two Playwright Chromium contexts join one real meeting in CI? | The nightly `video-smoke` workflow depends on this working in headless Chromium with fake media (D-CW-33, OPS-32, OPS-33). |

## 10. Founder decisions and legal checklist

### Founder decisions (answered 24 October 2026)

All ten questions were answered by the founder on 24 October 2026. The decisions are applied throughout this epic.

| Id | Question | Answer | Applied as |
| --- | --- | --- | --- |
| F-CW-01 | Will consultations be recorded (with dual consent)? | Not for now. Every webinar is recorded. | D-CW-34, D-CW-18, D-CW-19; recording moves into M2 |
| F-CW-02 | Webinar audience ceiling? | No product ceiling; a technical ceiling is acceptable. 200 to 300 attendees expected in the first year. Attendees never have cameras; they write in the chat or raise a hand, and a host decides who gets audio. | D-CW-35, D-CW-36; replication moves from M4 to M3; chat replaces the earlier Q&A design; the floor is audio only |
| F-CW-03 | Certificates of attendance for webinars? | Default accepted. | Opt-in, neutral title, 60 percent threshold |
| F-CW-04 | Ask the employee for their current location at the start of psychological sessions? | Ask, never mandatory; declining is fine. | Default confirmed (optional prompt, session-only storage) |
| F-CW-05 | Native mobile call experience in the first year? | No. | D-CW-24 stands: web route inside the app |
| F-CW-06 | May an expert extend a running session? | No. A follow-up must be schedulable at the end of the call, with manager approval where the company's policy requires it. | D-CW-37: post-call follow-up proposal, confirmation, suggested times, approval items and the organisation policy |
| F-CW-07 | Who may moderate webinars? | Default accepted. | `service_coordinator`, `client_operations`, `platform_owner` hold `event.moderate` |
| F-CW-08 | Webinar audience default? | Default accepted. | `all_eligible` for NestSelf-run webinars; organisation-scoped for client-requested ones |
| F-CW-09 | Retention periods? | Defaults accepted. | D-CW-29 |
| F-CW-10 | DPIA owner and date? | Development must not be blocked. | The DPIA runs in parallel with development and gates only the production launch; no task depends on it |

### Legal checklist (Serbia; not development tasks, never a blocker for development)

1. DPIA under ZZPL Art. 54 (and GDPR Art. 35 for the EU-based processor) covering Chime SDK data flows, the audio-mixing architecture, metadata stored by NestSelf, webinar recordings and their announcement, the consent schema kept for later, retention, employer isolation and breach handling (LAW-11, LAW-12, LAW-29). It runs alongside development and gates the production launch only (F-CW-10).
2. Webinar recording notice: registration, confirmation email and lobby state that the webinar is recorded and that only presenters are on the recording; an attendee given the floor is told their voice is recorded (D-CW-34).
3. Product copy: "encrypted in transit and at rest", never "end-to-end encrypted" (LAW-07). Accessibility statement on captions (D-CW-23, LAW-33).
4. Expert credentials and confidentiality under Serbian law: psychologists' professional secrecy (LAW-15); the approval item of D-CW-37 carries no service category because the Commissioner's position is that an employer must never learn a diagnosis (LAW-14).
5. Client-company network note: `*.chime.aws` on UDP 3478 and TCP 443, `*.sdkassets.chime.aws` on TCP 443 (CORE-30).
6. Service quota requests in eu-central-1 before scale (D-CW-31): concurrent meetings above 250 (CORE-19), media pipelines above 10 (WEB-41).
7. Volume pricing conversation with AWS after 1,000 consultations per month (COST-10).
8. Kept for a later Hungarian launch, not for now: Hungarian recording consent and telemedicine rules, psychotherapy licensing, NAIH practice (LAW-19 to LAW-25); Hungarian crisis hotlines in the crisis block.

## 11. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| No maintained React Native or Expo module for the Chime SDK | Confirmed (CORE-34, CORE-35) | Mobile experience limited to WebView | M4 proves the WebView path with SPIKE-CW-05. Native modules are a separate epic if the pilot shows the need (F-CW-05). |
| Media pipeline quota default is 10 in eu-central-1 | Confirmed (WEB-41) | Cannot record more than 10 concurrent webinars | Request a quota increase before the first month with more than 5 recorded webinars. |
| Serbian and Hungarian live captions unsupported by Chime SDK `StartMeetingTranscription` | Confirmed (WEB-31, WEB-34) | No live captions in this epic | D-CW-23 defers live captions. Replay captions use Transcribe batch which supports `sr-RS` and `hu-HU` (WEB-32). The accessibility statement discloses this (LAW-33). |
| Attendees given the floor in replica meetings lose audio after 40 to 50 minutes | Reported, unresolved (WEB-39) | The floor unreliable in replicated webinars | SPIKE-CW-06 runs at the start of M3 before replication is built. Mitigation: time-limited promotions with re-promotion, or demote/re-promote cycle. |
| Approval policy misconfiguration | Medium | An organisation sets `manager_approval` but has no approval authority covering a unit; follow-up proposals for employees in that unit cannot be routed | The service detects the missing approver at proposal time, fails the proposal visibly with a message telling the employee "your company requires approval for follow-ups; ask HR to set an approver for your unit", and writes an audit event so that NestSelf operations can follow up. The error is not `approval_not_pending`; it is a visible, audited, actionable dead end. |
| Corporate networks blocking UDP | Likely for some client companies | Degraded call quality on TCP 443 fallback | The SDK falls back automatically (CORE-30, OPS-28). The client-company network note asks for UDP 3478 to `*.chime.aws`. Pre-join network check warns the user. |
| Parallel auth phase 2 work touching `packages/contracts/src/actions.ts` and templates | High | Merge conflicts on the action catalog and template definitions | Coordinate: this epic adds `event.manage` and `event.moderate` only. Review the diff before merging either branch. |
| `ClientRequestToken` idempotency semantics undocumented | Confirmed (OPS-01) | Concurrent first-join could create duplicate meetings without the lock | The `KeyValueStore.set(nx, ttl)` lock is the primary idempotency mechanism. SPIKE-CW-01 measures the token's real behaviour as a second line of defence (D-CW-07). |
| Recording concatenation failure leaves orphaned segments | Medium | Replay not available, raw segments consume storage | The worker retries concatenation with backoff. The 30-day lifecycle rule on raw segments prevents unbounded storage. An alert fires on `recording_status = 'failed'`. |
| Chime SDK service deprecation or namespace change | Low in the planning horizon (CORE-37, CORE-38) | Adapter swap | The `VideoProvider` abstraction isolates the rest of the codebase. |
| Workshop chat retention rule (24 hours) is too short for facilitator follow-up | Medium | Facilitator loses context | The 24-hour retention is a default (D-CW-29). The facilitator receives a nudge to export notes before the chat expires. |

## 12. Exit criteria

### Epic exit criteria

1. All four session formats (consultation with follow-up and approval, webinar with chat, floor and polls, webinar with recording and handoff, workshop) work end to end in the dev account with `VIDEO_PROVIDER=chime`.
2. `pnpm verify` passes at every task boundary. The default-deny test covers every route in the appointments, calls and webinars modules.
3. Authorisation golden cases pass: non-participant 404, outside-window 403 `join_window_closed`, canceled 409 `appointment_not_joinable`, rejoin returns identical credentials, concurrent first join creates one meeting, employer-scoped principal 404 on every route, follow-up approval item carries no service category, self-approval on a follow-up is denied. The golden case "no employer-facing endpoint lists participants" is a dedicated test that iterates every route in the epic and asserts 404 for a principal holding only organisation-scoped grants (D-CW-30).
4. Playwright journeys against `FakeVideoProvider` cover pre-join, consultation, webinar attendee, webinar moderator and workshop, each including the close lifecycle (exit animation, unmount).
5. The motion suite covers every new panel, sheet, dialog and disclosure in `packages/video` and the app routes.
6. The nightly `video-smoke` workflow joins a real meeting in the dev account from two Chromium contexts, verifies audio and video are exchanged, and ends the meeting.
7. Neutral reminders arrive in all four locales with correct ICS attachments.
8. The recordings bucket contains a concatenated MP4 after a recorded webinar, and the `webinar_recordings` row reaches `handed_off`.
9. Sample data covers `SAMPLE_APPOINTMENTS` (including one `proposed` and one `awaiting_approval` follow-up), `SAMPLE_CALL_SESSIONS`, `SAMPLE_WEBINARS`, `SAMPLE_WEBINAR_MESSAGES` and `SAMPLE_WEBINAR_POLLS`. The `SampleDataBanner` appears in sample mode.
10. `pnpm check` passes (colour rule, motion contract, locale parity).

### Pilot exit criteria (before the first real consultation on production)

1. The DPIA is completed and the founder has answered F-CW-10.
2. Expert credentials are verified under Serbian law (LAW-15).
3. The client-company network note has been delivered.
4. Service quota requests have been submitted for the expected scale.
5. The `VIDEO_PROVIDER` env var is set to `chime` on the production stage, the video stack is deployed, and `env-from-outputs.mjs` has populated `CHIME_EVENTS_QUEUE_URL`, `CHIME_EVENTS_QUEUE_ARN` and `RECORDINGS_BUCKET`.
6. At least one real consultation and one real webinar have been run in the production account by a test team, and the diagnostics, outcome capture and feedback confirm the loop works.

## 13. Decision provenance

| Chapter | Key statement | Source |
| --- | --- | --- |
| 1 | Consultation loop (reminder, pre-join, room, outcome, feedback, follow-up, approval) | F2, F3, F5, F6, F9, D-CW-07, D-CW-09, D-CW-37, UX-01 to UX-22 |
| 1 | Webinar loop (discover, register, lobby, live chat, floor, recording, replay) | F8, D-CW-14 to D-CW-18, D-CW-34, D-CW-35, UX-25 to UX-33 |
| 2 | One epic, five milestones (M0 to M4) | D-CW-01 |
| 2 | Follow-up and approvals in deliverables | D-CW-37 |
| 2 | Minimal appointment spine, not the booking engine | D-CW-02 |
| 2 | Webinar replays owned by CMS | D-CW-03 |
| 2 | Out of scope items | D-CW-04 |
| 3 | Employer gains nothing (participant isolation) | D-CW-30, LAW-14, LAW-24 |
| 4 | Existing auth, Socket.IO, BullMQ, RLS, design system | Research 06 sections 1, 3 to 11 |
| 4 | Missing modules, tables, schemas, dependencies | Research 06 section 2 |
| 5 | eu-central-1 for control, media and pipeline | D-CW-06, CORE-09, CORE-10, CORE-12, LAW-05 |
| 5 | Audio-mixing architecture, no E2E encryption claim | LAW-06, LAW-07 |
| 5 | Cost estimates | COST-01, COST-02, COST-05, COST-06, COST-10 |
| 6 | Provider adapter and `FakeVideoProvider` | D-CW-05 |
| 6 | Create meeting at first join with NX lock | D-CW-07, OPS-01, OPS-05 |
| 6 | Event ingestion via SQS with EventBridge backstop | D-CW-12, OPS-14, OPS-15 |
| 6 | Delivery models by audience size | D-CW-14, COST-01, COST-02, COST-05, COST-06, WEB-01 to WEB-09 |
| 6 | Echo reduction enabled, MaxCount 4 for consultations | D-CW-10, CORE-26, COST-09 |
| 7 | Opaque ExternalUserId | D-CW-11, LAW-09 |
| 7 | Employer isolation, default-deny test | D-CW-30, LAW-14, LAW-24 |
| 7 | Neutral notifications with CLASS:PRIVATE ICS | D-CW-26, UX-24, UX-32 |
| 7 | Attendee anonymity enforced server-side | D-CW-15, UX-25, UX-48 |
| 7 | No consultation recording, consent schema only | D-CW-19, D-CW-34, LAW-28 |
| 7 | Every webinar is recorded, no per-occurrence switch | D-CW-18, D-CW-34, WEB-23 to WEB-26, UX-45 |
| 7 | Attendees never have cameras; chat and audio-only floor | D-CW-35, D-CW-15 |
| 7 | Follow-up approval privacy (no service category) | D-CW-37, LAW-14 |
| 7 | Diagnostics without content | D-CW-28 |
| 7 | Retention defaults | D-CW-29, LAW-26, LAW-27 |
| 8 | Milestone structure M0 to M4, follow-up in M1, recording in M2, replication in M3 | D-CW-01, D-CW-34, D-CW-36, D-CW-37 |
| 9 | All eight spikes | SPIKE-CW-01 to SPIKE-CW-08 |
| 10 | Founder decisions answered | F-CW-01 to F-CW-10, D-CW-34 to D-CW-38 |
| 10 | DPIA mandatory | LAW-12, LAW-29 |
| 10 | Expert credentials under Serbian law | LAW-15 |
| 10 | Approval item carries no service category | D-CW-37, LAW-14 |
| 10 | Serbia-only launch; Hungarian items kept for later | D-CW-38 |
| 10 | Network requirements | CORE-30 |
| 10 | Quota limits | CORE-19, WEB-41 |
| 11 | No React Native SDK | CORE-34, CORE-35 |
| 11 | Media pipeline quota 10 | WEB-41 |
| 11 | Serbian/Hungarian live captions unsupported | WEB-31, WEB-34 |
| 11 | Promoted-attendee audio issue (M3) | WEB-39 |
| 11 | Approval policy misconfiguration | D-CW-37 |
| 11 | Corporate networks blocking UDP | CORE-30, OPS-28 |
| 11 | ClientRequestToken undocumented | OPS-01 |
| 12 | Authorisation golden cases and employer isolation proof | D-CW-30, D-CW-33 |
