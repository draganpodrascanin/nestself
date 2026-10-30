# Development backlog: consultations and webinars on Amazon Chime SDK

Epic `NS-CALLS-01`. Backlog v1.1, 24 October 2026 (restructured from the founder's answers to F-CW-01 through F-CW-10 and decisions D-CW-34 through D-CW-38).

Binding decisions in `02-decisions.md`. Canonical names (module paths, env names, constants, tables, enums, routes, actions, templates, audit events, error codes, Socket.IO rooms, Redis keys, jobs, client package, app routes, i18n namespace, sample fixtures, CDK stack) are in section 7 of that document and must be used verbatim. Research facts are cited as `(OPS-nn)`, `(WEB-nn)`, and decisions as `(D-CW-nn)`.

## Goal

Deliver the real-time layer for private 1:1 consultations, webinars (up to 250 attendees in M2, up to 1,000 with replication in M3) and small group workshops on Amazon Chime SDK. Four milestones: M0 foundation and spikes; M1 consultations end to end with the post-call follow-up and manager-approval flow; M2 webinars live up to 250 attendees, always recorded, with the chat, the floor and the replay handoff; M3 webinar scale beyond 250 (replication), certificates and the load test; M4 mobile join, workshops and replay captions. After M4, a pilot can run in the dev account with sample data.

## How to use this backlog

One task per engineer-session. Commit after every task with the trailer:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Tasks are numbered `T-CW-<milestone>.<n>`. A task's **Depends on** field names the tasks that must be merged first. Tasks without cross-dependencies within a milestone can run in parallel on different lanes.

## Global constraints

Copied from the auth phase 2 plan and extended for this epic.

1. No `pnpm install`, `pnpm add`, `npx`, `pnpm dlx`, `expo install`, `storybook init` or anything else that touches `pnpm-lock.yaml` or `node_modules`. Catalog additions are a dedicated task (T-CW-0.1) that lists exact packages and versions; the install happens once after that task merges.
2. No hex colour literal outside `packages/tokens`; components use semantic tokens only (`pnpm check` enforces).
3. Every controller route carries `@Public()`, `@Authenticated()` or `@Authorize()`. The default-deny CI test fails otherwise.
4. Every tenant table has `pgPolicy(...)` + `.enableRLS()` in the Drizzle schema and `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` appended by hand to the generated migration.
5. Every failure the user causes renders a translated message on screen (`FormErrorSummary`, `Alert` or toast); unknown codes fall back to `error.unknown`; a test asserts the message appears.
6. Translations go to all four locales (`en`, `sr-Latn`, `hu`; `sr-Cyrl` generated with `pnpm --filter @nestself/i18n build:cyrillic`, never hand-edited).
7. Sample-mode screens read fixtures from `@nestself/sample-data` (`SAMPLE_` prefix); no inline fictional data.
8. Audit `details` never contain keys named `password`, `code`, `token(s)`, `secret`, or `joinToken`.
9. A join token is never written to PostgreSQL, never logged, never placed in an audit `details` object. The join response carries `Cache-Control: no-store` (D-CW-08).
10. Every panel, sheet, drawer, dialog, toast, popover, menu, accordion, collapsible, disclosure or indicator that appears, disappears, slides, pops out or expands is animated on entry and exit per the Motion rule, with a motion suite entry in `e2e/motion/` and reduced-motion support (D-CW-22).
11. DB-backed suites need `TEST_DATABASE_URL=postgresql://nestself@localhost:54329/nestself_test` (local PostgreSQL 17, superuser `nestself`); use a new suffix per suite.
12. The parallel auth phase 2 session also edits `packages/contracts/src/actions.ts`, `templates.ts` and the schema. Tasks in this epic that touch those files go last in their milestone and rebase first.
13. Commit after every task with the attribution trailer above.
14. Attendees never send video. No task in any milestone may add a camera control to the attendee client, set video capabilities to `SendReceive` for an attendee, or allow any attendee action to turn on a camera (D-CW-35).

## Gate per task

```bash
pnpm --filter <pkg> lint && pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test
```

## Gate per milestone

```bash
pnpm verify   # lint, typecheck, test, check across every package
```

Plus the Playwright suites: `pnpm e2e`, `pnpm e2e:motion` for new components, and `pnpm e2e:auth` when auth-related routes change.

## Lanes for parallel work

| Lane | Packages and apps | Skills |
| --- | --- | --- |
| **A: API, worker, infra** | `apps/api`, `infra/cdk` | NestJS, Drizzle, CDK, AWS SDK, BullMQ, SQS |
| **B: Contracts and sample data** | `packages/contracts`, `packages/sample-data`, `packages/i18n` | Zod, i18n, fixtures |
| **C: Video client** | `packages/video` | Chime JS SDK, React hooks, `@nestself/ui` primitives |
| **D: Workspace and admin apps** | `apps/workspace`, `apps/admin` | TanStack Router/Query, api-client, `@nestself/ui` |
| **E: Mobile** | `apps/mobile` | Expo Router, `react-native-webview` |
| **F: Docs and e2e** | `e2e/`, `docs/` | Playwright, Storybook |

Within a milestone, lanes B and A can run in parallel after M0 foundation merges. Lane C depends on the API contracts from lane B and the provider adapter from lane A. Lane D depends on lanes B and C. Lane E depends on lane D (the web call route). Lane F depends on lanes C and D.

---

## M0: Foundation (8 to 14.5 person-days)

**Definition of done.** The catalog additions are listed (not installed). The `video` module compiles with `FakeVideoProvider` returning stubs. The CDK video stack synthesizes with cdk-nag green. The eight spikes have scripts and instructions in `research/07-spikes.md`. The appointment spine has a table with RLS (including the `follow_up_of` column and the full status enum with `proposed`, `awaiting_approval`, `declined`), a module with CRUD, a supertest suite, and the default-deny test passes. Contract constants, enums and schemas for appointments (including follow-up request schemas) and call sessions exist. Sample fixtures for appointments (including one `proposed` and one `awaiting_approval` follow-up) and webinars are in `packages/sample-data`. The `calls` i18n namespace skeleton exists in four locales with `followUp.*` and `approval.*` keys.

**Demo script.** `pnpm verify` passes. `pnpm --filter @nestself/api test -- appointments` runs the supertest suite. `pnpm --filter @nestself/cdk test` synthesizes `NestSelf-dev-Video` without violations.

---

### T-CW-0.1: Catalog additions

**Goal.** List every new dependency with its pinned version so a single `pnpm install` can land them all.

**Depends on.** Nothing.

**Stories.** PLT-09 (fake provider), PLT-13 (smoke test).

**Files.**
- Modify: `pnpm-workspace.yaml` (catalog section)

**Steps.**
1. Add to the `catalog:` section of `pnpm-workspace.yaml`, after the existing `@aws-sdk/client-ses` line (D-CW-32):
   - `"@aws-sdk/client-chime-sdk-meetings": 3.1155.0`
   - `"@aws-sdk/client-chime-sdk-media-pipelines": 3.1155.0`
   - `"@aws-sdk/client-sqs": 3.1155.0`
   - `"amazon-chime-sdk-js": 3.32.0`
   - `"aws-sdk-client-mock": 4.1.0` (dev dependency)
2. Add under the Expo section for M4: `"react-native-webview": 13.12.5` (version from `npm view react-native-webview@latest version` at catalog-update time; pin the actual latest at the time of the task).
3. Do not run `pnpm install`. The task output is the diff to the catalog only.
4. Comment each entry with its purpose and the decision that requires it.
5. End the task with a request to the repository owner to run `pnpm install` once the parallel sessions are idle. Every task that imports the new packages waits for that install (no type stubs).

**Tests.** `pnpm-workspace.yaml` is valid YAML (the existing `pnpm verify` parses it).

**Gate.** `pnpm verify` (no install needed for a catalog-only change).

**Estimate.** 0.25 to 0.5 person-days.

**Commit message.** `chore(catalog): list Chime SDK and video dependencies for NS-CALLS-01`

---

### T-CW-0.2: Video provider adapter and env schema

**Goal.** Create the `video` module with `VideoProvider`, `ChimeVideoProvider` and `FakeVideoProvider`, and add video env vars to the validation schema.

**Depends on.** T-CW-0.1 (catalog listed and `pnpm install` completed by the repository owner).

**Stories.** CALL-20, PLT-02, PLT-09.

**Files.**
- Create: `apps/api/src/video/video-provider.ts`, `apps/api/src/video/chime-video-provider.ts`, `apps/api/src/video/fake-video-provider.ts`, `apps/api/src/video/video.module.ts`, `apps/api/src/video/video-provider.test.ts`
- Modify: `apps/api/src/config/env.ts` (add `VIDEO_PROVIDER`, `CHIME_REGION`, `CHIME_EVENTS_QUEUE_URL`, `CHIME_EVENTS_QUEUE_ARN`, `RECORDINGS_BUCKET`, `VIDEO_SMOKE_ENABLED`), `apps/api/src/config/env.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `VideoModule`)

**Steps.**
1. Define the abstract class `VideoProvider` with methods that take input objects per the guidelines: `createSession(input: CreateSessionInput): Promise<ProviderSession>`, `createParticipant(input: CreateParticipantInput): Promise<ProviderParticipant>`, `updateParticipantCapabilities(input: UpdateCapabilitiesInput): Promise<void>`, `removeParticipant(input: RemoveParticipantInput): Promise<void>`, `endSession(input: EndSessionInput): Promise<void>`, `startRecording(input: StartRecordingInput): Promise<ProviderRecording>`, `stopRecording(input: StopRecordingInput): Promise<void>`, `describeSession(input: DescribeSessionInput): Promise<ProviderSession | null>`. Use the injection token `VIDEO_PROVIDER`.
2. Implement `ChimeVideoProvider` wrapping `ChimeSDKMeetingsClient` from `@aws-sdk/client-chime-sdk-meetings` and `ChimeSDKMediaPipelinesClient` from `@aws-sdk/client-chime-sdk-media-pipelines`. Hard-code `MediaRegion: 'eu-central-1'` (D-CW-06). Set `ExternalUserId` to the participant id (D-CW-11).
3. Implement `FakeVideoProvider` returning deterministic stubs with fake meeting ids (`fake-meeting-{uuid}`) and fake join tokens (`fake-token-{uuid}`). Emit the same domain event shapes through an in-process event emitter (D-CW-05, D-CW-12).
4. In `VideoModule`, register the provider selected by `VIDEO_PROVIDER` env var (`none` selects `FakeVideoProvider`, `chime` selects `ChimeVideoProvider`). Default to `none`.
5. Add env vars to `envSchema` in `apps/api/src/config/env.ts` (`optionalUrl` and `optionalString` are Zod values, not functions; do not add parentheses):
   ```typescript
   VIDEO_PROVIDER: z.enum(['none', 'chime']).default('none'),
   CHIME_REGION: z.literal('eu-central-1').optional(),
   CHIME_EVENTS_QUEUE_URL: optionalUrl,
   CHIME_EVENTS_QUEUE_ARN: optionalString,
   RECORDINGS_BUCKET: optionalString,
   VIDEO_SMOKE_ENABLED: z.coerce.boolean().default(false),
   ```
6. Add a `superRefine` check: when `VIDEO_PROVIDER === 'chime'`, require `CHIME_REGION` to be present (it already only accepts `eu-central-1`), and require `CHIME_EVENTS_QUEUE_URL` and `CHIME_EVENTS_QUEUE_ARN`.
7. Write unit tests in `video-provider.test.ts` using `aws-sdk-client-mock` (OPS-31): `ChimeVideoProvider.createSession` calls `CreateMeetingWithAttendeesCommand` with the correct `MediaRegion`; `FakeVideoProvider.createSession` returns a stub with stable fields; env validation rejects `CHIME_REGION=us-east-1`.

**Tests.** `apps/api/src/video/video-provider.test.ts`, `apps/api/src/config/env.spec.ts` (extended).

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 1 to 2 person-days.

**Commit message.** `feat(api): video provider adapter with Chime and fake implementations`

---

### T-CW-0.3: CDK video stack

**Goal.** Create `infra/cdk/lib/video-stack.ts` with the SQS queue, DLQ, EventBridge rule, recordings bucket, IAM policies and cdk-nag suppressions (D-CW-31).

**Depends on.** Nothing (the CDK stack does not import any catalog packages).

**Stories.** PLT-09 (infrastructure).

**Files.**
- Create: `infra/cdk/lib/video-stack.ts`, `infra/cdk/test/video-stack.test.ts`
- Modify: `infra/cdk/bin/app.ts` (instantiate `NestSelf-dev-Video` for the dev stage alongside `NestSelf-dev-Auth`), `infra/cdk/test/nag.test.ts` (add video stack to the nag suite), `infra/cdk/scripts/env-from-outputs.mjs` (read the new outputs)

**Steps.**
1. Create `NestSelfVideoStack` exporting: `chimeEventsQueue` (SQS, KMS on `platformKey`, visibility timeout 60 s, DLQ after 5 receives), `chimeEventsDlq` (SQS, KMS), `recordingsBucket` (S3, SSE-KMS on `platformKey`, block public access, lifecycle rule expiring objects under `raw/` after 30 days), two `iam.ManagedPolicy` resources: `VideoApiPolicy` (meeting CRUD actions on `Resource: '*'` with `NagSuppressions.addResourceSuppressions` for `AwsSolutions-IAM5` reason "Chime SDK meetings actions do not support resource-level permissions"), `VideoWorkerPolicy` (queue consume, media pipeline actions, bucket put/get/list, concatenation).
2. Add an EventBridge rule: `source: ['aws.chime']`, `detailType: ['Chime Meeting State Change']`, target the `chimeEventsQueue` (D-CW-12, OPS-09).
3. Add a queue resource policy granting `sqs:SendMessage` and `sqs:GetQueueUrl` to `meetings.chime.amazonaws.com` with `aws:SourceAccount` and `aws:SourceArn` conditions (OPS-16).
4. Add a bucket policy for `mediapipelines.chime.amazonaws.com` with `s3:PutObject` and `s3:PutObjectAcl`, conditions `aws:SourceAccount` and `aws:SourceArn` (WEB-27).
5. Export CloudFormation outputs: `ChimeEventsQueueUrl`, `ChimeEventsQueueArn`, `RecordingsBucketName`, `VideoApiPolicyArn`, `VideoWorkerPolicyArn`.
6. In `bin/app.ts`, instantiate `NestSelf-dev-Video` when `stage === 'dev'` (alongside `NestSelf-dev-Auth`). For the dev stage, where no security baseline stack exists, create a `new kms.Key(this, 'VideoKey', { enableKeyRotation: true })` inside the video stack and use it as the `platformKey`. For staging and production, receive the platform key from the security baseline stack.
7. In `env-from-outputs.mjs`, add output readers for the five new outputs, printing `CHIME_EVENTS_QUEUE_URL`, `CHIME_EVENTS_QUEUE_ARN`, `RECORDINGS_BUCKET`.
8. Write `video-stack.test.ts`: synthesize `NestSelfVideoStack` with a test config, assert assembly is defined. Add the video stack to the nag test suite in `nag.test.ts`.

**Tests.** `infra/cdk/test/video-stack.test.ts`, `infra/cdk/test/nag.test.ts` (extended).

**Gate.** `pnpm --filter @nestself/cdk lint && pnpm --filter @nestself/cdk typecheck && pnpm --filter @nestself/cdk test`

**Estimate.** 1.5 to 2.5 person-days.

**Commit message.** `feat(cdk): video stack with Chime events queue, recordings bucket and IAM policies`

---

### T-CW-0.4: Spikes

**Goal.** Write the eight spike scripts and document results in `research/07-spikes.md` (D-CW-07, D-CW-08, D-CW-10, D-CW-18, D-CW-24, D-CW-14, D-CW-12, D-CW-33).

**Depends on.** T-CW-0.1 (`pnpm install` completed), T-CW-0.3 (video stack deployed to dev for queue ARN). The stack must be deployed to the dev account before running the scripts.

**Stories.** PLT-13 (smoke test feasibility).

**Files.**
- Create: `apps/api/scripts/spikes/spike-cw-01-client-request-token.ts`, `spike-cw-02-external-user-id.ts`, `spike-cw-03-pipeline-attendee-count.ts`, `spike-cw-04-selected-video-streams.ts`, `spike-cw-05-mobile-webview.ts` (instructions only), `spike-cw-06-replica-audio.ts` (M3 placeholder, run at the start of M3 before replication is built), `spike-cw-07-sqs-latency.ts`, `spike-cw-08-playwright-ci.ts`
- Create: `docs/tasks/calls-webinars/research/07-spikes.md`

**Steps.**
1. SPIKE-CW-01: script calls `CreateMeetingWithAttendees` twice with the same `ClientRequestToken`, 0 ms and 2 s apart. Record whether the second call returns the same meeting, a `ConflictException`, or a new meeting (OPS-01).
2. SPIKE-CW-02: script calls `CreateAttendee` twice with the same `ExternalUserId` on the same meeting. Record whether it returns the same attendee (OPS open question 2).
3. SPIKE-CW-03: create a meeting with `MaxCount: 2`, create two attendees, start a capture pipeline. Record whether the pipeline attendee counts against `MaxCount` and whether it keeps the meeting alive past 5 empty minutes (OPS-42).
4. SPIKE-CW-04: record a 3-minute test webinar with one presenter and two receive-only attendees. Use `SelectedVideoStreams` filtered to the presenter's attendee id and `CompositedVideo` layout `PresenterOnly`. Verify the output MP4 contains only the presenter (WEB open question 3).
5. SPIKE-CW-05: instructions for opening the web call route in `react-native-webview` in the "NestSelf iPhone" simulator and one physical Android device (D-CW-24).
6. SPIKE-CW-06: placeholder for M3 (replica audio dropout, WEB-39). The script will be run at the start of M3 before replication is built: a replica meeting, an attendee given the floor, a 60-minute soak.
7. SPIKE-CW-07: send 20 events through both direct SQS (`NotificationsConfiguration`) and EventBridge, compare timestamps (D-CW-12).
8. SPIKE-CW-08: prototype two Playwright Chromium contexts joining one real meeting with `--use-fake-device-for-media-stream` (OPS-32, OPS-33).
9. Document all results in `research/07-spikes.md` with the spike id, question, method, result, and any binding change.

**Tests.** Scripts are manual; no automated test.

**Gate.** Scripts parse (`tsx --check`); `07-spikes.md` exists and is valid Markdown.

**Estimate.** 2 to 4 person-days.

**Commit message.** `docs(spikes): Chime SDK spike scripts and results for NS-CALLS-01`

---

### T-CW-0.5: Contracts for appointments and call sessions

**Goal.** Add constants, enums, Zod schemas and error codes to `packages/contracts` for the appointment spine (including follow-up request schemas and the full status lifecycle), call sessions and webinar messages.

**Depends on.** Nothing.

**Stories.** CALL-29, CALL-30, CALL-31, CALL-35, CALL-36, CALL-37, CALL-38, CALL-39.

**Files.**
- Create: `packages/contracts/src/appointments.ts` (appointment schemas, status enum, seam fields, follow-up request schemas)
- Create: `packages/contracts/src/calls.ts` (session constants including `WEBINAR_HOST_JOIN_BEFORE_MINUTES`, call schemas, `CALL_ERROR_CODES`)
- Modify: `packages/contracts/src/actions.ts` (add `'event.manage'`, `'event.moderate'` and `'event.present'` to `ACTIONS`). **Rebase first**: the auth phase 2 session also edits this file.
- Modify: `packages/contracts/src/templates.ts` (add `event.present` to `expert`; add `event.manage` to `content_publisher`, `platform_owner`, `client_operations`; add `event.moderate` to `service_coordinator`, `platform_owner`, `client_operations`). **Rebase first.**
- Modify: `packages/contracts/src/index.ts` (re-export `appointments.ts` and `calls.ts`)
- Modify: `apps/api/src/audit/audit-events.ts` (append all audit events from decision record section 7, including `appointment.approval.missing_approver`, to `AUDIT_ACTIONS`; extend `categoryFor`)
- Modify: `apps/api/src/audit/audit-writer.ts` (add `joinToken` and `JoinToken` to `FORBIDDEN_KEYS`)
- Create: `packages/contracts/src/appointments.test.ts`, `packages/contracts/src/calls.test.ts`
- Create: `apps/api/src/audit/audit-events.test.ts` (forbidden-key test)

**Steps.**
1. Define appointment schemas and the seam fields in `appointments.ts`: `AppointmentCreateRequestSchema` (orgId, expertUserId, employeeUserId, startsAt, endsAt, serviceCategory, timeZone, fundingRef?), `AppointmentResponseSchema`, `AppointmentListResponseSchema`, `AppointmentStatus` enum as Zod union (`proposed`, `awaiting_approval`, `confirmed`, `completed`, `canceled`, `declined`, `no_show`). Include the seam fields: `id`, `orgId`, `expertUserId`, `employeeUserId`, `startsAt`, `endsAt`, `status`, `serviceCategory`, `timeZone`, `followUpOf`. Define follow-up request schemas: `FollowUpProposeRequestSchema` (date, time, duration, note?), `FollowUpConfirmRequestSchema`, `FollowUpSuggestTimesRequestSchema` (up to three windows, each with startsAt and endsAt), `FollowUpScheduleRequestSchema` (selectedWindowIndex), `FollowUpDeclineRequestSchema`.
2. Define call session constants and schemas in `calls.ts`:
   ```typescript
   export const CALL_JOIN_WINDOW_BEFORE_MINUTES = 15;
   export const CALL_JOIN_WINDOW_AFTER_MINUTES = 10;
   export const CALL_ROOM_CLOSE_AFTER_MINUTES = 15;
   export const WEBINAR_HOST_JOIN_BEFORE_MINUTES = 30;
   export const WEBINAR_SINGLE_MEETING_CAPACITY = 250;
   export const WORKSHOP_CAPACITY = 25;
   export const REMINDER_OFFSETS_MINUTES = [1440, 60] as const;
   export const CALL_TICKET_TTL_SECONDS = 30;
   ```
   Define the remaining enums as Zod unions: `CallSessionStatus` (`pending`, `creating`, `active`, `ended`, `failed`), `CallParticipantRole` (`expert`, `employee`, `presenter`, `moderator`, `attendee`, `facilitator`, `participant`), `CallFormat` (`consultation`, `webinar`, `workshop`), `CallOutcomeStatus` (`completed`, `no_show_employee`, `no_show_expert`, `technical_failure`, `canceled`), `RecordingStatus` (`scheduled`, `recording`, `processing`, `ready`, `handed_off`, `failed`), `WebinarMessageKind` (`host`, `attendee`, `question`), `WebinarMessageStatus` (`pending`, `published`, `answered`, `dismissed`). Define `CallJoinResponseSchema`, `CallOutcomeRequestSchema`, `CallFeedbackRequestSchema`, `ClientEventRequestSchema`, `DiagnosticsResponseSchema` (exactly the 4.7.5 fields, D-CW-28). Create the `CALL_ERROR_CODES` array (`join_window_closed`, `appointment_not_joinable`, `appointment_not_proposed`, `follow_up_not_allowed`, `approval_not_pending`, `video_provider_unavailable`, `webinar_full`, `webinar_not_open`, `registration_closed`, `already_registered`, `not_eligible`, `floor_not_available`, `recording_not_allowed`, `capacity_above_limit`, `invalid_ticket`) and merge it into the exported error-code union. Do not put these codes in `AUTH_ERROR_CODES`.
3. Add `event.manage`, `event.moderate` and `event.present` to `ACTIONS`. Update the template actions arrays in `templates.ts` per the decision record section 7 (templates table): `expert` gains `event.present`; `content_publisher` gains `event.manage`; `platform_owner` and `client_operations` gain `event.manage` and `event.moderate`; `service_coordinator` gains `event.moderate` only (not `event.manage`).
4. Append every audit event from decision record section 7 to `AUDIT_ACTIONS` in `apps/api/src/audit/audit-events.ts`: `appointment.created`, `appointment.canceled`, `appointment.completed`, `appointment.no_show`, `appointment.follow_up.proposed`, `appointment.confirmed`, `appointment.declined`, `appointment.times_suggested`, `appointment.approval.requested`, `appointment.approval.approved`, `appointment.approval.rejected`, `appointment.approval.expired`, `appointment.approval.missing_approver` (new, covers the case where no approval authority matches the employee's unit; the proposal fails visibly and the event is audited as a note), `org.follow_up_policy.changed`, `call.session.created`, `call.joined`, `call.ended`, `call.outcome.recorded`, `call.feedback.submitted`, `call.diagnostics.viewed`, `call.ticket.issued`, and all `webinar.*` events from section 7. Extend `categoryFor` with prefix handlers: `appointment.` maps to ADMIN, `call.` maps to CONTENT_ACCESS except `call.outcome.recorded` maps to FINANCIAL and `call.diagnostics.viewed` and `call.ticket.issued` map to SECURITY, `webinar.` maps to ADMIN for management events and CONTENT_ACCESS for the rest.
5. Add `joinToken` and `JoinToken` to the `FORBIDDEN_KEYS` set in `apps/api/src/audit/audit-writer.ts`. Write a test asserting that `sanitizeDetails({ joinToken: 'x', JoinToken: 'y', meetingId: 'z' })` strips both token keys and keeps `meetingId`.
6. Export everything from `index.ts`.
7. Write tests: each schema accepts a valid input and rejects missing required fields; each constant has the expected value; the follow-up schemas accept valid windows and reject more than three; error codes are in the `CALL_ERROR_CODES` array; `categoryFor` returns the correct category for every new audit action.

**Tests.** `packages/contracts/src/appointments.test.ts`, `packages/contracts/src/calls.test.ts`.

**Gate.** `pnpm --filter @nestself/contracts lint && pnpm --filter @nestself/contracts typecheck && pnpm --filter @nestself/contracts test`

**Estimate.** 1 to 1.5 person-days.

**Commit message.** `feat(contracts): appointment and call session schemas, constants and error codes`

---

### T-CW-0.6: Appointment spine (table, RLS, module, routes, audit, supertest)

**Goal.** Create the `appointments` table with forced RLS (including the `follow_up_of` column and the full status enum), the `appointments` module with CRUD routes, audit, and a supertest suite including authorization golden cases.

**Depends on.** T-CW-0.5 (contracts).

**Stories.** CALL-18, CALL-26, CALL-27, CALL-28, CALL-29, CALL-42.

**Files.**
- Create: `apps/api/src/db/schema/appointments.ts` (export from `schema/index.ts`)
- Create migration via `db:generate` using the next free number (existing migrations are 0000 through 0004; check `apps/api/drizzle/` at task time), then hand-edit to append `FORCE ROW LEVEL SECURITY`
- Create: `apps/api/src/appointments/appointments.module.ts`, `appointments.controller.ts`, `appointments.service.ts`, `appointments.repository.ts`, `appointment-mapper.ts`
- Create: `apps/api/src/appointments/appointment.resolver.ts` (custom `@Authorize` resolver)
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/db/schema/index.ts`, `apps/api/src/db/schema/enums.ts` (add `appointmentStatus` and `appointmentApprovalStatus` pgEnums)
- Create: `apps/api/test/appointments.e2e.spec.ts` (suffix `appointments`)

**Steps.**
1. Add `appointmentStatus` enum to `enums.ts`: `['PROPOSED', 'AWAITING_APPROVAL', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'DECLINED', 'NO_SHOW']`. Add `appointmentApprovalStatus` enum: `['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']`. PostgreSQL enum values are upper case; the lower-case spellings (`proposed`, `confirmed`) are the contract spellings, mapped once in the repository layer.
2. Define the `appointments` table in `appointments.ts` using the plain-object `pgTable` form (no callback; `idColumn()`, `ts()`, `createdAt()`, `updatedAt()` take no arguments):
   ```typescript
   export const appointments = pgTable('appointments', {
     id: idColumn(),
     orgId: text().notNull().references(() => organizations.id, { onDelete: 'restrict' }),
     expertUserId: text().notNull().references(() => users.id, { onDelete: 'restrict' }),
     employeeUserId: text().notNull().references(() => users.id, { onDelete: 'restrict' }),
     startsAt: ts().notNull(),
     endsAt: ts().notNull(),
     status: appointmentStatus().notNull().default('CONFIRMED'),
     serviceCategory: text().notNull(),
     timeZone: text().notNull().default('Europe/Belgrade'),
     fundingRef: text(),
     followUpOf: text().references((): AnyPgColumn => appointments.id, { onDelete: 'set null' }),
     createdAt: createdAt(),
     updatedAt: updatedAt(),
   }).enableRLS();
   ```
   Add the `pgPolicy` for tenant isolation using `tenantPredicate(appointments.orgId)` in a separate call.
3. Generate the migration with `db:generate`. Hand-edit: append `ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;`.
4. Create a custom resolver `appointmentResource` in `apps/api/src/appointments/appointment.resolver.ts` (or `apps/api/src/authz/resolvers.ts`) that loads the appointment by `req.params.id` to derive `orgId` and the resource. When the appointment is not found, return a not-found resource so the guard answers 404. Use `orgResourceFromContext('appointment')` only for `POST /orgs/:orgId/appointments`.
5. Implement `AppointmentsController` at `@Controller('appointments')` with routes (D-CW-02):
   - `GET /appointments` with `@Authorize(ACTIONS['consultation.join'], appointmentResource)`: list for the current user (employee sees own, expert sees assigned).
   - `GET /appointments/:id` with `@Authorize(ACTIONS['consultation.join'], appointmentResource)`.
   - `POST /orgs/:orgId/appointments` with `@Authorize(ACTIONS['appointment.propose'], orgResourceFromContext('appointment'))`: create. This is the only route that uses `orgResourceFromContext`.
   - `POST /appointments/:id/cancel` with `@Authorize(ACTIONS['appointment.cancel'], appointmentResource)`.
6. Implement `AppointmentsService` with `DbService.withOrgScope`, `AuditWriter.record` for events `appointment.created`, `appointment.canceled`. Status transitions: only `CONFIRMED` can be canceled.
7. Write the supertest suite: create an appointment as an expert, list as the employee, cancel as the employee, verify 404 for a non-participant, verify the default-deny test passes with the new controller. Verify that a `proposed` appointment shows in the list for both participants.

**Tests.** `apps/api/test/appointments.e2e.spec.ts`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 1.5 to 2.5 person-days.

**Commit message.** `feat(api): appointment spine with RLS, CRUD routes and authorization golden cases`

---

### T-CW-0.7: Sample fixtures and i18n namespace

**Goal.** Create sample appointment and webinar fixtures in `packages/sample-data` and the `calls` i18n namespace skeleton in four locales, including `followUp.*` and `approval.*` keys and the renamed `SAMPLE_WEBINAR_MESSAGES` fixture.

**Depends on.** T-CW-0.5 (contracts for types).

**Stories.** PLT-08, PLT-17.

**Files.**
- Create: `packages/sample-data/src/fixtures/appointments.ts`, `packages/sample-data/src/fixtures/webinars.ts`
- Modify: `packages/sample-data/src/index.ts` (re-export)
- Modify: `apps/api/src/db/seed/retention-policies.ts` (add retention policies for the new tables)
- Modify: `apps/api/src/db/seed/seed-lib.ts` (import and insert the new `SAMPLE_` fixtures)
- Create: `packages/i18n/locales/en/calls.json`, `packages/i18n/locales/sr-Latn/calls.json`, `packages/i18n/locales/hu/calls.json`
- Run: `pnpm --filter @nestself/i18n build:cyrillic` to generate `sr-Cyrl/calls.json`

**Steps.**
1. Create `SAMPLE_APPOINTMENTS` in `appointments.ts`: an array of 5 appointments (one confirmed upcoming, one completed, one canceled, one with status `proposed` and `followUpOf` set to the completed appointment, one with status `awaiting_approval` and `followUpOf` set to the completed appointment) with fields matching the contract schema. Use fictional first names only, no invented statistics or promises (content rule). Mark `sample: true`.
2. Create `SAMPLE_CALL_SESSIONS`: one completed session linked to the completed appointment, with mock outcome and feedback.
3. Create `SAMPLE_WEBINARS`: two webinars (one published upcoming, one ended). Create `SAMPLE_WEBINAR_MESSAGES` (5 messages: 2 host messages, 2 attendee messages in mixed statuses including one published, 1 question) and `SAMPLE_WEBINAR_POLLS` (one poll with 3 options).
4. Export all from `index.ts`.
5. Seed the D-CW-29 retention defaults for the new tables in `apps/api/src/db/seed/retention-policies.ts`: `appointments` and `call_sessions`/`call_participants`/`call_events`/`call_outcomes` at 7 years (FINANCIAL), `appointment_approvals` at 7 years, `call_client_events` at 90 days, `call_feedback` at 24 months, `call_messages` at 24 hours, `webinar_messages` at 12 months, `webinar_recordings` segments at 30 days.
6. Import and insert the new `SAMPLE_` fixtures in `apps/api/src/db/seed/seed-lib.ts`. The seed imports each `SAMPLE_` fixture explicitly (not auto-discovered); add `SAMPLE_APPOINTMENTS`, `SAMPLE_CALL_SESSIONS`, `SAMPLE_WEBINARS`, `SAMPLE_WEBINAR_MESSAGES`, `SAMPLE_WEBINAR_POLLS` to the import list and upsert them into the corresponding tables.
7. Create the `calls` i18n namespace skeleton in `en/calls.json` with top-level keys: `consultation.*` (join, leave, end, waiting, reconnecting, connectionLost, sessionEnded, fiveMinutesRemaining), `followUp.*` (proposed, confirm, suggestTimes, decline, schedule, awaitingApproval, approved, rejected, reminderSubject, proposedEmailSubject, proposedEmailBody), `approval.*` (pending, approved, rejected, expired, decide, reason, missingApprover, remind, policyAutomatic, policyManagerApproval), `webinar.*` (register, unregister, join, lobby, started, ended, recording, recordingNotice, recordingNoticeFloor, messageSubmitted, messagePublished, floorGiven, floorTaken, youCanSpeakNow, capacityAboveLimit), `workshop.*`, `prejoin.*` (checkingDevices, cameraOff, joinNow, permissionHelp), `errors.*` (one key per error code from T-CW-0.5: `joinWindowClosed`, `appointmentNotJoinable`, `appointmentNotProposed`, `followUpNotAllowed`, `approvalNotPending`, `floorNotAvailable`, `capacityAboveLimit` and the remaining codes, plus `unknown`), `email.*` (reminderSubject, registrationSubject, followUpProposedSubject).
8. Copy to `sr-Latn/calls.json` and `hu/calls.json` with placeholder translations (the Latin catalogs are drafts pending native speaker review per CLAUDE.md).
9. Run `pnpm --filter @nestself/i18n build:cyrillic`.

**Tests.** Fixture shape tests in `packages/sample-data/src/fixtures/appointments.test.ts` and `webinars.test.ts` asserting each fixture matches the contract schema and has the `sample: true` flag. A seed smoke test in `apps/api/src/db/seed/seed-lib.test.ts` asserting the new rows are upserted (run against the test database). `pnpm --filter @nestself/i18n check` (locale parity).

**Gate.** `pnpm --filter @nestself/sample-data lint && pnpm --filter @nestself/sample-data typecheck && pnpm --filter @nestself/sample-data test && pnpm --filter @nestself/i18n check`

**Estimate.** 0.75 to 1.5 person-days.

**Commit message.** `feat(data): sample appointments, webinars and calls i18n namespace skeleton`

---

## M1: Consultations end to end (27.5 to 42.5 person-days)

**Definition of done.** An expert and an employee can join a consultation through `POST /appointments/:id/join` against `FakeVideoProvider`. The join creates a call session, the rejoin returns cached credentials, concurrent first joins create one meeting, the outcome and feedback routes work, the client events route stores diagnostics, the cleanup and reconcile jobs run, reminders are scheduled, the `packages/video` package has `PreJoinCheck`, `CallStage`, `ControlBar`, `SessionTimer` and `FollowUpCard` with unit tests and Storybook stories, the workspace and admin apps have appointment list, detail and call routes, Playwright journeys pass with fake media. The expert can propose a follow-up after recording a `completed` outcome, the employee can confirm, suggest alternative times or decline, and the follow-up email goes out. When the organisation's `follow_up_approval_policy` is `MANAGER_APPROVAL`, confirming creates an approval item routed to the approval authority whose `orgUnitId` (with `includeDescendants`) covers the employee's unit and whose `categories` are empty or contain `consultation_follow_up`; the approver sees only the employee name, "follow-up session with a NestSelf expert", the date and the duration. HR can toggle the policy. `pnpm verify` is green.

**Demo script.** Start the API in stub mode, create an appointment through the seed, call `POST /appointments/:id/join` as the expert and employee, verify the response, call `POST /appointments/:id/outcome`, verify feedback. Open the workspace app, navigate to appointments, open the detail, click join (fake video renders). Open the admin app, navigate to consultations, view the outcome. End the call, record outcome `completed`, propose a follow-up, confirm as the employee, verify appointment status `confirmed`. Toggle the policy to `MANAGER_APPROVAL`, propose again, confirm, verify status `awaiting_approval` and the approval item visible to the approver.

---

### T-CW-1.1: Call session schema, join, end, outcome, feedback, signal, client events, diagnostics

**Goal.** Create the `call_sessions`, `call_participants`, `call_events`, `call_client_events`, `call_outcomes`, `call_feedback`, `call_consents` (schema only) tables with RLS, and the `calls` module with the full route set.

**Depends on.** T-CW-0.2, T-CW-0.5, T-CW-0.6.

**Stories.** CALL-02, CALL-06, CALL-07, CALL-15, CALL-17, CALL-20, CALL-21, CALL-23, CALL-24, CALL-34, PLT-01, PLT-03, PLT-05, PLT-06, PLT-14, PLT-15, PLT-18.

**Files.**
- Create: `apps/api/src/db/schema/calls.ts` (export from `schema/index.ts`)
- Create migration via `db:generate` using the next free number (check `apps/api/drizzle/` at task time), hand-edit FORCE RLS for all 7 tables
- Create: `apps/api/src/calls/calls.module.ts`, `calls.controller.ts`, `calls.service.ts`, `calls.repository.ts`, `call-mapper.ts`, `calls.service.test.ts`
- Modify: `apps/api/src/db/schema/enums.ts` (add `callSessionStatus`, `callParticipantRole`, `callFormat`, `callOutcomeStatus`, `recordingStatus` pgEnums)
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/db/schema/index.ts`
- Create: `apps/api/test/calls.e2e.spec.ts` (suffix `calls`)

**Steps.**
1. Define tables `call_sessions`, `call_participants`, `call_events`, `call_client_events`, `call_outcomes`, `call_feedback`, `call_consents` in `calls.ts` per D-CW-25 using the plain-object `pgTable` form. All appointment-side tables carry `orgId` with `tenantPredicate`. `call_sessions` carries both the scheduled window (`startsAt`, `endsAt`) and the actual `startedAt` (nullable timestamp, set when the session transitions to `active`) and `endedAt`. Enum values in the schema are upper case; the lower-case contract spellings are mapped in the repository. `call_consents` is schema only (D-CW-19).
2. Implement `CallsService.join(appointmentId, principal)`:
   - Check appointment exists and is `CONFIRMED`, else 409 `appointment_not_joinable`.
   - Check principal is `expertUserId` or `employeeUserId`, else 404 (non-disclosure, D-CW-30).
   - Check time window: `now >= startsAt - 15 min` and `now <= endsAt + 10 min`, else 403 `join_window_closed` (D-CW-07).
   - Acquire lock `call:{sessionId}:create` with `KeyValueStore.set(key, value, { onlyIfAbsent: true, ttlSeconds: 30 })`.
   - If lock acquired: call `VideoProvider.createSession` with format `consultation`, then `createParticipant`. Cache credentials in Redis key `call:{sessionId}:participant:{participantId}` with TTL until `endsAt + 15 min` (D-CW-08).
   - If lock not acquired: poll `call_sessions.provider_meeting_id` up to 3 seconds, then `createParticipant`.
   - Return credentials with `Cache-Control: no-store`. Audit `call.joined`.
3. Implement `CallsService.end(appointmentId, principal)`: only the expert can end. Call `VideoProvider.endSession`. Audit `call.ended`.
4. Implement outcome, feedback, signal (Socket.IO emit to `call:{sessionId}`), client events (store in `call_client_events`), diagnostics (D-CW-28).
5. Write a serialisation test for the diagnostics DTO asserting it has no field beyond the 4.7.5 set.
6. Write the supertest suite: join as expert and employee, concurrent first joins create one meeting (two requests, one lock winner), rejoin returns identical credentials, non-participant gets 404, outside window gets 403, canceled appointment gets 409, employer-scoped principal gets 404 on every route.

**Tests.** `apps/api/src/calls/calls.service.test.ts`, `apps/api/test/calls.e2e.spec.ts`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 3.5 to 5 person-days.

**Commit message.** `feat(api): calls module with join, end, outcome, feedback, diagnostics and authorization golden cases`

---

### T-CW-1.2: SQS consumer, event applier, cleanup and reconcile jobs

**Goal.** Implement the SQS consumer in the worker process, the idempotent event applier, and the `calls.cleanup`, `calls.reconcile`, `appointment.remind` and `calls.no_show_followup` jobs.

**Depends on.** T-CW-1.1.

**Stories.** CALL-01, CALL-07, PLT-04, PLT-12.

**Files.**
- Create: `apps/api/src/calls/chime-event-consumer.ts`, `apps/api/src/calls/event-applier.ts`, `apps/api/src/calls/event-applier.test.ts`
- Create: `apps/api/src/jobs/calls-job-scheduler.service.ts` (dedicated `CallsJobSchedulerService`)
- Modify: `apps/api/src/worker/main.ts` (start the SQS consumer and the calls job scheduler)

**Steps.**
1. Create `CallsJobSchedulerService` in `apps/api/src/jobs/calls-job-scheduler.service.ts` with its own `Queue` and `Worker` on a dedicated BullMQ queue `nestself-calls`. For per-entity delayed jobs (`calls.cleanup`, `appointment.remind`, `calls.no_show_followup`), use `queue.add(name, data, { delay, jobId })` where `jobId` makes rescheduling idempotent and lets a cancellation remove the job by id. For the `calls.reconcile` cron, use `queue.upsertJobScheduler`. This is separate from the existing `JobSchedulerService` which handles the `nestself-maintenance` queue.
2. Implement `ChimeEventsConsumer` as its own `ReceiveMessage` long-polling loop (not a BullMQ job): `@aws-sdk/client-sqs` `ReceiveMessageCommand` with `WaitTimeSeconds: 20`, `VisibilityTimeout: 60`, `MaxNumberOfMessages: 10`. Parse the message body as a Chime event. Pass to `EventApplier`. Start it alongside `JobSchedulerService.start()` in `apps/api/src/worker/main.ts` with graceful shutdown (stop the loop and wait for in-flight messages on SIGTERM).
3. Implement `EventApplier.apply(event)`: write to `call_events` with unique key `(provider_meeting_id, event_type, provider_attendee_id, occurred_at)`. Drop duplicates. Apply state changes out of order: `AttendeeJoined` sets `first_joined_at` only if null, `AttendeeLeft`/`AttendeeDropped` set `last_left_at` to max, `MeetingEnded` closes the session once (D-CW-12, OPS-12, OPS-15).
4. Write idempotency tests: the same event applied twice produces one row. Out-of-order `AttendeeLeft` before `AttendeeJoined` still sets both timestamps correctly.
5. Implement `calls.cleanup` as a BullMQ delayed job per session at `endsAt + 15 min`: check `VideoProvider.describeSession`; if still active, call `endSession` (D-CW-09, OPS-42).
6. Implement `calls.reconcile` every 5 minutes: find sessions in `active` status with `endsAt + 15 min` past, attempt cleanup (D-CW-09).
7. Implement `appointment.remind` as a delayed job per appointment at each `REMINDER_OFFSETS_MINUTES` offset (D-CW-26).
8. Implement `calls.no_show_followup` as a delayed job 48 hours after a `no_show` outcome.
9. Define the CloudWatch alarms of D-CW-13 in the observability stack (or the video stack): join failure rate above 5 percent over 15 minutes, p95 `meetingStartDurationMs` above 5 seconds, any `meetingFailed` burst (more than 3 in 5 minutes). Label all thresholds as planning assumptions.

**Tests.** `apps/api/src/calls/event-applier.test.ts`, extended `apps/api/test/jobs.e2e.spec.ts`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 2 to 3 person-days.

**Commit message.** `feat(api): Chime event consumer, idempotent applier and call lifecycle jobs`

---

### T-CW-1.3: Mailer generalisation, ICS module, four-locale templates and follow-up email

**Goal.** Generalise the invitation mailer into `apps/api/src/mailer/` with localised templates, an ICS generator module and the neutral "A follow-up was proposed" email (D-CW-26, D-CW-37).

**Depends on.** T-CW-0.5 (contracts for constants).

**Stories.** CALL-01, CALL-35, WBN-04, PLT-07.

**Files.**
- Create: `apps/api/src/mailer/mailer.ts` (abstract), `apps/api/src/mailer/ses-mailer.ts`, `apps/api/src/mailer/logging-mailer.ts`, `apps/api/src/mailer/mailer.module.ts`, `apps/api/src/mailer/templates/` (one file per template), `apps/api/src/mailer/mailer.test.ts`
- Create: `apps/api/src/calendar/ics-generator.ts`, `apps/api/src/calendar/ics-generator.test.ts`
- Modify: `apps/api/src/invitations/invitations.module.ts` (use new mailer module)

**Steps.**
1. Create abstract `Mailer` with `send(input: MailInput): Promise<void>`. `MailInput` includes `to`, `locale`, `template`, `data`.
2. Templates: `appointment.reminder`, `webinar.reminder`, `webinar.registration`, `appointment.follow_up.proposed` (neutral subject "A follow-up was proposed", neutral body with date and time, no service category or expert specialty). Each produces subject, text and HTML in all four locales using `Intl.DateTimeFormat` with the appointment's `timeZone` for date formatting (D-CW-32, no date library).
3. Subjects: "Your NestSelf session" and "Your NestSelf webinar", neutral, no service category (D-CW-26). The follow-up email subject: "A follow-up was proposed" (D-CW-37).
4. Implement the ICS generator: RFC 5545 folding (75-octet line limit) and escaping, `CLASS:PRIVATE`, neutral `SUMMARY`, authenticated join link in `DESCRIPTION`, `X-MICROSOFT-CDO-BUSYSTATUS:BUSY`. Write comprehensive tests for the folding, escaping and timezone handling.
5. Templates attach the ICS file as a `text/calendar` part.
6. Migrate `SesInvitationMailer` to extend the new `Mailer` or delegate to it.

**Tests.** `apps/api/src/mailer/mailer.test.ts`, `apps/api/src/calendar/ics-generator.test.ts`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 1.5 to 2.5 person-days.

**Commit message.** `feat(api): generalised mailer with four-locale templates, ICS generator and follow-up email`

---

### T-CW-1.4: Video client package (packages/video)

**Goal.** Create `packages/video` with `CallSessionController`, hooks and the consultation feature components including `FollowUpCard` (D-CW-20).

**Depends on.** T-CW-0.1 (`pnpm install` completed), T-CW-0.5 (contracts).

**Stories.** CALL-03, CALL-04, CALL-08, CALL-09, CALL-10, CALL-12, CALL-13, CALL-14, CALL-22, CALL-35, PLT-16.

**Files.**
- Create: `packages/video/package.json`, `packages/video/tsconfig.json`, `packages/video/vitest.config.ts`
- Create: `packages/video/src/index.ts`, `packages/video/src/controller.ts` (`CallSessionController`), `packages/video/src/hooks/` (`useCallSession.ts`, `useDevices.ts`, `useConnectionQuality.ts`, `useVideoTiles.ts`), `packages/video/src/components/` (`PreJoinCheck.tsx`, `CallStage.tsx`, `ControlBar.tsx`, `ConnectionBadge.tsx`, `SessionTimer.tsx`, `CrisisBlock.tsx`, `FollowUpCard.tsx`), unit tests and Storybook stories for each component.

**Steps.**
1. `CallSessionController` is framework-agnostic: manages `MeetingSession` from `amazon-chime-sdk-js`, device management (enumerate, select, remember in `localStorage`), join, reconnect (up to 2 minutes per CORE-17), capability changes, and metrics collection via `AudioVideoObserver`.
2. Hooks wrap the controller for React: `useCallSession` (join state machine), `useDevices` (selected devices, permission state), `useConnectionQuality` (3 states: good, degraded, poor from `getStats()` aggregate every 30 seconds, UX-38), `useVideoTiles` (tile ids for remote and local video).
3. `PreJoinCheck`: camera, microphone, speaker and network checks using `MeetingReadinessChecker` (OPS-30), self-view preview, "join with camera off", device selection, browser permission help (UX-01 to UX-04). Must animate in per the Motion rule.
4. `CallStage`: speaker view with movable self-view (UX-10). At 390 px remote video fills the screen, self-view floats (UX-20).
5. `ControlBar`: mute, camera, blur, device switch, fullscreen, "I cannot hear you" signal, leave, and for the expert "end for everyone" (UX-22). 44 px targets, secondary controls collapse into an overflow menu at mobile width.
6. `ConnectionBadge`: three states (good, degraded, poor) with distinct visual and `aria-live` announcement (UX-12).
7. `SessionTimer`: countdown from `endsAt`, dismissable "5 minutes remaining" cue (UX-15) that also reminds the expert that a follow-up can be proposed on the post-call screen (D-CW-37).
8. `CrisisBlock`: hotlines for Serbia, platform disclaimer, emergency guidance for the expert (UX-17). Hungarian hotlines are added only with a later Hungarian launch (D-CW-38). Reuse the `CrisisBlock` from wellbeing check-ins if it exists, otherwise create it.
9. `FollowUpCard`: the post-call card for proposing (expert) and responding (employee) to a follow-up. The expert's card has a date, time picker (in the appointment's time zone), duration default and a neutral note. The employee's card shows the proposal details with "Confirm", "Suggest another time" (up to three windows) and "Decline" (D-CW-37).
10. Every component uses only semantic tokens, follows the Motion rule (animated entry and exit with `useMotionPreset`), and is keyboard-operable with visible focus.
11. Extend the scan list of `packages/ui/src/motion/motion-contract.test.ts` to include `packages/video/src` so the motion contract check covers the new components.
12. Write unit tests for each hook (mock `CallSessionController`). Concrete test scenarios (at least three per component): `PreJoinCheck` -- permission denied shows the browser help link, successful check enables the join button, device selection persists in `localStorage`; `ControlBar` -- mute toggle fires the correct callback and announces the state change, device switch opens the menu; `ConnectionBadge` -- degraded state shows the banner with `aria-live` announcement, poor state shows reconnecting; `SessionTimer` -- five-minute cue appears and is dismissable, follow-up reminder appears for the expert; `FollowUpCard` -- expert submit sends the proposal, employee confirm sends confirmation, suggest-times allows up to three windows.
13. Write named Storybook story files per component: `PreJoinCheck.stories.tsx`, `CallStage.stories.tsx`, `ControlBar.stories.tsx`, `ConnectionBadge.stories.tsx`, `SessionTimer.stories.tsx`, `CrisisBlock.stories.tsx`, `FollowUpCard.stories.tsx`.

**Tests.** Colocated `*.test.tsx` per component, named `*.stories.tsx` per component.

**Gate.** `pnpm --filter @nestself/video lint && pnpm --filter @nestself/video typecheck && pnpm --filter @nestself/video test`

**Estimate.** 4 to 6 person-days.

**Commit message.** `feat(video): client package with CallSessionController, hooks and consultation components`

---

### T-CW-1.5: Api-client calls module and workspace/admin routes

**Goal.** Add the api-client `calls.ts` module and build the workspace appointment list, detail and call routes and the admin consultations list, detail, call route and outcome dialog.

**Depends on.** T-CW-1.1 (API routes), T-CW-1.4 (video components), T-CW-0.7 (sample data, i18n).

**Stories.** CALL-02, CALL-05, CALL-15, CALL-16, CALL-18, CALL-20, CALL-23, CALL-34, CALL-42.

**Files.**
- Create: `packages/api-client/src/calls.ts`, `packages/api-client/src/queries/calls.ts`
- Modify: `packages/api-client/src/index.ts`
- Delete: `apps/workspace/src/routes/_authenticated/appointments.tsx` (single-file route replaced by the directory layout below)
- Create: `apps/workspace/src/routes/_authenticated/appointments/index.tsx`, `apps/workspace/src/routes/_authenticated/appointments/$appointmentId.tsx`, `apps/workspace/src/routes/call/$appointmentId.tsx`
- Create: `apps/workspace/src/calls/map-call-error.ts` (new `calls/` directory for error mapping)
- Create: `apps/admin/src/routes/_authenticated/consultations/index.tsx`, `apps/admin/src/routes/_authenticated/consultations/$appointmentId.tsx`
- Modify: `e2e/pages/workspace.ts`, `e2e/pages/admin.ts` (register new routes)

**Steps.**
1. `calls.ts` in api-client: `join(appointmentId)`, `end(appointmentId)`, `recordOutcome(appointmentId, body)`, `submitFeedback(appointmentId, body)`, `sendSignal(appointmentId, signal)`, `postClientEvents(sessionId, events)`.
2. Query options: `appointmentListQuery`, `appointmentDetailQuery(id)`.
3. Workspace appointment list: load from api-client in API mode, from `SAMPLE_APPOINTMENTS` in sample mode. Show `StatusBlock` when empty. A pending proposal (`proposed` status) shows with a "Follow-up proposed" badge and navigates to the detail.
4. Workspace appointment detail: show expert name, date/time, service category, status. "Join" button enabled only inside the join window. When the appointment is `proposed`, show the `FollowUpCard` (employee view: confirm, suggest another time or decline).
5. Workspace call route (`/call/:appointmentId`): outside `_authenticated` layout (it uses a ticket, D-CW-24). Configure a lazy route boundary so `amazon-chime-sdk-js` loads only on the call routes and is not in the main bundle. Uses `PreJoinCheck`, then `CallStage` with `ControlBar`, `SessionTimer`, `CrisisBlock`. Error mapping in `apps/workspace/src/calls/map-call-error.ts` (a new directory): every error code from T-CW-0.5 maps to a translated key in `calls` namespace, with fallback to `errors.unknown`.
6. Add content security policy entries for `*.chime.aws` and `*.sdkassets.chime.aws` in the workspace and admin apps. No CSP configuration exists in the repository yet, so create a documented place for it (a `<meta>` CSP tag in `index.html` or a shared headers configuration file) and add the required connect-src and script-src entries.
7. Admin consultations list: shows all appointments for assigned clients (expert view). Outcome column.
8. Admin appointment detail: shows participants, status, outcome. Outcome dialog for the expert to record delivery status after the session.
9. All dialogs and panels follow the Motion rule.
10. Register new routes in `e2e/pages/workspace.ts` and `e2e/pages/admin.ts`. Add accessibility and reflow entries for the new pages in the e2e page registry.

**Tests.** Colocated `*.test.tsx` for the call route (error message appears on join failure, follow-up badge renders for a proposed appointment). Extend `packages/api-client/src/client.test.ts`.

**Gate.** `pnpm --filter @nestself/workspace lint && pnpm --filter @nestself/workspace typecheck && pnpm --filter @nestself/workspace test && pnpm --filter @nestself/admin lint && pnpm --filter @nestself/admin typecheck && pnpm --filter @nestself/admin test`

**Estimate.** 3.5 to 5 person-days.

**Commit message.** `feat(web): appointment and call routes in workspace and admin apps`

---

### T-CW-1.6: Socket.IO rooms and subscription authorization for calls

**Goal.** Wire the call rooms (`call:{sessionId}`) into the Socket.IO gateway with subscription authorization and follow-up events.

**Depends on.** T-CW-1.1.

**Stories.** CALL-05, CALL-11, CALL-19, CALL-35, CALL-36, CALL-37, CALL-38.

**Files.**
- Modify: `apps/api/src/ws/ws-messages.ts` (add `CallSubscribeSchema` with room pattern `call:{sessionId}`, action `consultation.join`, resource type `call_session`)
- Modify: `apps/api/src/calls/calls.service.ts` (emit to rooms on join, leave, end, signal events and follow-up events)
- Create: `apps/api/src/calls/calls.gateway.test.ts`

**Steps.**
1. Add room pattern validation in `ws-messages.ts`. The current `SubscribeMessageSchema` has a generic `z.string().min(1).max(256)` for the room field. Create a dedicated schema (or use `room.refine()`) that accepts `call:{id}`, `webinar:{id}` and `webinar:{id}:moderation` patterns, rejecting anything else.
2. On join, emit `call.participant.joined` to the room. On leave/drop (from event applier), emit `call.participant.left`. On end, emit `call.session.ended`. On signal, emit `call.signal`.
3. On follow-up actions, emit to the `call:{sessionId}` room: `appointment.follow_up.proposed` (when the expert proposes), `appointment.follow_up.confirmed` (when the employee confirms), `appointment.follow_up.declined` (when the employee declines), `appointment.times_suggested` (when the employee suggests alternative times).
4. Subscription authorization: `consultation.join` action on the call session resource (the subscriber must be a participant).
5. Test: mock socket, subscribe with a valid principal, receive an event after join; receive follow-up events.

**Tests.** `apps/api/src/calls/calls.gateway.test.ts`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 1 to 1.5 person-days.

**Commit message.** `feat(api): Socket.IO rooms and subscription authorization for call sessions`

---

### T-CW-1.7: Playwright consultation journey and motion suite entries

**Goal.** Write Playwright journeys for the pre-join, consultation join and call lifecycle against `FakeVideoProvider`, and add motion suite entries for every new panel.

**Depends on.** T-CW-1.4, T-CW-1.5.

**Stories.** CALL-02, CALL-03, CALL-08, CALL-09, CALL-13, PLT-13.

**Files.**
- Create: `e2e/calls/consultation.spec.ts`
- Create: `e2e/motion/video-components.motion.ts`
- Create: `.github/workflows/video-smoke.yml` (actual workflow file)
- Modify: `playwright.config.ts` or create `playwright.calls.config.ts`

**Steps.**
1. Playwright journey with Chromium fake media: `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, grant camera and microphone permissions (OPS-32).
2. Scenarios: pre-join renders device check, join renders the call stage, "end for everyone" closes the session, feedback dialog appears after end, error message appears for a closed window.
3. Motion suite: entries for `PreJoinCheck`, `CallStage` (enter/exit), `ControlBar` overflow menu, `SessionTimer` warning, `CrisisBlock` sheet, outcome dialog, `FollowUpCard`. Assert token durations, easing, compositor-only properties, no flicker, reduced-motion fade.
4. Create the actual workflow file `.github/workflows/video-smoke.yml` (the existing workflows directory is `.github/workflows/`). The workflow runs nightly, is gated on the `VIDEO_SMOKE_ENABLED` secret (skip the job when the secret is absent), starts the API with `VIDEO_PROVIDER=chime`, joins a real meeting from two Chromium contexts using `--use-fake-device-for-media-stream`, and asserts both hear each other. Skipped locally (OPS-33, D-CW-33). PLT-13 is an M1 story.

**Tests.** `e2e/calls/consultation.spec.ts`, `e2e/motion/video-components.motion.ts`.

**Gate.** `pnpm e2e:motion` (new entries), `pnpm verify`.

**Estimate.** 1.5 to 2.5 person-days.

**Commit message.** `test(e2e): Playwright consultation journeys and motion suite for video components`

---

### T-CW-1.8: Docs update (environment table, auth section, Serbian legal checklist)

**Goal.** Update `docs/environment.md` with the new env vars, add a video section to `docs/auth/implementation.md`, and reference the Serbian legal checklist and crisis block with Serbian hotlines (D-CW-38).

**Depends on.** T-CW-0.2, T-CW-1.1.

**Stories.** PLT-10.

**Files.**
- Modify: `docs/environment.md`, `docs/auth/implementation.md`

**Steps.**
1. Add all six new env vars to the environment table with their types, defaults and purposes.
2. Add a section to `docs/auth/implementation.md` covering: the join authorization model (`consultation.join` on the appointment resource with participant check), the token handling rules (never stored, never logged, `no-store`), the diagnostics visibility rule (4.7.5 fields only), and the recording consent schema.
3. Add a reference to the Serbian legal checklist items from D-CW-38 section 10: DPIA, recording notice, product copy rules, expert confidentiality, client-company network note. Note that the crisis block uses Serbian hotlines only; Hungarian hotlines are added with a later Hungarian launch.

**Tests.** None (documentation).

**Gate.** None (no code).

**Estimate.** 0.5 to 1 person-day.

**Commit message.** `docs(auth): video authorization model, environment table and Serbian legal checklist`

---

### T-CW-1.9: Follow-up proposal, confirmation, suggested times and decline

**Goal.** Implement the post-call follow-up lifecycle: the expert proposes, the employee confirms, suggests alternative times or declines, the `AUTOMATIC` policy creates the appointment immediately, and the `MANAGER_APPROVAL` policy creates an approval item (D-CW-37).

**Depends on.** T-CW-1.1 (call sessions and outcomes), T-CW-1.3 (mailer for the follow-up email), T-CW-1.4 (`FollowUpCard` component), T-CW-1.5 (web routes and post-call screens), T-CW-1.6 (Socket.IO rooms for follow-up events).

**Stories.** CALL-35, CALL-36, CALL-37, CALL-38, CALL-39, CALL-40, CALL-42.

**Files.**
- Modify: `packages/contracts/src/appointments.ts` (if not already in T-CW-0.5: verify statuses `proposed`, `awaiting_approval`, `declined` and the `follow_up_of` field; verify request schemas `FollowUpProposeRequestSchema`, `FollowUpConfirmRequestSchema`, `FollowUpSuggestTimesRequestSchema`, `FollowUpScheduleRequestSchema`, `FollowUpDeclineRequestSchema`; verify error codes `follow_up_not_allowed`, `appointment_not_proposed`)
- Modify: `apps/api/src/db/schema/appointments.ts` (verify `followUpOf` column exists from T-CW-0.6; verify status enum includes `PROPOSED`, `AWAITING_APPROVAL`, `DECLINED`)
- Modify: `apps/api/src/appointments/appointments.controller.ts` (add follow-up routes)
- Modify: `apps/api/src/appointments/appointments.service.ts` (add follow-up service methods)
- Modify: `apps/api/src/calls/calls.service.ts` (emit follow-up Socket.IO events)
- Modify: `apps/api/src/mailer/templates/` (add `appointment.follow_up.proposed` template if not already in T-CW-1.3)
- Modify: `packages/video/src/components/FollowUpCard.tsx` (wire to API through api-client)
- Modify: `apps/workspace/src/routes/_authenticated/appointments/$appointmentId.tsx` (show `FollowUpCard` for `proposed` appointments)
- Modify: `apps/workspace/src/routes/call/$appointmentId.tsx` (post-call screens: expert outcome then propose; employee feedback then confirm, suggest or decline)
- Modify: `apps/admin/src/routes/_authenticated/consultations/$appointmentId.tsx` (expert post-call: outcome then propose)
- Modify: `packages/api-client/src/calls.ts` (add follow-up API methods: propose, confirm, suggestTimes, schedule, decline)
- Create: `apps/api/test/follow-up.e2e.spec.ts` (suffix `followup`)

**Steps.**
1. Add routes to `AppointmentsController`:
   - `POST /appointments/:id/follow-up` with `@Authorize(ACTIONS['appointment.propose'], appointmentResource)`: expert proposes a follow-up.
   - `POST /appointments/:id/confirm` with `@Authorize(ACTIONS['consultation.join'], appointmentResource)`: employee confirms.
   - `POST /appointments/:id/suggest-times` with `@Authorize(ACTIONS['consultation.join'], appointmentResource)`: employee suggests up to three time windows.
   - `POST /appointments/:id/schedule` with `@Authorize(ACTIONS['appointment.propose'], appointmentResource)`: expert picks one of the suggested windows.
   - `POST /appointments/:id/decline` with `@Authorize(ACTIONS['consultation.join'], appointmentResource)`: employee declines.
2. Implement `AppointmentsService.proposeFollowUp(appointmentId, body, principal)`:
   - Check the original appointment's `call_outcomes.status` is `COMPLETED`; else 409 `follow_up_not_allowed`.
   - Check the principal is the `expertUserId` of the original appointment; else 404.
   - Create a new appointment with status `PROPOSED`, `followUpOf` set to the original appointment id, same `orgId`, `expertUserId`, `employeeUserId`, `serviceCategory` and `timeZone`.
   - Emit `appointment.follow_up.proposed` on the `call:{sessionId}` Socket.IO room.
   - Send the neutral "A follow-up was proposed" email to the employee in their locale.
   - Schedule `appointment.remind` jobs for the proposed appointment (they fire only if the appointment reaches `CONFIRMED`).
   - Audit `appointment.follow_up.proposed`.
3. Implement `AppointmentsService.confirmFollowUp(appointmentId, principal)`:
   - Check the appointment status is `PROPOSED`; else 409 `appointment_not_proposed`.
   - Check the principal is the `employeeUserId`; else 404.
   - Read the organisation's `follow_up_approval_policy` (from `organizations` table; the column is added in T-CW-1.10).
   - If `AUTOMATIC`: set status to `CONFIRMED`, schedule `appointment.remind` and send the ICS email to both parties. Emit `appointment.follow_up.confirmed` on the Socket.IO room. Audit `appointment.confirmed`.
   - If `MANAGER_APPROVAL`: set status to `AWAITING_APPROVAL` and delegate to the approval service in T-CW-1.10 to create the approval item. Emit `appointment.follow_up.confirmed` (status `awaiting_approval`) on the Socket.IO room. Audit `appointment.confirmed` with details noting the approval path.
4. Implement `suggestTimes`: accept up to three windows (`FollowUpSuggestTimesRequestSchema`), store them on the appointment (a JSON column or a related table), emit `appointment.times_suggested` on the room. Audit `appointment.times_suggested`.
5. Implement `schedule`: the expert picks one of the suggested windows by index, set the appointment times and status to `CONFIRMED` (or `AWAITING_APPROVAL` per the policy). Audit `appointment.confirmed`.
6. Implement `decline`: set status to `DECLINED`. Emit `appointment.follow_up.declined` on the room. Audit `appointment.declined`.
7. Wire the `FollowUpCard` in the post-call screens: expert screen shows outcome capture first, then "Propose a follow-up" after outcome is `completed`; employee screen shows feedback first, then the follow-up card when a proposal arrives (via Socket.IO or when loading the screen). The card also appears on the appointment detail page and in the appointment list so a proposal made after the employee left the post-call screen is not lost (CALL-42).
8. Add api-client methods: `proposeFollowUp(appointmentId, body)`, `confirmFollowUp(appointmentId)`, `suggestTimes(appointmentId, body)`, `scheduleFollowUp(appointmentId, body)`, `declineFollowUp(appointmentId)`.
9. Write the supertest suite: expert proposes before outcome returns 409 `follow_up_not_allowed`; employee confirms a non-proposed appointment returns 409 `appointment_not_proposed`; non-participant returns 404; employer-scoped principal returns 404 on all follow-up routes; successful proposal, confirm, suggest-times, schedule and decline round-trips.

**Tests.** `apps/api/test/follow-up.e2e.spec.ts`, extended `apps/workspace/.../appointments.test.tsx`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test && pnpm --filter @nestself/workspace test && pnpm --filter @nestself/admin test`

**Estimate.** 5 to 8 person-days.

**Commit message.** `feat(api,web): post-call follow-up proposal, confirmation, suggested times and decline`

---

### T-CW-1.10: Follow-up approval items and the organisation policy

**Goal.** Implement the `appointment_approvals` table, the organisation `follow_up_approval_policy` column, the approval routes, the approver selection logic (based on existing `approvalAuthorities` in `apps/api/src/db/schema/authorization.ts`), the HR settings screen and the approver dashboard (D-CW-37).

**Depends on.** T-CW-1.9 (follow-up lifecycle).

**Stories.** CALL-36, CALL-38, CALL-40, CALL-41.

**Files.**
- Create: `apps/api/src/db/schema/appointment-approvals.ts` (export from `schema/index.ts`)
- Create migration (next free number), hand-edit FORCE RLS
- Modify: `apps/api/src/db/schema/organization.ts` (add `followUpApprovalPolicy` column to `organizations`)
- Create: `apps/api/src/appointments/approval.service.ts`, `apps/api/src/appointments/approval.controller.ts`, `apps/api/src/appointments/approval.service.test.ts`
- Modify: `apps/api/src/appointments/appointments.service.ts` (call approval service from `confirmFollowUp` when policy is `MANAGER_APPROVAL`)
- Modify: `apps/api/src/jobs/calls-job-scheduler.service.ts` (add `appointment.approval.remind` delayed job)
- Create: `apps/workspace/src/routes/_authenticated/_hr/follow-up-policy.tsx` (HR settings screen)
- Create: `apps/workspace/src/routes/_authenticated/approvals/index.tsx` (approver dashboard)
- Modify: `packages/api-client/src/calls.ts` (add approval API methods)
- Create: `apps/api/test/approval.e2e.spec.ts` (suffix `approval`)
- Create: `e2e/calls/follow-up-approval.spec.ts`

**Steps.**
1. Add `followUpApprovalPolicy` column to the `organizations` table in `apps/api/src/db/schema/organization.ts`:
   ```typescript
   followUpApprovalPolicy: text().notNull().default('AUTOMATIC'),
   ```
   This column accepts `AUTOMATIC` or `MANAGER_APPROVAL`. Generate a migration that adds the column with the default `AUTOMATIC` for existing rows. No `FORCE ROW LEVEL SECURITY` is needed because `organizations` does not have RLS (it is the tenant anchor).
2. Create the `appointment_approvals` table in `apps/api/src/db/schema/appointment-approvals.ts`:
   ```typescript
   export const appointmentApprovals = pgTable('appointment_approvals', {
     id: idColumn(),
     appointmentId: text().notNull().references(() => appointments.id, { onDelete: 'restrict' }),
     orgId: text().notNull().references(() => organizations.id, { onDelete: 'restrict' }),
     orgUnitId: text().references(() => orgUnits.id, { onDelete: 'set null' }),
     approverUserId: text().notNull().references(() => users.id, { onDelete: 'restrict' }),
     alternateUserId: text().references(() => users.id, { onDelete: 'set null' }),
     status: appointmentApprovalStatus().notNull().default('PENDING'),
     reason: text(),  // safe reason, max 300 characters, validated in the controller
     decidedAt: ts(),
     createdAt: createdAt(),
   }).enableRLS();
   ```
   Add `pgPolicy` with `tenantPredicate(appointmentApprovals.orgId)`. Generate migration, hand-edit FORCE RLS.
3. Implement the approver selection query in `ApprovalService.findApprover(orgId, employeeOrgUnitId)`:
   - Query the `approvalAuthorities` table (at `apps/api/src/db/schema/authorization.ts`, fields `orgUnitId`, `includeDescendants`, `categories`, `alternateUserId`, `validFrom`, `validUntil`).
   - Find the authority whose `orgUnitId` (with `includeDescendants` using the `orgUnitClosure` table) covers the employee's organisational unit, whose `categories` are empty or contain `consultation_follow_up`, and whose `validFrom` is in the past and `validUntil` is null or in the future.
   - Return both the approver (`userId` on the authority) and the alternate (`alternateUserId` on the authority).
   - When no matching authority is found: the proposal fails visibly with a translated message (`errors.missingApprover` from the `calls` namespace), `appointment.approval.requested` is NOT written, and `appointment.approval.missing_approver` is audited as a note (this audit event is an addition to the canonical list in section 7 of the decisions). The appointment stays in `PROPOSED` status.
4. Implement `ApprovalService.createApprovalItem(appointmentId, orgId, employeeOrgUnitId)`:
   - Call `findApprover`.
   - Create an `appointment_approvals` row with status `PENDING`.
   - The DTO the approver sees carries: employee display name, the text "follow-up session with a NestSelf expert", the date and the duration. Never the service category, the expert's specialty or any content (D-CW-37, F4, section 7 of the product flows).
   - Write a serialisation test asserting the approver DTO has no field beyond those four.
   - Schedule `appointment.approval.remind` delayed job after 5 working days (`Europe/Belgrade` timezone) targeting both the approver and the alternate.
   - Audit `appointment.approval.requested`.
5. Implement the `authorize()` check for deciding an approval item: the action is `approval.decide` (from `ACTIONS` in `packages/contracts/src/actions.ts`). The self-approval rule uses `organizations.selfApprovalAllowed` (at `apps/api/src/db/schema/organization.ts` line 47): when `selfApprovalAllowed` is false and the approver is also the employee, the approval is denied.
6. Implement routes in `ApprovalController`:
   - `GET /orgs/:orgId/appointment-approvals` with `@Authorize(ACTIONS['approval.decide'], orgResourceFromContext('appointment_approval'))`: list pending and decided items for the approver.
   - `POST /appointment-approvals/:id/approve` with `@Authorize(ACTIONS['approval.decide'], approvalResource)`: approve. Sets status to `APPROVED`, `decidedAt` to now, transitions the appointment to `CONFIRMED`, schedules reminders and sends the ICS email. Audit `appointment.approval.approved`.
   - `POST /appointment-approvals/:id/reject` with `@Authorize(ACTIONS['approval.decide'], approvalResource)`: reject with a safe reason (max 300 characters, validated). Sets status to `REJECTED`, transitions the appointment to `DECLINED`, shows the reason to the employee. Audit `appointment.approval.rejected`.
   - `PATCH /orgs/:orgId/settings/follow-up-approval` with `@Authorize(ACTIONS['program.overview'], orgResourceFromContext('organization'))`: HR toggles the policy. Audit `org.follow_up_policy.changed`.
7. Build the HR settings screen in `apps/workspace/src/routes/_authenticated/_hr/follow-up-policy.tsx`: a toggle between `AUTOMATIC` and `MANAGER_APPROVAL` with an explanation of what each means.
8. Build the approvals screen in `apps/workspace/src/routes/_authenticated/approvals/index.tsx`: lists pending approval items for the current user with the safe DTO fields, approve and reject buttons, reason input on reject.
9. When the policy is `AUTOMATIC`, confirming a follow-up creates no approval item (verified by the golden case below).
10. Write the supertest suite: self-approval denied when `selfApprovalAllowed` is false; approver outside the employee's unit returns 404; employer-scoped principal returns 404 on everything except their own approval items; policy `AUTOMATIC` creates no approval item; approve round-trip transitions the appointment to `CONFIRMED`; reject round-trip transitions the appointment to `DECLINED` with the reason visible to the employee; missing approver returns a visible error and audits `appointment.approval.missing_approver`.
11. Write a Playwright journey: propose a follow-up, confirm as employee under `MANAGER_APPROVAL`, verify the approval item appears for the approver, approve, verify the appointment status.

**Tests.** `apps/api/src/appointments/approval.service.test.ts` (serialisation test for the approver DTO), `apps/api/test/approval.e2e.spec.ts`, `e2e/calls/follow-up-approval.spec.ts`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test && pnpm --filter @nestself/workspace test && pnpm e2e`

**Estimate.** 5 to 8 person-days.

**Commit message.** `feat(api,web): follow-up approval items, approver selection and organisation policy`

---

## M2: Webinars live (22 to 33.5 person-days)

**Definition of done.** The webinar lifecycle works end to end against `FakeVideoProvider`: create, publish, register, join (with capability enforcement), the chat (host, attendee and question messages with moderation), polls, hand-raise, give-floor and take-floor (audio only, video stays `Receive`), moderator console, automatic recording start and stop with the REC indicator, concatenation and CMS handoff. The capacity check uses `SELECT ... FOR UPDATE` and rejects above 250 with `capacity_above_limit` until M3. Eligibility is evaluated at registration and join. Reminders go out. The registration page, confirmation email and lobby state that the webinar is recorded and that only the presenters are on the recording. Playwright journeys pass. `pnpm verify` is green.

**Demo script.** Create a webinar through the admin (no recording switch; every webinar is recorded, D-CW-34), publish it, register as an employee, join, submit a message to hosts, moderator publishes a message to everyone, submit a question (a message with kind `question`), moderator answers it, open a poll, vote, attendee raises hand, moderator gives the floor (audio `SendReceive`, video stays `Receive`), attendee speaks, moderator takes the floor back, end webinar. Verify recording started at webinar start and the finalization job ran. Verify the attendance endpoint returns the correct count.

---

### T-CW-2.1: Webinar schema and module (tables, RLS, routes, chat, floor)

**Goal.** Create the webinar tables (`webinars`, `webinar_hosts`, `webinar_registrations`, `webinar_messages`, `webinar_polls`, `webinar_poll_options`, `webinar_poll_results`, `webinar_recordings`) with RLS policies for both `org_id = null` and organisation-scoped occurrences, and the `webinars` module with all routes from the canonical list, including the chat model and the give-floor and take-floor routes. The occurrence has no recording switch (every webinar is recorded, D-CW-34). The occurrence form rejects a capacity above 250 with `capacity_above_limit` until M3 (D-CW-36).

**Depends on.** T-CW-0.5, T-CW-0.6, T-CW-1.1.

**Stories.** WBN-01, WBN-02, WBN-03, WBN-05, WBN-07, WBN-08, WBN-09, WBN-10, WBN-11, WBN-17, WBN-20, WBN-21, WBN-23, WBN-24, WBN-25, WBN-26, WBN-27, WBN-29, WBN-31, WBN-32, WBN-33, WBN-37.

**Files.**
- Create: `apps/api/src/db/schema/webinars.ts`, migration, `apps/api/src/webinars/` (module, controller, service, repository, mapper), `apps/api/test/webinars.e2e.spec.ts` (suffix `webinars`)
- Modify: `apps/api/src/db/schema/enums.ts` (add `webinarStatus`, `webinarMessageKind`, `webinarMessageStatus`, `recordingStatus` pgEnums), `index.ts`, `apps/api/src/app.module.ts`

**Steps.**
1. Add pgEnums to `enums.ts`: `webinarStatus` (`['DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'CANCELED']`), `webinarMessageKind` (`['HOST', 'ATTENDEE', 'QUESTION']`), `webinarMessageStatus` (`['PENDING', 'PUBLISHED', 'ANSWERED', 'DISMISSED']`), `recordingStatus` (`['SCHEDULED', 'RECORDING', 'PROCESSING', 'READY', 'HANDED_OFF', 'FAILED']`).
2. Webinar tables carry `orgId` (nullable for `all_eligible` occurrences) using the plain-object `pgTable` form. RLS: `tenantPredicate(webinars.orgId, { nullable: true })` so platform-scope rows (`orgId = null`) are visible in every tenant context (D-CW-25). Eligibility filtering is done in the service layer; RLS alone does not enforce audience policy.
3. The `webinar_messages` table replaces the former `webinar_questions` concept. Columns: `id`, `webinarId`, `participantId` (nullable for hosts using their user id directly), `userId`, `kind` (`webinarMessageKind`: `HOST`, `ATTENDEE`, `QUESTION`), `status` (`webinarMessageStatus`: `PENDING`, `PUBLISHED`, `ANSWERED`, `DISMISSED`), `text`, `authorFirstName` (nullable; attendees can attach their first name per message, anonymous by default), `publishedByUserId` (nullable; set when a host publishes an attendee message), `answeredByUserId`, `createdAt`. RLS by webinar's org. Attendees submit messages with kind `ATTENDEE` or `QUESTION`; they arrive with status `PENDING` and are visible only to hosts until a host publishes them. Hosts post messages with kind `HOST` and status `PUBLISHED` directly visible to all.
4. The `webinars` table has no `recordingPolicy` column. Every webinar is recorded (D-CW-34). The `recording_status` column uses the `recordingStatus` enum and defaults to `SCHEDULED`.
5. Capacity enforcement: `SELECT ... FOR UPDATE` on the occurrence row at registration time (D-CW-17, SYS-02). Reject with 409 `webinar_full` when count reaches capacity. The occurrence creation and update routes reject a capacity above `WEBINAR_SINGLE_MEETING_CAPACITY` (250) with 400 `capacity_above_limit` until M3 lands (D-CW-36).
6. Eligibility evaluation at registration and at join: check the audience policy against the registrant's memberships in the service (D-CW-17).
7. Implement all webinar routes from section 7:
   - GET/POST occurrences, register, unregister, join (with capabilities by role: attendees get `Receive` on audio, video and content; presenters and moderator get `SendReceive`).
   - Start (`POST /webinars/:id/start`) and end (`POST /webinars/:id/end`).
   - Chat routes: `POST /webinars/:id/messages` (attendee to hosts with kind `ATTENDEE` or `QUESTION`, or host to everyone with kind `HOST`), `GET /webinars/:id/messages` (attendee reads published only; hosts read all), `POST /webinars/:id/messages/:messageId/publish` (host publishes an attendee message), `.../answer` (host answers a question), `.../dismiss` (host dismisses a message).
   - Hand raise/lower: `POST /webinars/:id/hand`, `DELETE /webinars/:id/hand`.
   - Give floor and take floor (replaces the former promote/demote concept): `POST /webinars/:id/participants/:participantId/give-floor` sets audio to `SendReceive` via `UpdateAttendeeCapabilities`, leaves video at `Receive` (D-CW-35). `POST .../take-floor` reverses the capability. A unit test asserts that video is never set to `SendReceive` for any attendee in any code path.
   - Polls (create, open, close, vote; vote stored without voter id, WEB-35).
   - Ops routes (create, edit, publish, cancel, attendance).
8. Schedule `webinar.remind` delayed jobs at registration time (mirroring `appointment.remind`); remove them on unregistration by job id.
9. `POST /webinars/:id/start` enqueues the `webinar.recording.start` job (handled in T-CW-2.5). The start route itself transitions the webinar to `LIVE`.
10. Audit events: all `webinar.*` events from section 7, including `webinar.floor.given`, `webinar.floor.taken`, `webinar.message.submitted`, `webinar.message.published`, `webinar.message.answered`, `webinar.message.dismissed`.
11. Supertest suite with at least twelve golden cases: registration at capacity returns 409 `webinar_full`, registration after close returns 409 `registration_closed`, ineligible user returns 403 `not_eligible`, duplicate registration returns 409 `already_registered`, attendee cannot list the roster, attendee reads only published messages, moderator reads all messages, employer-scoped principal gets 404 on attendance and on every ops route, presenter can start, attendee cannot start, give-floor updates audio to `SendReceive` and video stays `Receive`, take-floor reverts audio, occurrence creation with capacity 300 returns 400 `capacity_above_limit`.

**Tests.** `apps/api/test/webinars.e2e.spec.ts`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 6 to 9 person-days.

**Commit message.** `feat(api): webinars module with registration, chat, floor, polls and moderation`

---

### T-CW-2.2: Webinar contracts and template updates

**Goal.** Add webinar Zod schemas to contracts and update the `event.manage` and `event.moderate` actions in templates. **Rebase first** (auth phase 2 also edits `actions.ts` and `templates.ts`).

**Depends on.** T-CW-0.5 (base contracts). Run last in the milestone.

**Stories.** WBN-01, WBN-02, WBN-09, WBN-11.

**Files.**
- Create: `packages/contracts/src/webinars.ts`
- Modify: `packages/contracts/src/actions.ts`, `packages/contracts/src/templates.ts`, `packages/contracts/src/index.ts`

**Steps.**
1. Define schemas: `WebinarCreateRequestSchema`, `WebinarResponseSchema`, `WebinarListResponseSchema`, `WebinarRegistrationResponseSchema`, `WebinarMessageSchema` (with `kind` and `status` fields), `WebinarPollSchema`, `WebinarPollResultsSchema`, `WebinarAttendanceResponseSchema`.
2. Confirm `event.manage` and `event.moderate` are in `ACTIONS` (added in T-CW-0.5). If the auth phase 2 session has rebased, resolve any merge conflicts in the template arrays.
3. Export from `index.ts`. Write schema validation tests.

**Tests.** `packages/contracts/src/webinars.test.ts`.

**Gate.** `pnpm --filter @nestself/contracts lint && pnpm --filter @nestself/contracts typecheck && pnpm --filter @nestself/contracts test`

**Estimate.** 1 to 1.5 person-days.

**Commit message.** `feat(contracts): webinar schemas and template action updates`

---

### T-CW-2.3: Webinar Socket.IO rooms and chat, floor and poll components

**Goal.** Wire webinar rooms and build `WebinarStage`, `ChatPanel`, `PollPanel`, `ModeratorQueue`, `HandRaiseButton` in `packages/video` with give-floor and take-floor UI (D-CW-35).

**Depends on.** T-CW-2.1, T-CW-1.4.

**Stories.** WBN-07, WBN-08, WBN-09, WBN-10, WBN-12, WBN-15, WBN-16, WBN-18, WBN-19, WBN-20, WBN-23, WBN-24, WBN-25, WBN-28.

**Files.**
- Modify: `apps/api/src/ws/ws-messages.ts` (add webinar room patterns)
- Create: `packages/video/src/components/WebinarStage.tsx`, `ChatPanel.tsx`, `PollPanel.tsx`, `ModeratorQueue.tsx`, `HandRaiseButton.tsx` with tests and stories
- Create: `packages/video/src/hooks/useWebinarStage.ts`

**Steps.**
1. Socket.IO rooms: `webinar:{webinarId}` (public events), `webinar:{webinarId}:moderation` (moderator-only). Subscription authorization: `event.register` for public, `event.moderate` for moderation.
2. `WebinarStage`: presenter video, attendee count, persistent "REC" indicator (UX-45) when recording is active (`webinar.recording` event), state announcements via `LiveRegion`.
3. `ChatPanel`: hosts post messages visible to everyone (kind `HOST`); attendees write to hosts (kind `ATTENDEE` or `QUESTION`, status `PENDING`), anonymous by default with an optional first name field. Published messages from the `webinar.message.published` event appear in the public chat. The panel replaces the former Q&A panel concept.
4. `PollPanel`: view open poll, vote (stored without voter id, WEB-35), view aggregate results.
5. `ModeratorQueue`: pending messages (attendee and question kinds), hand raises, publish/dismiss/answer controls, give-floor and take-floor buttons per raised hand, attendance count. When a moderator gives the floor, the attendee sees a "you can speak now, unmute to talk" dialog (animated per the Motion rule) and a notice that their voice is part of the recording (D-CW-34); video stays off. The moderator can take the floor back at any time.
6. `HandRaiseButton`: toggle that emits to the moderation room.
7. All components follow the Motion rule, are keyboard-operable, and use semantic tokens. No camera control exists for attendees anywhere in the component tree.
8. Named Storybook story files: `WebinarStage.stories.tsx`, `ChatPanel.stories.tsx`, `PollPanel.stories.tsx`, `ModeratorQueue.stories.tsx`, `HandRaiseButton.stories.tsx`.

**Tests.** Colocated `*.test.tsx` per component with at least three concrete scenarios each: `WebinarStage` -- presenter video renders, REC indicator visible when recording active, attendee count updates on join event; `ChatPanel` -- anonymous message submission (kind ATTENDEE), message with first name, published message appears in the public list; `PollPanel` -- vote submission with no voter id, aggregate results render after close, already-voted state disables the button; `ModeratorQueue` -- pending message appears, publish moves it to the public list, hand raise shows the registration name, give-floor dialog appears for the attendee, take-floor reverses capabilities; `HandRaiseButton` -- toggle emits to the moderation room, raised state visual, lowered state after toggle. Named `*.stories.tsx` per component.

**Gate.** `pnpm --filter @nestself/video lint && pnpm --filter @nestself/video typecheck && pnpm --filter @nestself/video test`

**Estimate.** 4 to 6.5 person-days.

**Commit message.** `feat(video): webinar components with chat, floor, polls, moderator queue and hand raise`

---

### T-CW-2.4: Workspace and admin webinar routes

**Goal.** Build the workspace webinar discovery, detail, lobby and live routes and the admin occurrence form, publish, moderator console and presenter view.

**Depends on.** T-CW-2.1, T-CW-2.2, T-CW-2.3, T-CW-0.7.

**Stories.** WBN-01, WBN-06, WBN-16.

**Files.**
- Create: `apps/workspace/src/routes/_authenticated/webinars/index.tsx`, `$webinarId.tsx`, `$webinarId.live.tsx`
- Create: `apps/admin/src/routes/_authenticated/webinars/index.tsx`, `$webinarId.tsx`, `$webinarId.live.tsx`, `new.tsx`
- Modify: `packages/api-client/src/index.ts` (add webinar api-client module), `e2e/pages/`

**Steps.**
1. Workspace webinar discovery: list published webinars the user is eligible for. Registration button. Sample mode uses `SAMPLE_WEBINARS`.
2. Workspace webinar detail: title, presenters, date, "This webinar is recorded; only the presenters are on the recording" statement (D-CW-34), registration status. Lobby with countdown before start and the sentence "your camera stays off; you can write to the hosts and raise your hand to ask for the floor" (UX-28, D-CW-35).
3. Workspace webinar live: `WebinarStage`, `ChatPanel`, `PollPanel`, `HandRaiseButton`.
4. Admin occurrence form: title, description, audience policy (all_eligible or org-scoped), capacity (max 250 until M3 with a message naming the limit and the milestone, D-CW-36), presenter and moderator selection, schedule. No recording switch (every webinar is recorded, D-CW-34).
5. Admin publish: transitions occurrence from draft to published.
6. Admin moderator console: `ModeratorQueue`, attendance count, give-floor and take-floor controls, early recording stop button (`POST /webinars/:id/recording/stop`).
7. Error mapping to translated copy for all webinar error codes including `capacity_above_limit`.

**Tests.** Colocated route tests (error messages appear).

**Gate.** `pnpm --filter @nestself/workspace test && pnpm --filter @nestself/admin test`

**Estimate.** 4 to 6 person-days.

**Commit message.** `feat(web): webinar routes in workspace and admin apps`

---

### T-CW-2.5: Recording pipeline (automatic start, stop, concatenation, S3 layout)

**Goal.** Implement the automatic recording pipeline for webinars: `webinar.recording.start` is enqueued by `POST /webinars/:id/start`, recording stops at end or by `POST /webinars/:id/recording/stop`, the concatenation job produces an MP4, and the CMS handoff writes `webinar_recordings` with `handoff_status = 'pending'` (D-CW-18, D-CW-34).

**Depends on.** T-CW-2.1 (webinar module with `webinar_recordings` table and `recording_status` enum), T-CW-0.4 (SPIKE-CW-03 and SPIKE-CW-04 results confirming pipeline attendee count and selected video streams).

**Stories.** WBN-28, WBN-30, WBN-34.

**Files.**
- Modify: `apps/api/src/db/schema/webinars.ts` (add recording columns if not in T-CW-2.1), migration if needed
- Create: `apps/api/src/webinars/recording.service.ts`, `recording.service.test.ts`
- Modify: `apps/api/src/webinars/webinars.controller.ts` (wire `POST /webinars/:id/recording/stop` route for early stop by moderator; start is automatic)
- Modify: `apps/api/src/jobs/calls-job-scheduler.service.ts` (add `webinar.recording.start`, `webinar.recording.finalize`)

**Steps.**
1. `webinar_recordings` table (or columns on `webinars`, per schema decision in T-CW-2.1): `webinarId`, `pipelineId`, `status` (`recording_status` enum), `s3Prefix`, `concatenatedKey`, `handoffStatus`, timestamps. RLS via webinar's org.
2. The `webinar.recording.start` job is enqueued by the webinar start route (`POST /webinars/:id/start` in T-CW-2.1). The job calls `VideoProvider.startRecording` with `SelectedVideoStreams` filtered to presenter attendee ids, `CompositedVideo` layout `PresenterOnly` at HD, audio muxed (D-CW-18, WEB-23 to WEB-26). Set `recording_status` to `RECORDING`. Emit `webinar.recording` (started) on the `webinar:{webinarId}` Socket.IO room for the REC indicator. Audit `webinar.recording.started`.
3. Recording stops when the webinar ends (`POST /webinars/:id/end`) or by `POST /webinars/:id/recording/stop` (moderator early stop, `@Authorize(ACTIONS['event.moderate'], ...)`). Call `VideoProvider.stopRecording`. Set `recording_status` to `PROCESSING`. Schedule `webinar.recording.finalize` job. Emit `webinar.recording` (stopped) on the room. Audit `webinar.recording.stopped`.
4. An attendee given the floor is told, before they unmute, that their voice is part of the recording (message in the "you can speak now" dialog, from T-CW-2.3).
5. The recording notice appears in three places: registration page ("This webinar is recorded; only the presenters are on the recording"), confirmation email (same sentence), and the lobby (same sentence plus "if you are given the floor, your voice will be on the recording").
6. Finalize job: call concatenation pipeline (or simulate with `FakeVideoProvider`), update `recording_status` to `READY`, set `concatenatedKey`. CMS handoff: set `handoffStatus = 'pending'`, write the S3 object location. A one-line adapter is added when the CMS interface lands (D-CW-03). Audit `webinar.recording.ready`, `webinar.recording.handed_off`.
7. S3 layout: `recordings/{webinarId}/raw/` for segments (lifecycle 30 days), `recordings/{webinarId}/final/` for the concatenated MP4.
8. Quota request checklist: document that the default media-pipeline quota in eu-central-1 is 10 concurrent pipelines (WEB-41) and a quota increase should be requested before the first month with more than 5 recorded webinars.

**Tests.** `apps/api/src/webinars/recording.service.test.ts` with `aws-sdk-client-mock`.

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 4.5 to 7 person-days.

**Commit message.** `feat(api): automatic webinar recording pipeline with concatenation and CMS handoff`

---

### T-CW-2.6: Playwright webinar journeys

**Goal.** Write Playwright journeys for webinar registration, attendee join, moderator flow including the chat and the floor.

**Depends on.** T-CW-2.4.

**Stories.** WBN-07, WBN-09, WBN-10, WBN-11, WBN-15, WBN-20, WBN-24, WBN-25.

**Files.**
- Create: `e2e/calls/webinar-attendee.spec.ts`, `e2e/calls/webinar-moderator.spec.ts`
- Modify: `e2e/motion/video-components.motion.ts` (add webinar component entries)

**Steps.**
1. Attendee journey: register, join lobby (see recording notice), wait for start, view presenter video, submit a message to hosts, see a published message appear, submit a question, vote in poll, raise hand, receive floor (audio only, video off), speak, floor taken back, leave.
2. Moderator journey: start webinar (recording starts automatically), publish an attendee message, answer a question, dismiss a message, open a poll, close poll, give the floor to an attendee (verify audio `SendReceive`, video stays `Receive`), take the floor back, stop recording early, end webinar.
3. Motion entries for `WebinarStage`, `ChatPanel`, `PollPanel`, `ModeratorQueue`, `HandRaiseButton`, "you can speak now" dialog.

**Tests.** `e2e/calls/webinar-attendee.spec.ts`, `e2e/calls/webinar-moderator.spec.ts`.

**Gate.** `pnpm e2e:motion`, `pnpm verify`.

**Estimate.** 2.5 to 3.5 person-days.

**Commit message.** `test(e2e): Playwright webinar journeys for attendee and moderator flows with chat and floor`

---

## M3: Webinar scale, certificates and load test (6 to 9.5 person-days)

**Definition of done.** SPIKE-CW-06 result recorded in `research/07-spikes.md`. Replication works for capacity above 250: `createSession({ format: 'webinar', capacity })` chooses `PrimaryMeetingId`, hosts are on the primary, replica attendees receive the primary's media, chat and attendance are unchanged, the occurrence form accepts up to 1,000. An attendee given the floor in a replica meeting has stable audio (confirmed by the spike). Certificates issue for attendees meeting the 60 percent attendance threshold. The load test with the AWS client launcher runs against the dev account. `pnpm verify` is green.

**Demo script.** Run SPIKE-CW-06 with a replica meeting, give the floor, 60-minute soak. Create a webinar with capacity 500 (hosts on primary, attendees on replicas), verify chat works across replicas. Request a certificate for an attendee who attended 70 percent of live minutes, verify it is issued. Run the load test with 50 simulated attendees.

---

### T-CW-3.1: SPIKE-CW-06 replica audio test

**Goal.** Run the replica audio dropout spike (SPIKE-CW-06, WEB-39) before building replication. Create a replica meeting, give the floor to an attendee, run a 60-minute soak and record whether audio drops after 40 to 50 minutes.

**Depends on.** T-CW-2.1 (a working webinar to test against), T-CW-0.4 (spike placeholder script).

**Stories.** WBN-35.

**Files.**
- Modify: `apps/api/scripts/spikes/spike-cw-06-replica-audio.ts` (fill the placeholder from T-CW-0.4)
- Modify: `docs/tasks/calls-webinars/research/07-spikes.md` (record result)

**Steps.**
1. Create a meeting, create a second meeting with `PrimaryMeetingId` set to the first.
2. Join the primary as a presenter, join the replica as an attendee.
3. Give the floor to the replica attendee: `UpdateAttendeeCapabilities` with audio `SendReceive`, video `Receive`.
4. Run a 60-minute soak (or at least long enough to pass the 40 to 50 minute window reported in WEB-39).
5. Record whether audio stays stable. If the dropout occurs, document the exact timing and conditions.
6. Update `research/07-spikes.md` with the result. If the dropout confirms, note the workaround options for T-CW-3.2 (periodic capability refresh or reconnect).

**Tests.** Manual; no automated test.

**Gate.** `07-spikes.md` updated with result.

**Estimate.** 1 to 1.5 person-days.

**Commit message.** `docs(spikes): SPIKE-CW-06 replica audio dropout test results`

---

### T-CW-3.2: Replication (PrimaryMeetingId)

**Goal.** Implement the replication path in the video provider adapter for webinars above 250 attendees (D-CW-14, D-CW-36). `createSession({ format: 'webinar', capacity })` creates a primary plus replicas. Hosts join the primary, attendees join replicas. The occurrence form accepts up to 1,000.

**Depends on.** T-CW-3.1 (SPIKE-CW-06 confirms audio is stable or documents a workaround), T-CW-2.1.

**Stories.** WBN-07, WBN-35, WBN-36.

**Files.**
- Modify: `apps/api/src/video/chime-video-provider.ts` (add `createSession` branch for `capacity > WEBINAR_SINGLE_MEETING_CAPACITY`)
- Modify: `apps/api/src/video/fake-video-provider.ts` (stub replica responses)
- Modify: `apps/api/src/webinars/webinars.service.ts` (replica join routing: hosts on primary, attendees on replicas)
- Modify: `apps/api/src/webinars/webinars.controller.ts` (remove `capacity_above_limit` validation; accept up to 1,000)

**Steps.**
1. When `format === 'webinar'` and `capacity > 250`, create the primary meeting, then create replica meetings with `PrimaryMeetingId` (WEB-07 to WEB-09). Replica attendees see only the primary's media and never each other. Cost is plus $0.0085 per replica-session-minute (WEB-20).
2. Join routing: hosts (presenters and moderator) always join the primary. Attendees join a replica, selected by round-robin or capacity balance.
3. Chat and attendance are unchanged: they run on Socket.IO and PostgreSQL, not on Chime data messages, so they work across primary and replicas without changes (D-CW-16).
4. Remove the `capacity_above_limit` validation from the occurrence creation and update routes. The occurrence form now accepts up to 1,000 (D-CW-14). The IVS path above 1,000 is documented, not built.
5. Fake provider returns stub replica meeting ids.
6. If SPIKE-CW-06 found a dropout: implement the documented workaround (periodic capability refresh or attendee reconnect) and add a test for it.

**Tests.** Unit test in `video-provider.test.ts` (replication branch called for capacity 500, primary meeting id set on replicas). Extend `apps/api/test/webinars.e2e.spec.ts` (occurrence with capacity 500 accepted, join routing assigns hosts to primary and attendees to replica).

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 2 to 3.5 person-days.

**Commit message.** `feat(api): media replication for webinars above 250 attendees`

---

### T-CW-3.3: Certificates

**Goal.** Implement the certificate issue job and `GET /webinars/:id/certificate` (D-CW-03, F-CW-03).

**Depends on.** T-CW-2.1.

**Stories.** WBN-33 (certificates).

**Files.**
- Create: `apps/api/src/db/schema/certificates.ts` (`webinar_certificates` table), migration
- Modify: `apps/api/src/webinars/webinars.controller.ts`, `apps/api/src/jobs/calls-job-scheduler.service.ts`

**Steps.**
1. `webinar_certificates` table: `id`, `webinarId`, `userId`, `attendedMinutes`, `includesTopic` (boolean, F-CW-03), `issuedAt`. RLS via webinar's org.
2. `webinar.certificates.issue` job: for each registrant who attended at least 60 percent of live minutes, create a certificate row. Neutral title "NestSelf webinar" and date, no topic unless the attendee opts in (F-CW-03). Audit `webinar.certificate.issued`.
3. `GET /webinars/:id/certificate` with `@Authorize(ACTIONS['event.register'], ...)`: returns the certificate for the current user if it exists, 404 otherwise.

**Tests.** Extend `apps/api/test/webinars.e2e.spec.ts` (certificate issued for 70 percent attendance, not issued for 50 percent).

**Gate.** `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test`

**Estimate.** 1.5 to 2.5 person-days.

**Commit message.** `feat(api): webinar certificates with 60 percent attendance threshold`

---

### T-CW-3.4: Load test with AWS client launcher

**Goal.** Set up and run the AWS client launcher for load testing webinars with 50 to 100 simulated attendees (OPS-34).

**Depends on.** T-CW-2.1, T-CW-0.3 (video stack deployed).

**Stories.** PLT-15 (performance validation).

**Files.**
- Create: `apps/api/scripts/load-test/README.md`, `apps/api/scripts/load-test/launch-config.json`

**Steps.**
1. Clone and configure the AWS client launcher (OPS-34) for the dev account.
2. Create a launch config for a 60-minute webinar with 1 presenter and 50 receive-only attendees.
3. Run the test, collect CloudWatch metrics: join latency, audio/video quality, dropped attendees.
4. Document results in `research/07-spikes.md` under a "Load test" section.

**Tests.** None (manual).

**Gate.** Metrics collected and documented.

**Estimate.** 1.5 to 2 person-days.

**Commit message.** `docs(load-test): AWS client launcher configuration and webinar load test results`

---

## M4: Mobile, workshops and replay captions (7 to 10 person-days)

**Definition of done.** The mobile ticket route works with `react-native-webview`. The workshop format runs with gallery layout and facilitator controls. Workshop chat persists in `call_messages` with 24-hour retention, never shown to the employer. Replay captions for Serbian webinars produce WebVTT with a review step before publication. `pnpm verify` is green.

**Demo script.** Open the mobile app, navigate to an appointment, tap join, exchange a ticket, and see the web call route load inside the in-app browser. Create a workshop, join as facilitator and participant, verify gallery layout, send a chat message, verify it appears for others. Run Transcribe batch on a sample webinar recording, verify WebVTT output for Serbian (`sr-RS`).

---

### T-CW-4.1: Mobile ticket route

**Goal.** Implement `POST /appointments/:id/call-ticket` and the mobile `react-native-webview` screen (D-CW-24).

**Depends on.** T-CW-1.1, T-CW-1.5.

**Stories.** CALL-02, CALL-20 (mobile join).

**Files.**
- Modify: `apps/api/src/calls/calls.controller.ts` (add ticket route)
- Create: `apps/mobile/src/app/call/[appointmentId].tsx`
- Modify: `apps/workspace/src/routes/call/$appointmentId.tsx` (accept ticket in query string)

**Steps.**
1. `POST /appointments/:id/call-ticket` with `@Authenticated()` (bearer): generate a single-use 30-second ticket. Store in Redis as `call_ticket:{hash}` with TTL 30 (D-CW-24, `CALL_TICKET_TTL_SECONDS`). Return `{ ticket }`. Audit `call.ticket.issued`.
2. Workspace call route: if `?ticket=` query param present, exchange it at `POST /appointments/:id/join` (the API validates and consumes the ticket).
3. Mobile screen: call `POST /appointments/:id/call-ticket` with the bearer token. Open the workspace call route URL with the ticket query param in a `WebView` component from `react-native-webview`. Allow camera and microphone permissions in the WebView config.
4. Validate `invalid_ticket` error code when the ticket is expired, reused or wrong.

**Tests.** Extend `apps/api/test/calls.e2e.spec.ts` (ticket round-trip, expired ticket returns 401 `invalid_ticket`).

**Gate.** `pnpm --filter @nestself/api test && pnpm --filter @nestself/mobile typecheck`

**Estimate.** 2 to 3 person-days.

**Commit message.** `feat(api,mobile): call ticket route and react-native-webview call screen`

---

### T-CW-4.2: Workshops (format, gallery layout, facilitator controls, chat)

**Goal.** Add the `workshop` format with gallery layout, facilitator controls and session chat in `call_messages` with 24-hour retention (D-CW-27).

**Depends on.** T-CW-1.1, T-CW-1.4, T-CW-2.1.

**Stories.** WKS-01 (workshop lifecycle).

**Files.**
- Create: `packages/video/src/components/WorkshopStage.tsx`, `packages/video/src/components/WorkshopChatPanel.tsx`
- Modify: `apps/api/src/calls/calls.service.ts` (workshop format with `MaxCount: 30`, all `SendReceive`)
- Create: `apps/api/src/calls/workshop-chat.service.ts`

**Steps.**
1. Workshop meeting features per D-CW-10: `MaxCount: 30`, all `SendReceive`, content `SendReceive` for facilitator only.
2. `WorkshopStage`: gallery layout (grid of participant video tiles). Content share for the facilitator.
3. `WorkshopChatPanel`: text messages persisted in the `call_messages` table (not in `call_events`, which holds provider events only) for session duration plus 24 hours, never shown to the employer. Uses Socket.IO room `call:{sessionId}` with `call.chat` events. The `call_messages` table schema: `id`, `sessionId`, `participantId`, `text`, `sentAt`. Migration adds the table with RLS.
4. Retention: a delayed job at session end plus 24 hours deletes chat messages from `call_messages` (D-CW-29).

**Tests.** Component tests, extend `apps/api/test/calls.e2e.spec.ts` (workshop join, chat message round-trip).

**Gate.** `pnpm --filter @nestself/video test && pnpm --filter @nestself/api test`

**Estimate.** 3 to 4 person-days.

**Commit message.** `feat(api,video): workshop format with gallery layout, chat and 24-hour retention`

---

### T-CW-4.3: Replay captions (Transcribe batch to WebVTT)

**Goal.** Add a job that runs Transcribe batch on the concatenated webinar MP4 and converts the output to WebVTT, with a review step before publication (D-CW-23). Serbian is the first language; Hungarian follows for webinars held in Hungarian in a later phase (D-CW-38).

**Depends on.** T-CW-2.5 (recording pipeline).

**Stories.** WBN-15 (accessibility).

**Files.**
- Create: `apps/api/src/webinars/captions.service.ts`, `captions.service.test.ts`
- Modify: `apps/api/src/jobs/calls-job-scheduler.service.ts`

**Steps.**
1. After recording finalization, schedule a `webinar.captions.generate` job.
2. The job submits a Transcribe batch job with `sr-RS` (Serbian first), `hu-HU` or `en-US` depending on the webinar's language (WEB-32). Hungarian captions follow for webinars held in Hungarian in a later phase; the code supports the language from the start but Serbian is the priority (D-CW-38).
3. On completion, convert the Transcribe JSON output to WebVTT format.
4. Store the WebVTT in `recordings/{webinarId}/captions/` in S3. Set a `captionStatus = 'pending_review'` on `webinar_recordings`.
5. The caption is not published until reviewed (the CMS epic handles publication).

**Tests.** `apps/api/src/webinars/captions.service.test.ts`.

**Gate.** `pnpm --filter @nestself/api test`

**Estimate.** 2 to 3 person-days.

**Commit message.** `feat(api): webinar replay captions via Transcribe batch to WebVTT`

---

## Dependency graph

```
T-CW-0.1 (catalog)
  |
  +---> T-CW-0.2 (provider) --+
  |                            |
  |     T-CW-0.3 (CDK) -------+---> T-CW-0.4 (spikes)
  |                            |
  +---> T-CW-0.5 (contracts) --+---> T-CW-0.6 (appointment spine) --+
  |         |                                                        |
  |         +---> T-CW-0.7 (samples, i18n) -----+                   |
  |                                              |                   |
  +----------------------------------------------+-------------------+
                                                 |
            T-CW-1.1 (calls module) <------------+
              |       |       |
              |       |       +---> T-CW-1.2 (events, jobs)
              |       |       +---> T-CW-1.6 (Socket.IO)
              |       |
              |       +---> T-CW-1.3 (mailer, ICS)
              |
              +---> T-CW-1.4 (video client) ---+
              |                                 |
              +---> T-CW-1.5 (web routes) <----+---> T-CW-1.7 (Playwright)
              |                                       |
              +---> T-CW-1.8 (docs) <-+--------------+
              |
              +---> T-CW-1.9 (follow-up) <--- T-CW-1.1, 1.3, 1.4, 1.5, 1.6
              |       |
              |       +---> T-CW-1.10 (approval) <--- T-CW-1.9
              |
              +---> T-CW-2.1 (webinars module) --+
                      |                           |
                      +---> T-CW-2.2 (contracts, last) --+
                      +---> T-CW-2.3 (webinar components) --+
                      |                                      |
                      +---> T-CW-2.4 (webinar web routes) <-+
                      |       |
                      |       +---> T-CW-2.6 (Playwright)
                      |
                      +---> T-CW-2.5 (recording) <--- T-CW-2.1, T-CW-0.4
                      |
                      +---> T-CW-3.1 (SPIKE-CW-06) ---> T-CW-3.2 (replication)
                      +---> T-CW-3.3 (certificates)
                      +---> T-CW-3.4 (load test) <--- T-CW-2.1, T-CW-0.3

M4:
T-CW-4.1 (mobile ticket) <--- T-CW-1.1, T-CW-1.5
T-CW-4.2 (workshops) <--- T-CW-1.1, T-CW-1.4, T-CW-2.1
T-CW-4.3 (replay captions) <--- T-CW-2.5
```

## Tasks per lane per milestone

| Lane | M0 | M1 | M2 | M3 | M4 |
| --- | --- | --- | --- | --- | --- |
| A: API, worker, infra | T-CW-0.2, 0.3, 0.6 | T-CW-1.1, 1.2, 1.3, 1.6, 1.9, 1.10 | T-CW-2.1, 2.5 | T-CW-3.2, 3.3 | T-CW-4.1, 4.2, 4.3 |
| B: Contracts, samples | T-CW-0.1, 0.5, 0.7 | | T-CW-2.2 | | |
| C: Video client | | T-CW-1.4 | T-CW-2.3 | | |
| D: Workspace, admin | | T-CW-1.5 | T-CW-2.4 | | |
| E: Mobile | | | | | T-CW-4.1 |
| F: Docs, e2e | T-CW-0.4 | T-CW-1.7, 1.8 | T-CW-2.6 | T-CW-3.1, 3.4 | |

## Total estimate

30 tasks. Range: 70.5 to 110 person-days, stated as 71 to 110 in the milestone headers and the epic. With a 25 percent buffer for integration, review and rework: 90 to 135 person-days. The range is wide because the follow-up and approval tasks (T-CW-1.9, T-CW-1.10), the video client (T-CW-1.4), the webinar module (T-CW-2.1) and the recording pipeline (T-CW-2.5) carry the most uncertainty.

Per-milestone sums: M0 8 to 14.5, M1 27.5 to 42.5, M2 22 to 33.5, M3 6 to 9.5, M4 7 to 10.

## Things an implementer must not do

1. Run `pnpm install`, `pnpm add`, `npx`, `pnpm dlx`, `expo install`, `storybook init` or anything that touches `pnpm-lock.yaml` or `node_modules`.
2. Use a hex colour literal outside `packages/tokens`.
3. Leave a controller route without `@Public()`, `@Authenticated()` or `@Authorize()`.
4. Create a tenant table without `pgPolicy(...)`, `.enableRLS()` and hand-written `FORCE ROW LEVEL SECURITY` in the migration.
5. Allow a user-caused failure to be invisible (no `console.error` as the only error path).
6. Hand-edit `sr-Cyrl` JSON files.
7. Inline fictional data in a route module (use `@nestself/sample-data`).
8. Store, log or audit a join token. Put a join token in an audit `details` object. Return join credentials without `Cache-Control: no-store`.
9. Use `motion.*` components or import from `motion/*` or `framer-motion` directly (import `m`, `AnimatePresence`, `MotionFeatures`, `useMotionPreset` from `@nestself/ui`).
10. Use literal duration, delay or easing values outside `packages/ui/src/motion`, `tokens.css` and `tokens.json`.
11. Omit animation on a panel, sheet, drawer, dialog, toast, popover, menu, accordion, disclosure or indicator that appears, disappears, slides or expands.
12. Present a webinar attendee's identity to another attendee (attendees are anonymous unless they opt in per message).
13. Return a participant list, registration list, message author or feedback row to an employer-scoped principal.
14. Present wellbeing check-ins as diagnoses or use the WHO-5 without a licence.
15. Claim "end-to-end encrypted" or "nothing leaves the EU" in product copy.
16. Create a second Cognito pool or export `AWS_PROFILE` globally.
17. Skip the `FORCE ROW LEVEL SECURITY` step when generating a migration for a table with `.enableRLS()`.
18. Combine `-c platform=true` with `stage=dev` in CDK commands.
19. Add a camera control to the attendee client, set video capabilities to `SendReceive` for an attendee, or allow any attendee action to turn on a camera in any milestone.
