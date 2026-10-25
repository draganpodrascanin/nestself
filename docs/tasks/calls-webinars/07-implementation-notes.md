# Implementation notes: consultations and webinars on Amazon Chime SDK

Epic `NS-CALLS-01`. Implementation notes v1.0, 25 October 2026. These notes record what the implementation on branch `feat/calls-p0` (M0 to M2 and the replication of M3) taught that the planning files did not say: the defects only a real browser found, the frontend-coverage audits and what closed their gaps, how to run the stack and the journeys, the spikes still to run, where the code disagreed with the amendment brief for this pass, and the follow-ups. The planning files (`02-decisions.md`, `04-user-stories.md`, `05-tasks.md`, `06-implementation-guidelines.md`) were amended the same day to describe the code; each amendment is dated there. Where the code and a planning file disagree, the code is the reference until a decision says otherwise.

## 1. Defects found only by the real-browser run

The unit and component tests run against a mocked Chime SDK in jsdom, and the API suites against the fake provider without a browser. None of them loads the SDK's browser bundle, the apps' built CSS, the real authorization data of the seed, or the API and the worker as separate processes. The Playwright journeys of T-CW-1.7 do all of that (`e2e/calls/`, section 3), and their first run found six defects that every other suite had passed.

| Id | What the browser showed | Cause | Fix | Commit |
| --- | --- | --- | --- | --- |
| DEF-1 | Every pre-join check failed and no meeting session could start | `amazon-chime-sdk-js` 3.32.0 evaluates `'document' in global` when its module loads (`cspmonitor/CSPMonitor.js`); a browser has no `global` | `loadChimeSdk` aliases `global` to `globalThis` before loading the SDK, leaving an existing `global` alone | `ee2dc6b` |
| DEF-2 | The self-view covered the whole stage; the overlays and the control bar lost their layout | Tailwind in the workspace and admin apps did not scan `packages/video`, so classes used only there were never emitted | An `@source` directive for the video package in both apps | `298316a` |
| DEF-3 | The seeded expert was told the consultations view is not available to her role | `effectiveActions()` behind `GET /auth/me` evaluated an assignment-scoped grant without a `scopeRefId` at a resource with no target, which `authorize()` never allows, so the expert template's actions were missing and the admin app's route gating hid the screens | `effectiveActions()` and `effectiveAccess()` also evaluate such a grant at the target of each of the principal's active assignments | `88180b7` |
| DEF-4 | The webinar form's per-language title fields were not labelled in the reader's language | The labels did not come from the reader's catalog | Language labels per catalog in the reader's language, with a test for all four locales (the catalog change itself reached HEAD with `d6353b6`) | `76c94f8` |
| DEF-5 | A webinar started with the fake provider never reached recording; the recording failed after its retries | With `VIDEO_PROVIDER=none` the fake meetings live in the API process's memory, so the worker's `webinar.recording.start` found no meeting | With the fake provider the API process runs the `nestself-webinars` consumer (`VIDEO_FAKE_EVENTS_IN_API`, true unless set to `false`); the worker leaves that queue alone | `38e2bc3` |
| DEF-6 | Reseeding a database seeded before `2450b37` failed on `webinar_hosts_moderator_idx` | The seed upserted the fixture's host rows without removing a moderator row the fixture no longer has | The seed deletes the host rows that are not in the fixture before it upserts | `71c7503` |

The lesson for the remaining tasks: a feature that loads a third-party browser bundle, adds classes in a workspace package, depends on seeded grants or splits work between the API and the worker is not finished until a journey has run it in Chromium against the real API.

## 2. Frontend-coverage audits and gap closures

After the first web commits of T-CW-1.5, the M1 stories were audited for frontend coverage: for each acceptance criterion, whether the API returned what the screen needed and whether the workspace or admin screen rendered the state, including every failure (the CLAUDE.md error-visibility rule). The gaps fell into two kinds: a field or route the API did not have, and a state no screen rendered. They were closed in these commits:

| Commit | Layer | What it closed |
| --- | --- | --- |
| `ab0bebe` | API | `viewer { hasJoined, pendingSignal }` on appointment reads (the running-late signal kept under `call:{sessionId}:pending_signal` until the employee joins); for the employee only, `approvalOutcome` and `declineReason`; the decline reaches the expert on `user:{userId}`; cancel by operations through `bookings.coordinate`; `GET /ops/calls/problem-reports`; the sample approver |
| `5a94cce` | api-client | The reader fields; `createAppointment`, `getDiagnostics`, `listProblemReports`; the user room hands the expert the decline |
| `da1fa08` | workspace | The next appointment on the home page; cancel behind a confirmation; the approval outcome and the manager's reason; the technical support contact (`VITE_SUPPORT_EMAIL`) on the closed window and the failed reconnect; the join state from `viewer.hasJoined`; a retry when the post-call lookup fails; sample approval items |
| `97a830a` | admin | The booking form `/consultations/new`; the expert's Upcoming and Past sections; operations filters and a read-only view with Cancel gated on `bookings.coordinate`; `/support/calls` with diagnostics and the problem-report list; the decline toast |
| `54e683e` | API | `viewer.sessionEnded`; `GET /appointments?order=asc\|desc`; `GET /ops/orgs` for booking coordinators; `GET /ops/appointment-experts`; `GET /appointments/:id` for operations |

A later round (`973635f`) gave the consultation entry points to `consultation.join` holders only, ordered the lists through the API, listed a session's problem reports in its diagnostics, rendered the expert's photo and credentials when present, and hid Join and Rejoin once the session ended.

## 3. Running the stack and the journeys

**Prerequisites.** PostgreSQL on port 54329 with the role `nestself`, Redis on 6379, `psql` and `redis-cli` on the `PATH`, and Playwright's Chromium. Nothing in this section needs AWS: `VIDEO_PROVIDER=none` selects `FakeVideoProvider`, which keeps the meetings in the API process and emits the provider events there.

**The journeys.** `pnpm e2e:calls` runs `playwright test -c playwright.calls.config.ts`. The config starts three servers on their own ports, so the suite never reuses a development server of another checkout; outside CI an already running server on those ports is reused.

| Server | Port | How it starts |
| --- | --- | --- |
| API | 4117 | `e2e/calls/start-api.mjs`: creates the database `nestself_test_e2e17` when missing (never the development database), applies the migrations, runs the idempotent sample seed, builds the API (`E2E_CALLS_SKIP_API_BUILD=true` skips it) and runs it with stub authentication (email code `123456`), Redis index 7 and `VIDEO_PROVIDER=none` |
| Workspace app | 5187 | Vite with `e2e/calls/vite-workspace.config.mjs`, `VITE_DATA_SOURCE=api`, `VITE_API_URL` set to the app's own origin so every call goes through the proxy |
| Admin app | 5188 | Vite with `e2e/calls/vite-admin.config.mjs`, the same settings |

The ports, the database and the Redis URL come from `e2e/calls/servers.mjs` and can be overridden with `E2E_CALLS_API_PORT`, `E2E_CALLS_WORKSPACE_PORT`, `E2E_CALLS_ADMIN_PORT`, `E2E_CALLS_DATABASE_URL` and `E2E_CALLS_REDIS_URL`. The rest of the harness in `e2e/calls/`: `auth.setup.ts` clears what earlier runs left and signs the sample personas in once per run; `journey.ts` holds the shared steps; `fake-chime.ts` gives a joined meeting an in-page media session; Chromium gets fake camera and microphone (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, OPS-32); `manual.ts` writes the screenshots of every step to `manual/screenshots/` for desktop (1280 by 800) and mobile (390 by 844), and `manual-index.teardown.ts` rewrites `manual/screenshots/INDEX.md` after the run; `video-smoke.spec.ts` is the nightly real-provider test, skipped unless `VIDEO_SMOKE_ENABLED=true`.

**Running the stack by hand.** With `VIDEO_PROVIDER=none` (the default) the API alone runs calls end to end: the fake meetings, their events and the `nestself-webinars` jobs are handled in the API process (`VIDEO_FAKE_EVENTS_IN_API`, DEF-5). The worker can run alongside for `nestself-calls` (reminders, cleanup, reconcile, approval reminders and lapses). With `VIDEO_PROVIDER=chime` the worker consumes the `chime-events` queue and runs every job, and the API needs the video stack's outputs (`CHIME_EVENTS_QUEUE_URL`, `CHIME_EVENTS_QUEUE_ARN`, `RECORDINGS_BUCKET`) and `CHIME_REGION=eu-central-1`.

## 4. Spikes still to run

No spike has run against AWS. The scripts are in `apps/api/scripts/spikes/` (`pnpm --filter @nestself/api exec tsx scripts/spikes/<script>.ts`, `--help` prints the options without calling AWS); `research/07-spikes.md` holds the prerequisites, the running order, the cost (well under $1 for the M0 spikes, about $0.82 for SPIKE-CW-06) and the result tables. They run in the dev account `634972095709` in eu-central-1. Until a spike runs, the code rests on the assumption named here.

| Spike | Binds | What the code assumes until it runs |
| --- | --- | --- |
| SPIKE-CW-07 (run first) | D-CW-12 | Direct SQS and EventBridge copies of an event carry the same timestamp, so the `call_events` key drops the second copy |
| SPIKE-CW-01 | D-CW-07 | The Redis lock is the idempotency mechanism; the `ClientRequestToken` (the session id) is a second line of defence |
| SPIKE-CW-02 | D-CW-08 | After a credentials cache loss on an active session a new attendee is issued for the same participant |
| SPIKE-CW-08 | D-CW-33 | Two Playwright Chromium contexts can join one real meeting in CI (the `video-smoke` workflow) |
| SPIKE-CW-03 | D-CW-10, D-CW-18 | The capture pipeline takes one meeting seat (`RECORDING_PIPELINE_SEATS = 1`), so a webinar meeting is created for its capacity plus one, and the pipeline keeps a meeting alive |
| SPIKE-CW-04 | D-CW-18 | `SelectedVideoStreams` and `CompositedVideo` `PresenterOnly` combine into a presenter-only composite; the MP4's object name under `final/{webinarId}/composited-video/` is not known yet, so the stored handoff location is that folder |
| SPIKE-CW-05 | D-CW-24 | The ticket web route works inside a WebView on iOS and Android (M4, T-CW-4.1) |
| SPIKE-CW-06 | D-CW-14, D-CW-36 | A replica attendee given the floor (a promotion attendee on the primary, T-CW-3.2) keeps stable audio past the 40 to 50 minutes of WEB-39; if not, T-CW-3.2 step 6 (the workaround) is still to do |

## 5. Where the code and the amendment brief disagreed

The brief for this pass listed verified findings from the implementation reviews. Each was checked against the code before it was written down; where they differed, the code won:

1. **Session transitions (CW-R-18).** The brief named only the `creating -> creating` takeover. The code also closes a webinar session with `pending -> ended` or `creating -> ended` when a host ends the webinar before its meeting exists (`WebinarsService.closeSession`); both are documented.
2. **Join window (guidelines 4.3).** The brief named CALL-06 and CALL-07 only; guideline 4.3 also said the consultation window closes at `endsAt` plus 10 minutes, and was corrected to the first-join and rejoin bounds the code uses.
3. **Already amended before this pass.** Several items of the brief were already in the planning files from the task commits and were verified, not rewritten: `not_editable`, `conflict` and `approver_missing` in the error codes; `WEBINAR_MAX_REPLICAS` and `WEBINAR_REPLICATED_CAPACITY`; `GET /ops/orgs`, `GET /ops/webinars`, `GET /ops/webinars/:id`, `GET /ops/webinars/host-candidates`, the poll and recording reads; the audit events `webinar.updated`, `webinar.attendance.viewed` and `webinar.recording.failed`; the second `authorize()` call in guideline 7.4 step 5; CW-R-106 without `awaiting_approval -> proposed`; the S3 layout in guideline 14.1 item 3; CALL-40 criterion 3; and the subscribe text of guideline 8.
4. **Network check.** It is an API round-trip for consultations only. The webinar screens pass no probe, so the controller times a `HEAD` request to the page's own origin.
5. **Redis keys.** `webinar:{webinarId}:attendance` is not used (the attendance count comes from `call_participants` in PostgreSQL), `call_ticket:{hash}` is not built yet (M4), and `call:{sessionId}:pending_signal` is an addition.
6. **Jobs.** The lapse runs as its own job, `appointment.approval.expire`, which section 7 did not list. The webinar jobs run on `nestself-webinars`, not `nestself-calls` as the guidelines' table said, and job ids use `/` because BullMQ refuses a custom id that contains `:`.
7. **Metrics (guidelines 16.2).** The join alarms read metrics the API emits (`NestSelf/Video`: `JoinAttempts`, `JoinFailures`, `MeetingStartDurationMs`, `MeetingFailed`), not rows of `call_client_events`.
8. **Cancellation (CALL-27).** Criteria 3 and 6 are not implemented: a cancellation neither deletes a live meeting nor sends the `appointment.canceled` email (the template exists without a sender). The header comment of `apps/api/src/appointments/appointments.service.ts` still says that only the employee cancels, while the code also lets operations cancel through `bookings.coordinate`.
9. **Webinar emails.** The `webinar.recorded_notice` template for the presenters exists but is not sent.
10. **Environment (guidelines 14.2).** `VIDEO_SMOKE_ENABLED` is parsed as `true` or `false`, not with `z.coerce.boolean()`, and every video variable treats an empty value as unset.
11. **File names.** The event consumer is `apps/api/src/calls/chime-event-consumer.ts` and the calendar module `apps/api/src/calendar/ics-generator.ts`, not the names the first draft gave.
12. **Retention.** The seed also has `call_session_location_text`, and the `webinar_certificates` row is seeded ahead of its table (T-CW-3.3).
13. **WBN-26 floor events (found by the docs pass).** Commit `647f904` added the mute, unmute-request and unmute routes and emits `webinar.floor.muted`, `webinar.floor.unmuted` and `webinar.floor.unmuteRequested` through `RoomEmitter`, but `ROOM_EVENTS` in `apps/api/src/ws/ws-messages.ts` did not list them, so `checkRoomEvent` dropped every one before it was published. The coordinator ruled the name `webinar.floor.unmute_requested` (matching the audit event; renamed in `6296ffa`), and the four floor events join `ROOM_EVENTS` in the T-CW-2.3 consent commit.

## 6. Follow-ups

| Follow-up | Why | Where |
| --- | --- | --- |
| Presenter selection by `ExternalUserIds` | A presenter who joins after the capture started is not on video, because `SelectedVideoStreams.AttendeeIds` names the attendees present at the start; selecting by the presenters' participant ids would include late joiners if Chime matches them for attendees created after the pipeline | `recording.service.ts`, settled with SPIKE-CW-04 |
| `SessionsPastEnd` metric and alarm | `calls.reconcile` counts active sessions more than 20 minutes past their end and only logs a warning | `video-metrics.ts`, `video-stack.ts`, guideline 16.2 |
| Move `CrisisBlock` | It lives in `@nestself/video`; the wellbeing check-ins must use the same component when they are built | CW-R-52 |
| Set `VITE_SUPPORT_EMAIL` | The default is a placeholder on the reserved `.example` domain; a launch checklist item | `docs/environment.md` |
| Socket.IO adapter for per-socket emits across API tasks | The `room_events` relay carries room emits from any process to every task, but an emit or operation addressed to one socket reaches only the task that holds it | `apps/api/src/ws/` |
| Coordinator moderation ruling | Queue-scoped `event.moderate` never matches a webinar, so service coordinators cannot moderate, book or cancel (F-CW-07 named them as moderators) | Decision record section 11 item 1 |
| Replay handoff adapter | The finalize job writes a pending handoff row only; the CMS adapter comes with the CMS media interface, and the presenters' `webinar.recorded_notice` email with it | D-CW-03, decision record section 11 item 5 |
| Cancellation effects | Delete a live meeting on cancel and send `appointment.canceled` to both participants (CALL-27 criteria 3 and 6) | `appointments.service.ts` |
| Expert photo and credentials | A data source for `photoUrl` and `credentials` in the appointment response | Expert profile epic |
| Certificates and the load test (P1) | T-CW-3.3 and T-CW-3.4 are not started | `05-tasks.md` |
| Mobile ticket route (M4) | T-CW-4.1 is not started; SPIKE-CW-05 runs with it | `05-tasks.md` |
