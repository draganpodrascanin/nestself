# Chime SDK integration, operations and testing

## Facts

| id | claim | source URL | confidence | as of |
|---|---|---|---|---|
| OPS-01 | `CreateMeeting` requires `ClientRequestToken` (2-64 chars, pattern `[-_a-zA-Z0-9]*`). Docs say "use a different token for different meetings" but do **not** document idempotent-return-on-duplicate behaviour. A `ConflictException` (409) is returned when "multiple instances of the same request have been made simultaneously." | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-02 | `ExternalMeetingId` is required (2-64 chars), case-insensitive, `aws:` prefix reserved. No documented uniqueness constraint across meetings. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-03 | Meetings end automatically when: (a) duration exceeds **24 hours**, (b) it is a replica and the primary meeting ends, (c) **no attendees connected for 5 continuous minutes** in a non-replica meeting. | https://docs.aws.amazon.com/chime-sdk/latest/dg/create-mtgs.html | high | 2026-10 |
| OPS-04 | `DeleteMeeting` disconnects all clients, deletes all attendees, prevents new joins. Returns HTTP 204. Also triggers a `chime:MeetingEnded` EventBridge event. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_DeleteMeeting.html | high | 2026-10 |
| OPS-05 | `CreateMeetingWithAttendees` creates a meeting with up to 10 attendees in a single call. `BatchCreateAttendee` adds up to 100 attendees to an existing meeting. | https://docs.aws.amazon.com/chime-sdk/latest/dg/quotas-throttling.html | high | 2026-10 |
| OPS-06 | `CreateAttendee` returns an `Attendee` with `AttendeeId`, `ExternalUserId`, and a signed `JoinToken` (up to 2048 chars). The token is valid for the meeting's duration or until `DeleteAttendee` is called. | https://docs.aws.amazon.com/chime-sdk/latest/dg/create-attendee.html | high | 2026-10 |
| OPS-07 | `JoinToken` and `ExternalUserId` are marked as **sensitive fields** in the AWS SDK types and must not be stored or logged. Tokens must be delivered to the client over a secure channel. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_Attendee.html | high | 2026-10 |
| OPS-08 | Using the same `JoinToken` from a new device triggers an `AttendeeAuthorized` event and "hands off" the session to the new device, effectively supporting rejoin/device-switch without creating a new attendee. | https://docs.aws.amazon.com/chime-sdk/latest/dg/using-events.html | high | 2026-10 |
| OPS-09 | All EventBridge events use `detail-type: "Chime Meeting State Change"` and `source: "aws.chime"`. The `detail.eventType` distinguishes them. | https://docs.aws.amazon.com/chime-sdk/latest/dg/using-events.html | high | 2026-10 |
| OPS-10 | Complete list of server-side lifecycle event types: `chime:MeetingStarted`, `chime:MeetingEnded`, `chime:AttendeeAdded`, `chime:AttendeeDeleted`, `chime:AttendeeAuthorized`, `chime:AttendeeJoined`, `chime:AttendeeLeft`, `chime:AttendeeDropped`, `chime:AttendeeVideoStarted`, `chime:AttendeeVideoStopped`, `chime:AttendeeContentVideoStarted`, `chime:AttendeeContentVideoStopped`, `chime:AttendeeContentJoined`, `chime:AttendeeContentLeft`, `chime:AttendeeContentDropped`, `chime:AttendeeCapabilitiesUpdated`. | https://docs.aws.amazon.com/chime-sdk/latest/dg/using-events.html | high | 2026-10 |
| OPS-11 | Common event payload fields: `meetingId`, `externalMeetingId`, `mediaRegion`, `timestamp`. Attendee events add `attendeeId`, `externalUserId`. Join/leave/drop events add `networkType` (e.g. `Voip`). | https://docs.aws.amazon.com/chime-sdk/latest/dg/using-events.html | high | 2026-10 |
| OPS-12 | The service never sends both `AttendeeLeft` and `AttendeeDropped` for the same disconnect. Dropped = network loss (no packets for 10-15 seconds); Left = intentional leave. After a drop, a successful reconnect fires `AttendeeJoined` again. | https://docs.aws.amazon.com/chime-sdk/latest/dg/using-events.html | high | 2026-10 |
| OPS-13 | `DeleteAttendee` triggers both `AttendeeLeft` and `AttendeeDeleted` events. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-faq.html | high | 2026-10 |
| OPS-14 | Events can be routed to EventBridge (default, all meetings), and optionally to **one SQS queue + one SNS topic per meeting** via `NotificationsConfiguration` on `CreateMeeting`. SQS/SNS reduces notification latency versus EventBridge. | https://docs.aws.amazon.com/chime-sdk/latest/dg/mtgs-sdk-notifications.html | high | 2026-10 |
| OPS-15 | Event notifications **may be delivered out of order**. Delivery is at-least-once (EventBridge standard guarantee). | https://docs.aws.amazon.com/chime-sdk/latest/dg/mtgs-sdk-notifications.html | high | 2026-10 |
| OPS-16 | SQS queue resource policy must grant `sqs:SendMessage` and `sqs:GetQueueUrl` to principal `meetings.chime.amazonaws.com` with `aws:SourceArn` / `aws:SourceAccount` conditions (confused-deputy protection). SSE queues also need a KMS key policy granting `kms:GenerateDataKey` and `kms:Decrypt`. | https://docs.aws.amazon.com/chime-sdk/latest/dg/mtgs-sdk-notifications.html | high | 2026-10 |
| OPS-17 | `MediaRegion` must be specified on `CreateMeeting`. `eu-central-1` is a supported media region. The control plane API endpoints exist in us-east-1, us-west-2, ap-southeast-1, **eu-central-1**, us-gov-east-1, us-gov-west-1. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-18 | The `MediaPlacement` response includes `EventIngestionUrl` which is the endpoint for the JS SDK's built-in event ingestion (client-side meeting events posted to Chime's backend). | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-19 | Client-side SDK event names (amazon-chime-sdk-js `EventName` type, 24 events): `meetingStartRequested`, `meetingStartSucceeded`, `meetingStartFailed`, `meetingEnded`, `meetingFailed`, `meetingReconnected`, `attendeePresenceReceived`, `audioInputSelected/Unselected/Failed`, `receivingAudioDropped`, `sendingAudioFailed/Recovered`, `videoInputSelected/Unselected/Failed`, `signalingDropped/CloseCode/CloseReason/CloseWasClean`, `backgroundFilterStarted/ConfigSelected/Failed`, `deviceLabelTriggerFailed`. | https://aws.github.io/amazon-chime-sdk-js/types/eventname.html | high | 2026-10 |
| OPS-20 | Failure events `audioInputFailed`, `videoInputFailed`, `meetingStartFailed`, `meetingFailed` include `meetingHistory` (last 5 minutes) and device error messages (e.g. `NotAllowedError`, `NotReadableError`). Key attributes: `meetingStatus`, `meetingErrorMessage`, `meetingStartDurationMs`, `poorConnectionCount`, `retryCount`. | https://aws.amazon.com/blogs/business-productivity/monitoring-and-troubleshooting-with-amazon-chime-sdk-meeting-events/ | high | 2020-10 |
| OPS-21 | The AWS-managed IAM policy `arn:aws:iam::aws:policy/AmazonChimeSDK` grants 9 actions: `CreateMeeting`, `DeleteMeeting`, `GetMeeting`, `ListMeetings`, `CreateAttendee`, `BatchCreateAttendee`, `DeleteAttendee`, `GetAttendee`, `ListAttendees`, all on `Resource: "*"`. | https://docs.aws.amazon.com/chime-sdk/latest/dg/create-iam-users-roles.html | high | 2026-10 |
| OPS-22 | Additional IAM actions needed beyond the managed policy for NestSelf: `chime:TagResource`, `chime:UpdateAttendeeCapabilities`, `chime:BatchUpdateAttendeeCapabilitiesExcept`, `chime:CreateMeetingWithAttendees`. For media pipelines (recording): `chime:CreateMediaCapturePipeline`, `chime:DeleteMediaCapturePipeline`, `chime:GetMediaCapturePipeline`. | https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonchimesdkmeetings.html | medium | 2026-10 |
| OPS-23 | No CDK L2 constructs exist for Amazon Chime SDK meetings. Infrastructure must use `iam.PolicyStatement`, `events.Rule` (source `aws.chime`), `sqs.Queue`, etc. A community construct `cdk-amazon-chime-resources` exists but is Lambda-backed and experimental. | https://pypi.org/project/cdk-amazon-chime-resources | medium | 2024 |
| OPS-24 | `ServiceUnavailableException` (503) returns a `RetryAfterSeconds` header. `ThrottlingException` (429) returned when API rate limit exceeded. Standard AWS SDK v3 retry with exponential backoff handles both. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-25 | Default attendee limit: **250** per standard meeting. FHD video or UHD content drops it to **25**. Media replication can scale to 10,000 (with limit increase request). | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_AttendeeFeatures.html | high | 2026-10 |
| OPS-26 | `MeetingFeatures.Attendee.MaxCount` (1-250) controls the cap. `MeetingFeatures.Video.MaxResolution` defaults HD; `Content.MaxResolution` defaults FHD. Setting either to `None` blocks the corresponding attendee capability. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-27 | Attendee capabilities are `Audio`, `Video`, `Content`, each with values `SendReceive`, `Send`, `Receive`, `None`. `UpdateAttendeeCapabilities` and `BatchUpdateAttendeeCapabilitiesExcept` change them at runtime. Content Send/SendReceive requires Video >= Receive. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_UpdateAttendeeCapabilities.html | high | 2026-10 |
| OPS-28 | Network: clients connect to `*.chime.aws` on TCP:443 (signaling) and UDP:3478 (media). If UDP is blocked, SDK falls back to TLS over TCP:443 for bidirectional media. EDNS0 must be enabled. | https://docs.aws.amazon.com/chime-sdk/latest/dg/network-config.html | high | 2026-10 |
| OPS-29 | Voice Focus, echo reduction, and background blur/replacement assets load from `*.sdkassets.chime.aws` on TCP:443 (CloudFront). Content Security Policy must allow these domains. | https://docs.aws.amazon.com/chime-sdk/latest/dg/network-config.html | high | 2026-10 |
| OPS-30 | The **Meeting Readiness Checker** (in amazon-chime-sdk-js) verifies audio/video devices and network connectivity with pass/fail results, suitable for a pre-join screen. | https://docs.aws.amazon.com/chime-sdk/latest/dg/self-troubleshooting.html | high | 2026-10 |
| OPS-31 | `aws-sdk-client-mock` (v4.x, latest 4.1.0 as of 2024-10-15) mocks AWS SDK v3 clients including `@aws-sdk/client-chime-sdk-meetings`. Pattern: `mockClient(ChimeSDKMeetingsClient).on(CreateMeetingCommand).resolves({...})`. Works with Vitest. | https://aws.amazon.com/blogs/developer/mocking-modular-aws-sdk-for-javascript-v3-in-unit-tests | high | 2024-10 |
| OPS-32 | Playwright + Chromium fake media: launch args `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, optionally `--use-file-for-fake-video-capture=/path/to/video.y4m`. Grants camera/microphone permissions automatically. Firefox needs prefs; no WebKit support. | https://omarelb.substack.com/p/til-2-set-up-playwright-with-fake | medium | 2023 |
| OPS-33 | Two Playwright Chromium contexts can join one real Chime meeting in CI using the above flags. Each context gets its own attendee and JoinToken. Not officially documented by AWS but follows from WebRTC in headless Chromium. | inference from OPS-32 + OPS-06 | medium | -- |
| OPS-34 | AWS Chime SDK **client launcher tool** for load testing: open-source, CDK-deployed EC2 instances running Puppeteer with headless Chromium. Activity commands: JoinMeeting, TurnOnLocalCamera, LocalMute, LeaveMeeting, EndMeeting, Wait. Recommended: max 2 attendees per c5.xlarge with video on. Metrics published to CloudWatch (aws-embedded-metrics). | https://aws.amazon.com/blogs/business-productivity/load-testing-applications-built-with-the-amazon-chime-sdk | high | ~2022 |
| OPS-35 | AWS serverless meeting demo: `amazon-chime-sdk-js/demos/serverless/` (Lambda + API Gateway + CloudFormation). React meeting demo: `aws-samples/amazon-chime-sdk/apps/meeting/`. Telehealth widget: `embed-healthcare-appointment-scheduling-widget-with-the-amazon-chime-sdk` blog. | https://docs.aws.amazon.com/chime-sdk/latest/dg/self-troubleshooting.html | high | 2026-10 |
| OPS-36 | The telehealth widget uses Cognito auth, PSTN + WebRTC dual channel, check-in gating (meeting opens only after patient check-in), SMS reminders via Pinpoint, CDK deployment. Architecture is directly relevant to NestSelf's scheduled-consultation model. | https://aws.amazon.com/blogs/business-productivity/embed-healthcare-appointment-scheduling-widget-with-the-amazon-chime-sdk | high | ~2022 |
| OPS-37 | `TenantIds` on `CreateMeeting` (1-5 strings, 2-256 chars) provides tenant-level isolation. Combined with `AppKeys`, it restricts which applications and tenants can join. This supports NestSelf's multi-org model. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-38 | `CreateMeeting` API burst rate default: 20 requests/second (third-party source; verify in Service Quotas console). Rate limits can be adjusted via AWS Support. | https://awsfundamentals.com/limits/chime | low | undated |
| OPS-39 | `MeetingArn` is returned in the `CreateMeeting` response. Format: `arn:aws:chime:REGION:ACCOUNT:meeting/MEETING_ID`. This ARN is needed for resource-level IAM policies and tagging. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-40 | Chime SDK client meeting events are free. You pay for Chime SDK meeting minutes, CloudWatch usage, and EventBridge event delivery. | https://aws.amazon.com/about-aws/whats-new/2020/10/amazon-chime-sdk-for-javascript-now-enables-meeting-health-monitoring-and-troubleshooting | high | 2020-10 |
| OPS-41 | `NotificationsConfiguration` also accepts a `LambdaFunctionArn` for direct Lambda invocation with meeting events. This is a third routing option alongside SQS and SNS. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html | high | 2026-10 |
| OPS-42 | A media pipeline attendee (for recording/transcription) counts as a connected attendee and prevents the 5-minute auto-end. You must explicitly stop the pipeline or delete the meeting. | https://www.repost.aws/questions/QU-2wJ7bAFSiSgwQ_ay0cO9Q/transcribe-cost-enablement-with-chime-sdk | medium | ~2023 |
| OPS-43 | `TurnControlUrl` in `MediaPlacement` is deprecated and no longer used by the SDK. An `AudioFallbackUrl` exists for the TCP-443 media fallback. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_MediaPlacement.html | high | 2026-10 |
| OPS-44 | CloudWatch dashboard for meeting events (from AWS sample): widgets for meeting join failures, dropped attendees, meeting start duration (latency), audio/video input failures. Uses CloudWatch Logs Insights for drill-down. | https://aws.amazon.com/blogs/business-productivity/monitoring-and-troubleshooting-with-amazon-chime-sdk-meeting-events/ | high | 2020-10 |
| OPS-45 | The Android SDK includes a built-in `DefaultBackOffRetry` class with retry count limit and retryable status code check, confirming the SDK handles transient failures internally. The JS SDK similarly retries signaling websocket reconnects. | https://aws.github.io/amazon-chime-sdk-android/amazon-chime-sdk/com.amazonaws.services.chime.sdk.meetings.internal.utils/-default-back-off-retry/index.html | medium | undated |

## Recommendations for NestSelf

### 1. Create meetings at join time, not at booking time (OPS-03, OPS-04, OPS-06)

**Rationale:** Meetings auto-end after 5 minutes with no attendees and have a 24-hour hard limit. Creating at booking wastes resources and risks stale meetings. Instead, lazily create the meeting when the first participant hits `POST /appointments/:id/join`.

**Proposed meeting lifecycle state machine:**

```
SCHEDULED (appointment booked, no Chime resource)
    |
    v  [first participant calls POST /appointments/:id/join within the time window]
CREATING (CreateMeetingWithAttendees called; store meetingId + appointment mapping)
    |
    v  [API returns successfully]
ACTIVE (both Meeting and first Attendee exist; return credentials to client)
    |
    |  [second participant calls join]
    +-- CreateAttendee for second participant; return credentials
    |
    |  [MeetingEnded event received OR appointment end time + 10 min grace]
    v
ENDING (DeleteMeeting called explicitly as safety net)
    |
    v
ENDED (record final attendance, duration, cost)
```

**Concurrency:** Use a database advisory lock or Redis `SET NX` on `appointment:{id}:meeting` to prevent two simultaneous `CreateMeeting` calls when both participants join at the same instant. The `ConflictException` (409) from Chime is not a reliable idempotency mechanism.

### 2. Use `CreateMeetingWithAttendees` for the first join, plain `CreateAttendee` for subsequent joins (OPS-05, OPS-06)

**Rationale:** A single API call creates both the meeting and the first attendee, reducing latency and API rate consumption. The second participant only needs `CreateAttendee`. For NestSelf's 1:1 consultations this means at most 2 API calls total per session.

### 3. Route events through SQS, not just EventBridge (OPS-14, OPS-15, OPS-16)

**Rationale:** SQS provides lower latency, built-in retry with visibility timeout, and dead-letter queue support. Pass the SQS queue ARN in `NotificationsConfiguration` on every `CreateMeeting` call.

**Event processing design:**
```
CreateMeeting(NotificationsConfiguration: { SqsQueueArn })
    |
    v
[Chime SDK] ---> [SQS Queue (KMS-encrypted, DLQ attached)]
                      |
                      v
                 [BullMQ Worker: ChimeEventProcessor]
                      |
                      +-- MeetingStarted: update appointment status to ACTIVE
                      +-- AttendeeJoined: record join timestamp, start attendance tracking
                      +-- AttendeeDropped: log network issue, don't end session
                      +-- AttendeeLeft: record leave timestamp
                      +-- MeetingEnded: finalize attendance record, compute attendee-minutes
                      +-- AttendeeVideoStarted/Stopped: track video usage for billing
```

**Idempotent processing:** Use `(meetingId, eventType, attendeeId, timestamp)` as a deduplication key in the database. Events arrive at-least-once and out of order; the worker must handle both.

Additionally, set up an EventBridge rule for `aws.chime` -> CloudWatch Logs as a backup audit trail.

### 4. Implement `DeleteMeeting` as an explicit cleanup at appointment end (OPS-03, OPS-04, OPS-42)

**Rationale:** While the 5-minute auto-end usually works, a media pipeline attendee or a stuck connection could prevent it. Schedule a BullMQ delayed job at `appointment.endTime + 10 minutes` that calls `DeleteMeeting` if the meeting is still active. This stops billing and guarantees cleanup.

### 5. Support rejoin via existing JoinToken, not new attendee creation (OPS-08, OPS-06)

**Rationale:** The `AttendeeAuthorized` event confirms that reusing a JoinToken from a new browser tab or after a network drop is the intended pattern. Store the `(meetingId, attendeeId, joinToken)` tuple in the server-side session (Redis) for the duration of the appointment. On rejoin, return the stored credentials instead of calling `CreateAttendee` again. Only call `DeleteAttendee` when explicitly revoking access (e.g., time window expired).

### 6. Use attendee capabilities for webinar/workshop view-only participants (OPS-25, OPS-26, OPS-27)

**Rationale:** For webinars (up to 250 attendees), create presenter attendees with `{Audio: SendReceive, Video: SendReceive, Content: SendReceive}` and audience attendees with `{Audio: Receive, Video: Receive, Content: Receive}`. Use `UpdateAttendeeCapabilities` to promote a viewer to speaker during Q&A. This avoids media replication complexity for NestSelf's scale (a few hundred).

### 7. Minimal IAM policy for the API task role, scoped where possible (OPS-21, OPS-22, OPS-39)

```typescript
// CDK (infra/cdk)
const chimeMeetingsPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'chime:CreateMeeting',
    'chime:CreateMeetingWithAttendees',
    'chime:CreateAttendee',
    'chime:BatchCreateAttendee',
    'chime:DeleteMeeting',
    'chime:DeleteAttendee',
    'chime:GetMeeting',
    'chime:GetAttendee',
    'chime:ListAttendees',
    'chime:UpdateAttendeeCapabilities',
    'chime:BatchUpdateAttendeeCapabilitiesExcept',
    'chime:TagResource',
  ],
  resources: ['*'], // Chime SDK meetings actions do not support resource-level ARNs in policies
});
```

**cdk-nag:** Suppress `AwsSolutions-IAM5` for the wildcard resource with a reason: "Chime SDK Meetings actions do not support resource-level permissions per the IAM service authorization reference."

### 8. CDK infrastructure pattern (OPS-14, OPS-16, OPS-23)

No L2 constructs for Chime. Build with L1/L2 for supporting services:

```
events.Rule (source: 'aws.chime', detailType: 'Chime Meeting State Change')
  -> sqs.Queue (KMS-encrypted, DLQ, resource policy for meetings.chime.amazonaws.com)
  -> consumed by BullMQ worker via SQS polling

// Per-meeting SQS is also configured via NotificationsConfiguration:
// the same queue ARN is passed on every CreateMeeting call.
```

Feature flag: `VIDEO_PROVIDER` env var (`chime` | `none`). When `none`, the `FakeVideoProvider` is used (returns stub meeting data, no AWS calls). Guarded by a CDK context variable `videoEnabled` that conditionally creates the Chime-related resources.

### 9. Local development: FakeVideoProvider + aws-sdk-client-mock (OPS-31, OPS-32, OPS-33)

- **Local dev (`AUTH_MODE=stub`, `VIDEO_PROVIDER=none`):** `FakeVideoProvider` returns a deterministic stub `Meeting` and `Attendee` with fake JoinTokens. The client renders participants' own cameras in a local-only room (no Chime connection). No AWS credentials needed.
- **Unit tests:** `aws-sdk-client-mock` with Vitest: `mockClient(ChimeSDKMeetingsClient).on(CreateMeetingCommand).resolves({Meeting: {...}})`. Test the service layer (meeting creation, attendee management, event processing) without AWS.
- **E2E browser tests (Playwright):**
  ```typescript
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-video-capture=test-assets/test-video.y4m',
    ],
  });
  // Grant permissions
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
  });
  ```
  Two Playwright contexts can join one real Chime meeting. For CI without AWS, test against FakeVideoProvider.

### 10. Client-side observability: post meeting events to your own API (OPS-19, OPS-20, OPS-44)

- Implement `eventDidReceive` on the `AudioVideoObserver` to collect client-side events.
- On `meetingFailed`, `meetingStartFailed`, `audioInputFailed`, `videoInputFailed`: POST the event + `meetingHistory` to `POST /api/meetings/:id/client-events`.
- Store in CloudWatch Logs (or PostgreSQL for NestSelf's scale).
- Dashboard widgets: join failure rate, meeting start latency (`meetingStartDurationMs`), dropped attendees, audio/video device failures.
- Alert on: sustained join failure rate > 5%, `meetingStartDurationMs` p95 > 5 seconds, `meetingFailed` spike.
- Correlate via `attendeeId` + `externalUserId` (opaque user ID) for support. Never log JoinTokens.

### 11. Network resilience documentation for support team (OPS-28, OPS-29, OPS-30, OPS-43, OPS-45)

Operational runbook items:
1. **Pre-join check:** Integrate the Meeting Readiness Checker on the pre-join screen. Surface pass/fail for network, microphone, camera, and speaker.
2. **Blocked UDP:** SDK auto-falls back to TLS over TCP:443. Quality degrades but the call works. The support team should note this in diagnostics.
3. **Corporate proxies:** Must allow `*.chime.aws` (TCP:443, UDP:3478) and `*.sdkassets.chime.aws` (TCP:443). EDNS0 must be enabled.
4. **Device permission denied:** `NotAllowedError` in `audioInputFailed`/`videoInputFailed` events. Guide user to browser settings.
5. **Regional incident:** If eu-central-1 Chime media is degraded, the only recourse is to wait (no cross-region failover for an active meeting). The control plane retries per the SDK's built-in backoff. For `ServiceUnavailableException`, respect the `RetryAfterSeconds` header.

### 12. Use `TenantIds` for multi-org isolation (OPS-37)

Pass the organization ID as a `TenantId` on every `CreateMeeting` call. Combined with AppKeys (configured in the Chime SDK console), this prevents a client from one NestSelf client company from joining another's meeting, even if they somehow obtained a JoinToken.

## Could not verify / open questions

1. **ClientRequestToken idempotency:** The docs do not state whether sending the same `ClientRequestToken` twice returns the same meeting or creates a second one. The `ConflictException` (409) error suggests it rejects duplicates, but the exact semantics are unconfirmed. **Action:** Test in the dev account before relying on it.

2. **CreateAttendee with same ExternalUserId:** The Ruby SDK describes the field as an "idempotency token," suggesting the same ExternalUserId returns the existing attendee, but the canonical API docs do not confirm this. **Action:** Test in dev.

3. **Resource-level IAM for Chime SDK Meetings:** The Service Authorization Reference page did not render its action table during fetch. The managed policy uses `Resource: "*"`, suggesting resource-level scoping is not supported, but this is unconfirmed for all actions. **Action:** Check the Service Authorization Reference manually.

4. **Exact API rate limits:** The `CreateMeeting` burst rate of 20 req/s comes from a third-party source. **Action:** Verify in the AWS Service Quotas console for eu-central-1.

5. **Media pipeline attendee preventing auto-end:** Reported on re:Post but not in official docs. If NestSelf enables recording, explicit `DeleteMeeting` at appointment end is critical. **Action:** Verify during recording integration.

6. **Two Playwright contexts joining one real Chime meeting in CI:** Inferred from WebRTC-in-headless-Chromium behavior, not officially tested by AWS. **Action:** Validate in CI with a real meeting in the dev account.

7. **Load testing tool currency:** The AWS client launcher blog post appears to be from ~2022. It may not reflect current SDK versions. **Action:** Check the GitHub repo for recent commits before adopting.

8. **EventBridge delivery to SQS latency vs direct SQS via NotificationsConfiguration:** The docs say direct SQS "can help reduce notification latency" but do not quantify the difference. **Action:** Measure in dev with both paths.

9. **Concurrent meeting limits per account:** Not found in the documentation. This matters for NestSelf's webinar use case if multiple orgs run webinars simultaneously. **Action:** Check Service Quotas console and consider requesting an increase pre-launch.
