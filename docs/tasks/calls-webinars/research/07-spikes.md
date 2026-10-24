# Spikes for NS-CALLS-01 (SPIKE-CW-01 to SPIKE-CW-08)

Status: scripts written in T-CW-0.4 (24 October 2026); no spike has run yet. The founder runs them against the dev account (`634972095709`, eu-central-1) and fills in the Result tables below. Decision record section 8 lists the questions; a decision marked "spike" binds once its result is recorded here.

The scripts live in `apps/api/scripts/spikes/` and call the AWS SDK clients directly; they do not use the video adapter in `apps/api/src/video/`.

| Spike | Script | Binds | Status |
| --- | --- | --- | --- |
| SPIKE-CW-01 | `spike-cw-01-client-request-token.ts` | D-CW-07 | not yet run |
| SPIKE-CW-02 | `spike-cw-02-external-user-id.ts` | D-CW-08 | not yet run |
| SPIKE-CW-03 | `spike-cw-03-pipeline-attendee-count.ts` | D-CW-10, D-CW-18 | not yet run |
| SPIKE-CW-04 | `spike-cw-04-selected-video-streams.ts` | D-CW-18 | not yet run |
| SPIKE-CW-05 | `spike-cw-05-mobile-webview.ts` (instructions only) | D-CW-24 | not yet run |
| SPIKE-CW-06 | `spike-cw-06-replica-audio.ts` (placeholder until T-CW-3.1) | D-CW-14, D-CW-36 | runs at the start of M3 |
| SPIKE-CW-07 | `spike-cw-07-sqs-latency.ts` | D-CW-12 | not yet run |
| SPIKE-CW-08 | `spike-cw-08-playwright-ci.ts` | D-CW-33 | not yet run |

## Prerequisites shared by every spike

1. `NestSelf-dev-Video` is deployed to the dev account (`infra/cdk/README.md`, D-CW-31, CW-R-66).
2. `node infra/cdk/scripts/env-from-outputs.mjs dev` has run and its `CHIME_EVENTS_QUEUE_URL`, `CHIME_EVENTS_QUEUE_ARN` and `RECORDINGS_BUCKET` lines are in `apps/api/.env`. `CHIME_REGION` is unset or `eu-central-1`; the scripts refuse any other value (D-CW-06).
3. Both managed policies of the video stack (outputs `VideoApiPolicyArn` and `VideoWorkerPolicyArn`) are attached to the `nestself-dev` identity (D-CW-31). The scripts use only the actions those two policies grant.
4. `aws sts get-caller-identity` shows account `634972095709`. `AWS_PROFILE=nestself-dev` comes from the repository's chpwd hook in the main checkout; from a worktree elsewhere, prefix the single command with `AWS_PROFILE=nestself-dev`. Never export it globally (CLAUDE.md, "AWS and CDK"). The scripts refuse any other profile and refuse to fall back to the `[default]` profile.
5. For SPIKE-CW-03 with `--with-browsers`, SPIKE-CW-04, SPIKE-CW-05 and SPIKE-CW-08 only:
   - Playwright's Chromium: `pnpm exec playwright install chromium` from the repository root (downloads a browser; does not touch the lockfile).
   - A browser build of `amazon-chime-sdk-js`. It is pinned in the catalog (3.32.0) but no package depends on it until T-CW-1.4. Once `packages/video` exists and the post-merge `pnpm install` has run, the harness finds the SDK there and bundles it with the workspace app's Vite into the OS temp directory; nothing else is needed. Before that, build a single-file bundle of the SDK outside this repository (the SDK repository's `demos/singlejs` produces one that defines the global `ChimeSDK`) and pass its path as `SPIKE_CHIME_SDK_BUNDLE=/absolute/path/amazon-chime-sdk.min.js`. Without either, these spikes print this step and exit before creating any meeting.

## What every script does

- Prints a header with the spike id, the question, the decisions it binds, the region, the account (from the queue ARN) and a run id. `--help` prints the options and exits without calling AWS.
- Creates meetings with the adapter's `CreateMeetingWithAttendees` shape (guidelines section 3): `MediaRegion` `eu-central-1`, a `ClientRequestToken`, an `ExternalMeetingId` of the form `spike-cw-<nn>-<runId>-<label>`, the meeting features of D-CW-10, `NotificationsConfiguration.SqsQueueArn` set to the chime-events queue (D-CW-12), `TenantIds` and the three permitted tags (D-CW-11). External user ids are synthetic (`spike-cw-<nn>-<runId>-<key>`), never personal data (CW-R-03).
- Registers every meeting, media pipeline, browser and local server it creates in a cleanup registry that runs in a `finally` block and on Ctrl-C. If a cleanup step fails, the script prints the `aws` command that does it by hand and exits 1.
- Never prints a join token; attendee ids and meeting ids only (OPS-07, D-CW-08). The browser pages fetch their credentials from a local server on 127.0.0.1, so tokens never appear in a URL, and page console output is counted, not printed.
- Writes recordings under `raw/spike-cw-<nn>/<runId>/` in the recordings bucket, a prefix the bucket expires after 30 days (D-CW-18).
- Prints its measurements as one JSON object on the last line. Paste that line into the Result table of the spike and into the results log at the end of this file.
- Exits 0 when the measurement completed (whatever the answer), 1 on failure, 2 when it refused to run (wrong region or profile, missing environment).

Shared code: `lib.ts` (guards, cleanup registry, meeting and pipeline helpers) and `browser-harness.ts` (the local page, the Chime SDK bundle, Playwright helpers).

## Running order and cost

Run SPIKE-CW-07 first: it costs nothing in meeting time and proves that the queue and key policies of the video stack accept direct notifications. Then SPIKE-CW-01 and SPIKE-CW-02 (they shape the adapter in T-CW-1.1), SPIKE-CW-08 (it proves the browser harness the next three use), SPIKE-CW-03, SPIKE-CW-04 (twice: plain, then with `--control-sender`; T-CW-2.5 depends on both 03 and 04), and SPIKE-CW-05 on both platforms. SPIKE-CW-06 waits for the start of M3.

The prices are those of `research/03-compliance-consent-cost.md`: $0.0017 per attendee-minute (COST-01), $0.0085 per replica-session-minute (COST-02), $0.0125 per minute for a composited capture (COST-03, quoted for 1080p; the HD rate is not stated, so the 1080p rate is used) and $0.002 per minute of concatenated segments (COST-04). The minutes are planning assumptions taken from the scripts' defaults, and attendee-minutes are assumed to accrue only for attendees connected to media (the research files do not state how created but unconnected attendees are billed, or whether a pipeline's own connection bills attendee-minutes). SQS and EventBridge charges are not covered by the research files and are left out.

| Spike | Meeting time | Connected attendee-minutes | Pipeline minutes | Planning cost |
| --- | --- | --- | --- | --- |
| SPIKE-CW-07 | about 3 minutes | 0 | 0 | none in Chime charges |
| SPIKE-CW-01 | under 1 minute | 0 | 0 | none in Chime charges |
| SPIKE-CW-02 | under 1 minute | 0 | 0 | none in Chime charges |
| SPIKE-CW-08 | about 2 minutes | about 3 (2 contexts) | 0 | about $0.01 |
| SPIKE-CW-03 | about 10 minutes | 0 (about 4 with `--with-browsers`) | about 10 capture | about $0.13 |
| SPIKE-CW-04 | about 5 minutes, run twice | 15, then 20 with `--control-sender` | about 3.5 capture and 3.5 concatenation per run | about $0.08 per run |
| SPIKE-CW-05 | 20 minutes per platform | 40 per platform (far end and phone) | 0 | about $0.07 per platform |
| SPIKE-CW-06 (M3) | 60 minutes | up to 180 (presenter, replica attendee, promoted attendee) | 60 replica-session-minutes | about $0.82 |

The M0 spikes together come to well under $1 in Chime charges; SPIKE-CW-06 adds about $0.82 in M3.

## SPIKE-CW-01: repeated ClientRequestToken

**Question.** Does a repeated `ClientRequestToken` on `CreateMeetingWithAttendees` return the same meeting, a `ConflictException`, or a second meeting? The API reference does not document duplicate behaviour (OPS-01, OPS open question 1).

**Method.**

```
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-01-client-request-token.ts
```

Phase A sends two calls with identical input and the same token at the same moment (0 ms apart). Phase B sends two identical calls 2 s apart (`--gap-ms` to change it). Phase C deletes phase B's meeting and calls once more with B's token, because a session whose meeting ended after 5 empty minutes (OPS-03) would reuse its `call_sessions.id` as the token (CW-R-11). Each phase has its own token and `ExternalMeetingId`; nobody joins media.

**Prerequisites.** The shared ones (items 1 to 4).

**Result.**

| Field | Value |
| --- | --- |
| Status | not yet run |
| Run date, run id | |
| Phase A, 0 ms apart (`same-meeting`, `conflict`, `second-meeting`, `error:<name>`) | |
| Phase B, 2 s apart | |
| Phase C, after delete (`deleted-meeting-returned`, `new-meeting`, `conflict`, `error:<name>`) | |
| Attendee ids returned by the repeated call (same or new) | |
| JSON line | |

**Binding change.**

- `same-meeting` in phases A and B: D-CW-07 stands as written. The Redis lock stays the primary mechanism and the token (CW-R-11) is a working second line.
- `conflict` in phase A: D-CW-07 stands. T-CW-1.1's adapter treats a `ConflictException` from `CreateMeetingWithAttendees` as "another first join is creating the meeting" and takes the lock loser's path (wait for `provider_meeting_id`), never `video_provider_unavailable`.
- `second-meeting` in either phase: the token is no defence and D-CW-07's lock is the only one. Proposed amendment to D-CW-07: the event consumer (D-CW-12) or `calls.reconcile` (D-CW-09) deletes any meeting whose `ExternalMeetingId` names a session but whose `MeetingId` is not that session's `provider_meeting_id`.
- Phase C `deleted-meeting-returned`: CW-R-11 cannot use the bare `call_sessions.id` as the token, or a session could never get a replacement meeting inside its join window. Proposed amendment to D-CW-07 and CW-R-11: the token is derived from the session id and a per-session meeting counter; `ExternalMeetingId` stays the session id.
- Phase C `new-meeting`: tokens lapse with their meeting; CW-R-11 stands.

## SPIKE-CW-02: repeated ExternalUserId

**Question.** Does `CreateAttendee` with a repeated `ExternalUserId` return the existing attendee? (OPS open question 2.)

**Method.**

```
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-02-external-user-id.ts
```

One consultation meeting created with the expert's attendee. Case A: `CreateAttendee` twice in sequence with the same `ExternalUserId`. Case B: twice concurrently (two devices at once). Case C: `CreateAttendee` with the `ExternalUserId` that `CreateMeetingWithAttendees` used (the first joiner's cached credentials lost). Join tokens are compared for equality inside the process and never printed.

**Prerequisites.** The shared ones (items 1 to 4).

**Result.**

| Field | Value |
| --- | --- |
| Status | not yet run |
| Run date, run id | |
| Case A, sequential (`same-attendee`, `new-attendee`, `error:<name>`) | |
| Case A, join token equal | |
| Case B, concurrent | |
| Case C, after `CreateMeetingWithAttendees` | |
| JSON line | |

**Binding change.**

- `same-attendee` in cases A and C: `ExternalUserId` behaves as an idempotency key. D-CW-08 stands; a lost Redis entry is recoverable by calling `CreateAttendee` again with the participant id. The cache stays, because it saves a call and keeps the token out of PostgreSQL.
- `new-attendee`: every call mints another attendee for the same participant, so D-CW-08's cache is the only guard. Proposed amendment to D-CW-08: on a cache miss for a participant who already has a provider attendee id, the adapter calls `DeleteAttendee` on that attendee before creating a new one, so one participant never holds two live attendees; attendance (D-CW-12) maps both provider attendee ids to the same participant.
- Case B differs from case A (for example one `new-attendee` under concurrency): the join path takes a short per-participant lock, in the pattern of the `call:{sessionId}:create` lock (proposed amendment to D-CW-08).

## SPIKE-CW-03: pipeline attendee and MaxCount

**Question.** Does a media-pipeline attendee count against `Attendee.MaxCount`, and does it keep the meeting alive past 5 empty minutes? (OPS-42, OPS open question 5.)

**Method.**

```
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-03-pipeline-attendee-count.ts
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-03-pipeline-attendee-count.ts --with-browsers
```

1. Meeting A with `MaxCount` 2 and two attendees, p1 and p2. With `--with-browsers` both join from Chromium with fake media first.
2. Control: a third `CreateAttendee` on A. If it is refused, `MaxCount` is enforced when attendees are created; if it is accepted, it is deleted again at once.
3. A capture pipeline in the D-CW-18 shape (`SelectedVideoStreams` on p1, composited `GridView` with `PresenterOnly` at HD, audio muxed) starts on the full meeting. If it reaches `InProgress`, it does not count against `MaxCount`.
4. The browsers leave. Control meeting C (no pipeline, nobody joins) is created, and both meetings are polled with `GetMeeting` every 30 s for 8 minutes (`--wait-minutes`).

Run the plain variant first. If the control in step 2 is accepted, the plain run reports `inconclusive-rerun-with-browsers`; then run `--with-browsers`, which tests the count against connected attendees.

**Prerequisites.** The shared ones; item 5 for `--with-browsers`.

**Result.**

| Field | Value |
| --- | --- |
| Status | not yet run |
| Run date, run id, variant | |
| Third attendee on the full meeting (`refused` with error name, or `created`) | |
| Pipeline create accepted, settled status | |
| Source ARN form accepted (`documented` or `meeting-arn`) | |
| Pipeline counts against MaxCount (`no`, `likely-yes`, `inconclusive...`) | |
| Control meeting C ended after (seconds since creation) | |
| Meeting A ended after (seconds since empty), or alive at the end | |
| Pipeline keeps the empty meeting alive (`yes`, `no`, `inconclusive...`) | |
| JSON line | |

**Binding change.**

- Counts `no`: D-CW-10 stands; a single-meeting webinar keeps `WEBINAR_SINGLE_MEETING_CAPACITY = 250` with no allowance for the recording, and the consultation `MaxCount` of 4 keeps its stated reserve.
- Counts `likely-yes`: the recording takes one of the 250 places of a webinar meeting (and `MaxCount` cannot exceed 250, OPS-26). Proposed amendment to D-CW-10, D-CW-14 and D-CW-36: the registration capacity of a single-meeting webinar is 250 minus its hosts minus one, and the occurrence form and `capacity_above_limit` check use that figure.
- Keeps alive `yes`: OPS-42 confirmed. D-CW-09 stands (the cleanup job deletes the meeting regardless of attendee count) and D-CW-18's explicit stop at webinar end is required, as designed.
- Keeps alive `no`: a recorded webinar ends 5 minutes after the last person leaves, recording or not. D-CW-18: `webinar.recording.finalize` must also start on the meeting's `MeetingEnded` event, not only on the moderator's end.
- Source ARN form: T-CW-2.5 uses the form recorded here.

## SPIKE-CW-04: presenter-only composited recording

**Question.** Do `SelectedVideoStreams` and `CompositedVideo` `PresenterOnly` combine into one presenter-only composited MP4? (WEB open question 3, WEB-25, WEB-26.)

**Method.**

```
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-04-selected-video-streams.ts
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-04-selected-video-streams.ts --control-sender
```

A 3-minute test webinar (`--minutes`) in one meeting with webinar features: one presenter (`SendReceive` on everything) and two attendees (`Receive` on audio, video and content, D-CW-10 and D-CW-35), each in its own Chromium context with fake media. The presenter sends a blue canvas labelled PRESENTER as camera video and, from 45 s until 45 s before the end, a green canvas as content share. The capture pipeline uses the D-CW-18 shape with `SelectedVideoStreams` set to the presenter's attendee id. After the capture stops, a concatenation pipeline (WEB-29) writes one MP4. `--control-sender` makes the second attendee send a red canvas labelled CONTROL SENDER that is not selected, which proves the filter excludes a stream that exists (the product never lets attendees send video, D-CW-35). `--include-content-attendee` also lists `<presenterId>#content` in `SelectedVideoStreams`, for the case where content is missing from the composite.

After the run, list and download the output with the commands the script prints (`aws s3 ls`, `aws s3 cp`), check one object with `aws s3api head-object` (encryption), and watch the MP4.

**Prerequisites.** The shared ones and item 5.

**Result.**

| Field | Plain run | `--control-sender` run |
| --- | --- | --- |
| Status | not yet run | not yet run |
| Run date, run id | | |
| Capture request accepted (or API error) | | |
| Source ARN form accepted | | |
| Concatenation status | | |
| MP4 shows only the PRESENTER tile | | |
| Content share visible with the presenter picture-in-picture | | |
| CONTROL SENDER tile absent | not applicable | |
| Object encryption (`ServerSideEncryption`, `SSEKMSKeyId` from head-object) | | |
| JSON line | | |

**Binding change.**

- Accepted, presenter only, content with the presenter inset: D-CW-18 stands; T-CW-2.5 uses this capture shape (`webinarCaptureConfiguration` in `lib.ts`).
- The API refuses the combination: proposed amendment to D-CW-18: drop `SelectedVideoStreams` and rely on the attendee capabilities of D-CW-35 (attendees can never send video), which make the capture presenter-only by construction.
- Content missing with the presenter selected: rerun with `--include-content-attendee`. If content then appears, T-CW-2.5 also lists the presenters' content attendee ids; if not, drop `SelectedVideoStreams` as above.
- CONTROL SENDER visible: `SelectedVideoStreams` does not filter the composite. D-CW-18 then relies on the D-CW-35 capabilities alone, and the floor stays audio only (already D-CW-35).
- Encryption: the SDK documentation of `SseAwsKeyManagementParams` (in `@aws-sdk/client-chime-sdk-media-pipelines` 3.1155.0) states that without a key the output is encrypted with SSE-S3. If head-object shows `AES256` rather than `aws:kms` with the video stack's key, D-CW-18's "SSE-KMS on the platform key" needs `SseAwsKeyManagementParams` and a `SinkIamRoleArn`, which means a sink role in the video stack (proposed amendment to D-CW-18 and D-CW-31).

## SPIKE-CW-05: ticket route in the mobile WebView

**Question.** Does the ticket web route join a meeting with audio and video inside the Expo app on iOS (WKWebView) and Android (Chromium WebView)? (D-CW-24, CW-R-65, CORE-23, CORE-36, research/01 open question 4.)

**Method.**

```
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-05-mobile-webview.ts
```

The script prints the full procedure and makes no AWS call. In short:

- Variant A (runs now): `spike-cw-08-playwright-ci.ts --device --port 5199 --minutes 20` keeps a Chromium far end in a meeting and serves a second slot at `http://127.0.0.1:5199/?slot=device`. A temporary, uncommitted Expo Router screen `apps/mobile/src/app/spike-webview.tsx` opens it in a `react-native-webview` `WebView` (`allowsInlineMediaPlayback`, `mediaPlaybackRequiresUserAction={false}`, `mediaCapturePermissionGrantType="prompt"`). In the "NestSelf iPhone" simulator (iOS 17.5, Expo Go) the page is reachable on the Mac's loopback; on the physical Android device through `adb reverse tcp:5199 tcp:5199`. Loopback matters: `getUserMedia` needs a secure context, which `http://127.0.0.1` is and a LAN address is not.
- Variant B (after T-CW-1.5 and T-CW-4.1): the same check on the canonical route `apps/workspace/src/routes/call/$appointmentId.tsx`, opened as `{WORKSPACE_URL}/call/{appointmentId}?ticket={ticket}` after `POST /appointments/:id/call-ticket` (D-CW-24, guidelines section 13), with `adb reverse` for ports 5173 and 4000 on Android.

What to observe: the camera and microphone permission prompt inside the WebView (whose prompt, persistence across a reload, behaviour after "Don't allow"); `audioVideoDidStart` for the phone; media both ways (the phone shows the blue FAR END tile, the far end reports the phone's video and audio); autoplay (the page reports `audioAutoplayBlocked` and shows a tap-to-start button); background behaviour (30 s in another app or with the screen locked, then back); rotation. The Simulator has no camera, so camera capture on iOS can only be confirmed on a physical iPhone, if one is available.

**Prerequisites.** Item 5 (for the `--device` far end), Expo Go on the simulator and on the Android phone, `adb`, and `react-native-webview` in `apps/mobile` (catalog entry 14.0.1; T-CW-4.1 adds it to the app; adding it earlier means a `pnpm install` at a moment when no parallel work is running).

**Result.**

| Field | iOS Simulator "NestSelf iPhone" (iOS 17.5) | Android device (model, OS) |
| --- | --- | --- |
| Status | not yet run | not yet run |
| Variant (A harness, B ticket route) | | |
| Permission prompt (whose, persistence, denial message) | | |
| `audioVideoDidStart` and time to join | | |
| Phone sees far-end video, plays its audio | | |
| Far end sees the phone's video, hears its audio | | |
| Autoplay without a tap | | |
| Background for 30 s (audio, video on return, events) | | |
| Rotation | | |
| JSON line | | |

**Binding change.**

- Audio and video both ways on both platforms: D-CW-24 stands and CW-R-65 is satisfied for M4 once Variant B repeats it on the ticket route.
- Only permission or autoplay friction: D-CW-24 stands; T-CW-4.1 adjusts the WebView properties and the route's tap-to-start state.
- Media fails inside the WebView on a platform: D-CW-24 cannot ship as written for that platform. The founder reopens D-CW-24 (F-CW-05 answered "no native call experience in the first year"); the options are opening the route outside the embedded WebView or the native-module epic that D-CW-24 defers.
- Audio stopping in the background is expected (background audio is a later epic per D-CW-24); record it, no change.

## SPIKE-CW-06: replica floor audio (M3)

**Question.** Do attendees given the floor in replica meetings lose audio after 40 to 50 minutes? (WEB-39, research/02 open question 2.)

**Method.**

```
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-06-replica-audio.ts
```

Placeholder until T-CW-3.1: it prints the plan and the typed request shapes; `--run` is refused. The plan: a primary meeting with the presenter; a replica with `PrimaryMeetingId` (WEB-07); a replica attendee with `Receive` capabilities; the floor as an attendee created on the primary with audio `SendReceive`, video and content `Receive` (D-CW-35), which the replica client takes with `promoteToPrimaryMeeting` (WEB-09); a 60-minute soak in which the presenter's page samples the promoted attendee's volume every 10 seconds; on a dropout, demote and promote again and record whether audio returns.

Note for T-CW-3.1: its step 3 names `UpdateAttendeeCapabilities` on the replica attendee. That is the single-meeting floor of D-CW-35; replica attendees only receive the primary's media (WEB-07) and speak through promotion (WEB-09), which is also the path WEB-39 reports. The soak follows WEB-09.

**Prerequisites.** The shared ones, item 5, and a webinar module to test against (T-CW-2.1).

**Result.**

| Field | Value |
| --- | --- |
| Status | runs at the start of M3 (T-CW-3.1) |
| Run date, run id | |
| Audio stable for 60 minutes | |
| Dropout minute and conditions | |
| Demote and promote restores audio | |
| JSON line | |

**Binding change.**

- Stable for 60 minutes: D-CW-14's replication with promotion proceeds in T-CW-3.2, and D-CW-36 raises the occurrence capacity to 1,000 when M3 lands.
- Dropout that demote and promote fixes: T-CW-3.2 step 6 implements a periodic demote and promote ahead of the reported window, with a test.
- Dropout that nothing fixes: D-CW-36 keeps the 250 ceiling until it is fixed, or the founder limits the floor in replicated webinars; D-CW-14 records the limitation.

## SPIKE-CW-07: direct SQS against EventBridge

**Question.** What is the delivery latency of direct SQS (`NotificationsConfiguration`) versus EventBridge to the queue? (OPS-14, OPS open question 8.)

**Method.**

```
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-07-sqs-latency.ts
```

Both paths end in the chime-events queue (D-CW-12, `video-stack.ts`). A control meeting without `NotificationsConfiguration` produces events that can only arrive through EventBridge, which identifies EventBridge's `SenderId` and envelope. The test meeting has `NotificationsConfiguration.SqsQueueArn`; 10 `CreateAttendee` and 10 `DeleteAttendee` calls produce 20 attendee events (`chime:AttendeeAdded`, `chime:AttendeeDeleted`, OPS-10), each expected on both paths. Latency per path is the SQS `SentTimestamp` minus the event's own timestamp (both AWS clocks); for each event seen on both paths, the gap between the two arrivals. The script also records whether both copies carry the same timestamp, the envelope keys of each path, duplicates and out-of-order arrivals (OPS-15). Messages of this run's meetings and of any `spike-cw-*` meeting are deleted; other messages are left in the queue untouched.

**Prerequisites.** The shared ones. Stop the local worker (`chime.events.consume`) while this runs, so it does not consume the events first.

**Result.**

| Field | Direct SQS | EventBridge |
| --- | --- | --- |
| Status | not yet run | not yet run |
| Events received (of 20 expected) | | |
| Latency median, p95, max (ms) | | |
| Duplicates, out-of-order | | |
| Envelope (top-level keys, detail keys, timestamp field) | | |

| Field | Value |
| --- | --- |
| Run date, run id | |
| Classification (`sender-id-from-control-meeting` or `envelope-heuristic`) | |
| Pairs, EventBridge minus direct gap median and p95 (ms) | |
| Pairs with identical timestamps | |
| JSON line | |

**Binding change.**

- Both paths deliver and direct is faster: D-CW-12 stands.
- `direct-path-missing`: fix the `ChimeMeetingsEncryptEvents` key statement as its comment in `video-stack.ts` describes (and check `ChimeMeetingsSendEvents`), redeploy and re-run; until then EventBridge is the only path and D-CW-12 is not met.
- Identical timestamps on both copies: D-CW-12's key `(provider_meeting_id, event_type, provider_attendee_id, occurred_at)` collapses the duplicates; T-CW-1.2 reads `occurred_at` from the timestamp field recorded here.
- Different timestamps: the key does not collapse duplicates. Proposed amendment to D-CW-12: one-shot events (`AttendeeAdded`, `AttendeeDeleted`, `MeetingStarted`, `MeetingEnded`) dedupe without the timestamp, and repeatable ones (`AttendeeJoined`, `AttendeeLeft`, `AttendeeDropped`, OPS-12) dedupe with a tolerance.
- Envelopes differ: T-CW-1.2's parser accepts both shapes recorded here.
- EventBridge as fast as direct: recorded for the founder; D-CW-12 is not changed by this spike alone.

## SPIKE-CW-08: two Chromium contexts in one real meeting

**Question.** Can two Playwright Chromium contexts join one real meeting in CI? (OPS-32, OPS-33, OPS open question 6.)

**Method.**

```
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-08-playwright-ci.ts
pnpm --filter @nestself/api exec tsx scripts/spikes/spike-cw-08-playwright-ci.ts --headed
```

One consultation meeting with two attendees. One headless Chromium launched with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, two browser contexts (separate cookies, devices and WebRTC stacks), each opening the harness page for its slot. Each page joins with the fake camera and microphone and reports `audioVideoDidStart`, the other side's video tile and the other side's audio volume; both stay for 20 s (`--observe-seconds`). Pass means both joined, both saw the other's video and both heard the other's audio, the assertion the nightly `video-smoke` workflow of T-CW-1.7 needs. With `CI` set and `VIDEO_SMOKE_ENABLED` not `true`, the script prints a skip result and exits 0 without calling AWS (CW-R-90). `--device` serves the SPIKE-CW-05 far end instead.

**Prerequisites.** The shared ones and item 5. For a CI trial, AWS credentials for the dev account in the runner's environment (the scripts accept environment credentials when `AWS_PROFILE` is unset).

**Result.**

| Field | Local headless | Local headed | CI runner |
| --- | --- | --- | --- |
| Status | not yet run | not yet run | not yet run |
| Chromium version | | | |
| Both joined (join time per context, ms) | | | |
| Each saw the other's video | | | |
| Each heard the other's audio | | | |
| JSON line | | | |

**Binding change.**

- Both join with audio and video headless: D-CW-33's nightly `video-smoke` proceeds in T-CW-1.7 with this approach.
- Headless fails but headed works: the workflow runs Chromium headed under a virtual display on the runner (amendment to the T-CW-1.7 workflow, D-CW-33 unchanged).
- Fails in both modes: D-CW-33's nightly smoke becomes an API-level check (create a meeting, two attendees, delete it) and the browser join stays a manual check; PLT-13 records the limitation.

## Results log

Paste each run's last line here, newest first, one fenced block per run.

```
not yet run
```
