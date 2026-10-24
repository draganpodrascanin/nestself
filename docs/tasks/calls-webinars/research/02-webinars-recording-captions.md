# Webinars and group sessions on Chime SDK

## Facts

| id | claim | source URL | confidence | as of |
|---|---|---|---|---|
| WEB-01 | AttendeeCapabilities take values SendReceive, Send, Receive, None for each of Audio, Video, Content. Default is SendReceive on all channels if omitted at CreateAttendee time. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateAttendee.html | high | 2026-10 |
| WEB-02 | Content capability cannot be Send or SendReceive unless Video is at least Receive (HTTP 400 otherwise). | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateAttendee.html | high | 2026-10 |
| WEB-03 | UpdateAttendeeCapabilities (PUT) changes an attendee's Audio/Video/Content capabilities at runtime. Audio change is immediate on unmute; Video/Content changes require media renegotiation. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_UpdateAttendeeCapabilities.html | high | 2026-10 |
| WEB-04 | BatchUpdateAttendeeCapabilitiesExcept applies capability changes to all attendees except a listed set -- useful for muting the audience in bulk. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_Operations_Amazon_Chime_SDK_Meetings.html | high | 2026-10 |
| WEB-05 | Maximum attendees per meeting: 250 (not adjustable). 100 for high-definition meetings. | https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html | high | 2026-10 |
| WEB-06 | Maximum concurrent video streams published per meeting: 25 (adjustable). Maximum concurrent video streams subscribed per attendee: 25 (not adjustable). | https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html | high | 2026-10 |
| WEB-07 | Media replication: a replica meeting is created by passing the primary's MeetingId as PrimaryMeetingId in CreateMeeting. Replica attendees receive only the primary session's presenter audio/video. They have no knowledge of other replica participants. | https://docs.aws.amazon.com/chime-sdk/latest/dg/media-replication.html | high | 2026-10 |
| WEB-08 | Default replica meetings per primary: 4 (adjustable via Service Quotas). Each replica holds up to 250 attendees. With limit increase, up to 10,000 total attendees across primary + replicas. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-faq.html | high | 2026-10 |
| WEB-09 | Replica attendee promotion: server creates primary-meeting credentials for the attendee, client calls promoteToPrimaryMeeting (JS/iOS/Android SDK). The attendee reuses the existing WebRTC connection, so switching is extremely fast (no transcoding delay). demoteFromPrimaryMeeting or DeleteAttendee reverts them. | https://docs.aws.amazon.com/chime-sdk/latest/dg/media-replication.html | high | 2026-10 |
| WEB-10 | Replicas can be placed in different AWS Regions for global audiences; media travels across the AWS backbone from primary to replica. | https://docs.aws.amazon.com/chime-sdk/latest/dg/media-replication.html | high | 2026-10 |
| WEB-11 | WebRTC meeting endpoints exist in eu-central-1 (Frankfurt): meetings-chime.eu-central-1.amazonaws.com. | https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html | high | 2026-10 |
| WEB-12 | Media pipeline endpoints exist in eu-central-1: media-pipelines-chime.eu-central-1.amazonaws.com. | https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html | high | 2026-10 |
| WEB-13 | Messaging endpoints exist in eu-central-1: messaging-chime.eu-central-1.amazonaws.com. | https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html | high | 2026-10 |
| WEB-14 | Media live connector pipeline streams a Chime SDK meeting to an RTMP/RTMPS endpoint (IVS, YouTube, Twitch, etc.). H.264 encoder, HD (1280x720) or FHD (1920x1080) at 30 fps. Audio AAC at 44100 or 48000 Hz. | https://docs.aws.amazon.com/chime-sdk/latest/dg/connector-pipe-config.html | high | 2026-10 |
| WEB-15 | Live connector layouts: ActiveSpeakerOnly, PresenterOnly (content share with presenter pip), GridView, Vertical, Horizontal. Attendees can be filtered so only selected participants appear. | https://aws.amazon.com/blogs/business-productivity/streamlining-media-workflows-amazon-chime-sdks-advanced-composition-capability-for-media-pipelines/ | high | 2023-07 |
| WEB-16 | One media live connector pipeline per meeting. Call DeleteMediaPipeline to stop it; stopping the IVS/RTMP stream does not stop the pipeline. | https://docs.aws.amazon.com/chime-sdk/latest/dg/connector-pipe-config.html | high | 2026-10 |
| WEB-17 | Amazon IVS Low-Latency Streaming is available in eu-central-1 (control plane: ivs.eu-central-1.amazonaws.com). Viewer latency: typically 3-5 seconds. | https://docs.aws.amazon.com/general/latest/gr/ivs.html | high | 2026-10 |
| WEB-18 | IVS Low-Latency Streaming pricing (North America): standard input $2.00/hr, Advanced HD $0.85/hr; output $0.0720/hr (HD) to $0.1440/hr (Full HD) per viewer-hour. With Multitrack Video standard input drops to $0.50/hr. | https://aws.amazon.com/ivs/pricing/ | high | 2026-10 |
| WEB-19 | Chime SDK attendee-minute pricing: $0.0017 per attendee-minute (audio+video+screen share). Billed in 6-second increments with 6-second minimum. | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| WEB-20 | Media replication pricing: $0.0085 per destination session-minute (on top of attendee minutes). | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| WEB-21 | Media live connector pricing: $0.09 per stream-minute for one HD stream (on top of attendee minutes). | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| WEB-22 | Media capture pipeline pricing: $0.0125/min for 1080p composited; $0.0017/stream-minute for audio or individual video. Concatenation: $0.002/min of segment processed. | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| WEB-23 | Media capture writes MP4 segments (~5 sec) to S3. Artifacts: Audio, Video (per-attendee), Content share, CompositedVideo, data-channel messages, meeting events, transcription messages. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-faq.html | high | 2026-10 |
| WEB-24 | Capture pipeline records the first 25 video streams only. One capture pipeline per meeting. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-faq.html | high | 2026-10 |
| WEB-25 | SelectedVideoStreams (under SourceConfiguration) filters recording to specific attendees by AttendeeIds or ExternalUserIds, max 25 combined. This enables presenter-only video capture. | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_media-pipelines-chime_SelectedVideoStreams.html | high | 2026-10 |
| WEB-26 | CompositedVideo layouts for capture: GridView with ContentShareLayout options PresenterOnly, ActiveSpeakerOnly, Vertical, Horizontal. Resolution: HD or FHD. PresenterOnlyConfiguration has PresenterPosition (TopRight, BottomRight, etc.). | https://aws.amazon.com/blogs/business-productivity/streamlining-media-workflows-amazon-chime-sdks-advanced-composition-capability-for-media-pipelines/ | high | 2023-07 |
| WEB-27 | S3 bucket policy requires: service principal mediapipelines.chime.amazonaws.com, actions s3:PutObject + s3:PutObjectAcl, conditions aws:SourceAccount and aws:SourceArn. Bucket must be in same account as meeting and in a Chime SDK media region. Concatenation also needs s3:GetObject + s3:ListBucket. | https://docs.aws.amazon.com/chime-sdk/latest/dg/create-s3-bucket.html | high | 2026-10 |
| WEB-28 | Service-linked role: AWSServiceRoleForAmazonChimeSDKMediaPipelines (ChimeSdkMediaPipelines namespace). | https://docs.aws.amazon.com/chime-sdk/latest/dg/create-s3-bucket.html | high | 2026-10 |
| WEB-29 | Concatenation pipeline merges capture chunks into a single file per stream. Must reference a MediaPipelineArn created within 30 days. Output goes to a (possibly separate) S3 bucket. Format: MP4. | https://docs.aws.amazon.com/chime-sdk/latest/dg/concat-architecture.html | high | 2026-10 |
| WEB-30 | Chime SDK live transcription (StartMeetingTranscription): the service sends the top 2 active talkers' audio to Amazon Transcribe in separate channels. Transcript events are delivered to every attendee via data messages (TranscriptEvent containing Transcript or TranscriptionStatus). | https://docs.aws.amazon.com/chime-sdk/latest/dg/meeting-transcription.html | high | 2026-10 |
| WEB-31 | Chime SDK FAQ lists 13 live-transcription languages for meetings (en-US, en-GB, en-AU, fr-FR, fr-CA, de-DE, it-IT, es-US, pt-BR, ja-JP, ko-KR, zh-CN, th-TH, hi-IN). Hungarian (hu-HU) and Serbian (sr-RS) are NOT in the Chime SDK's StartMeetingTranscription LanguageCode enum. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-faq.html | high | 2026-10 |
| WEB-32 | Amazon Transcribe streaming supports Serbian (sr-RS) for batch and streaming (no asterisk). Hungarian (hu-HU) is batch + streaming* (asterisk: not available in af-south-1, ap-northeast-1, ap-southeast-5, ap-southeast-7, cn-northwest-1 -- eu-central-1 is NOT excluded). | https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html | high | 2026-10 |
| WEB-33 | Serbian streaming was added in October 2024 as part of 30 new languages (total 54 streaming languages). | https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-transcribe-streaming-transcription-additional-languages/ | high | 2024-10 |
| WEB-34 | Even though Transcribe supports sr-RS and hu-HU for streaming, the Chime SDK StartMeetingTranscription API only accepts a fixed subset of ~14 language codes. To use sr-RS or hu-HU, you would need a custom integration (send meeting audio to Transcribe Streaming directly, bypassing the built-in API). | https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_StartMeetingTranscription.html | high | 2026-10 |
| WEB-35 | Meeting data messages: max 2 KB per message (including topic), topic max 64 chars, 100 sent messages/second per session, optional cache for 5 min (max 1024 messages). No persistence; not stored anywhere. | https://docs.aws.amazon.com/chime-sdk/latest/dg/webrtc-media.html | high | 2026-10 |
| WEB-36 | Chime SDK Messaging in eu-central-1: SendChannelMessage rate is 10 req/sec/channel (vs 30 in us-east-1). Per-user rate is 5 req/sec (vs 10 in us-east-1). Elastic channels are us-east-1 only. | https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html | high | 2026-10 |
| WEB-37 | Chime SDK Messaging pricing: $0.0007 per standard message sent, $0.00001 per delivery endpoint, $5/GB-month storage. | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| WEB-38 | aws-samples/amazon-chime-live-events: reference implementation with Chime SDK meeting + media live connector streaming to IVS. Serverless stack (Lambda, API Gateway, DynamoDB, S3, CloudFront). Four web apps: attendee, moderator, talent, broadcast feed. | https://github.com/aws-samples/amazon-chime-live-events | medium | 2026 (repo exists but architecture may be dated) |
| WEB-39 | Known issue: promoted replica attendees may lose audio after ~40-50 min while video continues (GitHub issue #2441, unresolved as of search date). | https://github.com/aws/amazon-chime-sdk-js/issues/2441 | medium | 2026-10 |
| WEB-40 | Video codecs supported: H.264, VP8, VP9, AV1. Audio: Opus at 16 kHz, 48 kHz, 48 kHz stereo. Simulcast supported with VP8 and H.264; scalable video with VP9. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-faq.html | high | 2026-10 |
| WEB-41 | Media pipeline concurrent limit: us-east-1 default 100, all other regions default 10 (adjustable). | https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html | high | 2026-10 |
| WEB-42 | When media capture is active, transcription messages are also written to S3 in a transcription-messages folder (JSON). This can serve as post-event caption source data. | https://docs.aws.amazon.com/chime-sdk/latest/dg/transcription-messages.html | high | 2026-10 |
| WEB-43 | Amazon Transcribe streaming pricing (general): $0.024/min. Batch: $0.024/min (first 250K min/month), then $0.015/min. | https://aws.amazon.com/transcribe/pricing/ | medium | 2026 (inferred from general Transcribe pricing page, not fetched directly) |
| WEB-44 | IVS has no hard viewer limit; it is a managed streaming service that scales to large audiences. Pricing is per viewer-hour of output. | https://aws.amazon.com/ivs/faqs/ | high | 2026-10 |
| WEB-45 | Post-processing for replay: concatenated MP4 from Chime capture can be transcoded with AWS Elemental MediaConvert to produce HLS, DASH, or MP4 for VOD. MediaConvert is available in eu-central-1. | https://docs.aws.amazon.com/general/latest/gr/mediaconvert.html | medium | general knowledge; not directly verified in this search |

## Recommendations for NestSelf

### 1. Small group workshops (up to 25 participants): single Chime SDK meeting (WEB-05, WEB-06)

A standard Chime SDK meeting with all attendees at SendReceive supports up to 250 people and 25 concurrent video senders. For workshops of up to 25 people where everyone is on camera, a single meeting is the simplest and cheapest option ($0.0017/attendee-minute). No replication or streaming needed.

### 2. Webinars up to 250 attendees: single meeting with capability-gated attendees (WEB-01, WEB-03, WEB-04, WEB-05)

Create attendees with Audio: Receive, Video: Receive, Content: None for the audience and Audio: SendReceive, Video: SendReceive, Content: SendReceive for presenters. This enforces receive-only without needing replication. Attendees cannot see or hear each other. Use UpdateAttendeeCapabilities or BatchUpdateAttendeeCapabilitiesExcept to promote an attendee to speaker at runtime. Cost: $0.0017/attendee-minute only.

### 3. Webinars 250-1,000 attendees: media replication (WEB-07, WEB-08, WEB-09, WEB-20)

Use 1 primary meeting (presenters only) + up to 4 replica meetings (250 attendees each = 1,000). Replica attendees see only presenter audio/video and do not see each other -- perfect privacy model. Promotion to speaker is fast (reuse WebRTC connection). Additional cost: $0.0085/destination-session-minute on top of attendee minutes. Request quota increase beyond 4 replicas for larger audiences (up to 10,000 with approval). Caution: test the promoted-attendee audio dropout issue (WEB-39) before relying on promotion in production.

### 4. Webinars beyond 1,000 or very large broadcasts: live connector to IVS (WEB-14, WEB-17, WEB-18, WEB-21, WEB-44)

For audiences beyond what replication comfortably supports, or to simplify at scale: use a Chime SDK meeting for presenters + media live connector to IVS Low-Latency Streaming. IVS handles unlimited viewers at 3-5 second latency with no per-viewer WebRTC connection. Q&A and interaction must run over NestSelf's own Socket.IO layer (IVS viewers are not Chime attendees). Cost: $0.09/stream-minute for the connector + IVS output per viewer-hour. This is the right model when viewer counts are unpredictable or exceed a few hundred, or when the 3-5 second latency is acceptable.

### 5. Scale threshold recommendation

| Audience size | Model | Key cost drivers |
|---|---|---|
| Up to 25 (workshop) | Single meeting, all SendReceive | $0.0017/attendee-min |
| 26-250 (webinar) | Single meeting, Receive-only audience | $0.0017/attendee-min |
| 250-1,000 (large webinar) | Primary + replicas (default 4) | $0.0017/attendee-min + $0.0085/replica-session-min |
| 1,000+ or unpredictable | Presenter meeting + live connector + IVS | $0.09/stream-min + IVS viewer-hours |

### 6. Recording and replay pipeline (WEB-22, WEB-23, WEB-25, WEB-26, WEB-27, WEB-29, WEB-42, WEB-45)

**Capture:** Use CreateMediaCapturePipeline (ChimeSdkMediaPipelines namespace) on the primary meeting only.
- Set SelectedVideoStreams to the presenter's AttendeeId/ExternalUserId to capture only their video (excludes attendee video by design).
- Use CompositedVideo with PresenterOnly layout (content share + presenter PIP) at FHD resolution.
- Audio: AudioWithCompositedVideo mux type for a single combined stream.
- Disable standalone Video and Content artifacts to reduce storage.
- S3 bucket in eu-central-1, bucket policy granting mediapipelines.chime.amazonaws.com s3:PutObject + s3:PutObjectAcl with SourceAccount/SourceArn conditions.

**Concatenation:** CreateMediaConcatenationPipeline merges 5-second MP4 chunks into a single MP4 per stream. Trigger it after capture stops. Cost: $0.002/min.

**Post-processing:** Transcode the concatenated MP4 with AWS Elemental MediaConvert (eu-central-1) to produce HLS for streaming replay or a downloadable MP4. MediaConvert supports thumbnail generation and subtitle injection.

**Captions:** If live transcription is enabled during the meeting, transcript JSON is saved to S3 by the capture pipeline. Convert these to WebVTT/SRT for replay captions.

### 7. Live transcription and captions (WEB-30, WEB-31, WEB-32, WEB-33, WEB-34, WEB-42, WEB-43)

**Built-in Chime SDK transcription** supports ~14 languages. Serbian and Hungarian are NOT in the allowed LanguageCode enum for StartMeetingTranscription. However, Amazon Transcribe Streaming does support both sr-RS and hu-HU (streaming, including eu-central-1 for Hungarian).

**Recommended approach:**
- For English and German webinars: use StartMeetingTranscription with de-DE or en-US. Transcripts arrive as data messages to all attendees and are saved to S3 by the capture pipeline.
- For Serbian/Hungarian: build a custom transcription pipeline. Capture meeting audio via a media stream pipeline to Kinesis Video Streams, then stream it to Amazon Transcribe Streaming with sr-RS or hu-HU. Relay results back to attendees via Socket.IO (since the built-in data-message path is not available for these languages).
- For post-event captions: use the S3 transcript JSON (from capture) or run Amazon Transcribe batch on the concatenated MP4 (batch supports sr-RS and hu-HU). Convert to WebVTT for the replay player.

### 8. Interaction layer: use Socket.IO, not Chime data messages or Chime Messaging (WEB-35, WEB-36, WEB-37)

**Chime data messages** are ephemeral (2 KB, 100/sec, no persistence) -- suitable for live captions and real-time signals but not for Q&A threads, polls, or moderated questions that need persistence, ordering, and moderation.

**Chime SDK Messaging** is available in eu-central-1 but at reduced rates (10 msg/sec/channel, 5 req/sec/user) and adds another service dependency. It does provide persistence, but NestSelf already has Socket.IO + PostgreSQL + Valkey.

**Recommendation:** Run Q&A, hand-raise, and polls over NestSelf's existing Socket.IO infrastructure backed by PostgreSQL. This gives full control over moderation, persistence, and privacy (attendee questions stored only in NestSelf's database, not in AWS). Chime data messages can supplement for ephemeral signals (typing indicators, reactions) if needed.

### 9. eu-central-1 availability summary (WEB-11, WEB-12, WEB-13, WEB-17)

All required services are available in eu-central-1 (Frankfurt):
- Chime SDK WebRTC meetings (including replication)
- Chime SDK Media Pipelines (capture, concatenation, live connector)
- Chime SDK Messaging (at reduced quotas vs us-east-1)
- Amazon IVS Low-Latency Streaming
- Amazon Transcribe (streaming, including hu-HU)
- AWS Elemental MediaConvert

The only limitation: media pipeline concurrent limit defaults to 10 in eu-central-1 (vs 100 in us-east-1). Request an increase before launch (WEB-41).

## Could not verify / open questions

1. **Exact total attendee ceiling with replication in eu-central-1.** The FAQ says "up to 10,000 attendees after requesting a limit increase" but does not confirm this applies per-region. The 250/meeting cap is documented as not adjustable; the 10,000 figure presumably means 40 replicas x 250 attendees. Confirm with AWS support for eu-central-1.

2. **Promoted attendee audio dropout.** GitHub issue #2441 reports loss of audio after ~40-50 minutes for promoted replica attendees. The issue remains open with "needs more information" status. Test thoroughly before relying on promotion for long webinars.

3. **SelectedVideoStreams interaction with CompositedVideo.** It is clear that SelectedVideoStreams filters which individual video streams are captured, and CompositedVideo with PresenterOnly layout controls the composited output. Whether both can be combined to produce a composited recording of only the presenter's video + content share (excluding all audience video) needs testing.

4. **Hungarian streaming transcription asterisk.** The Transcribe supported-languages page marks hu-HU streaming with an asterisk meaning "not available in af-south-1, ap-northeast-1, ap-southeast-5, ap-southeast-7, cn-northwest-1." eu-central-1 is NOT in the exclusion list, so it should work, but this was not tested end-to-end through Chime SDK.

5. **Whether Chime SDK will expand StartMeetingTranscription's LanguageCode enum.** The Chime FAQ lists only ~14 languages while Transcribe streaming now supports 54. There is no announced timeline for parity. A custom integration is the safe bet for sr-RS and hu-HU.

6. **IVS ingest region for eu-central-1 channels.** IVS uses a global ingest network; even channels created in eu-central-1 may have ingest routed through other regions. The Chime live connector sends RTMPS to the IVS endpoint, so latency from the connector to IVS ingest is dependent on network routing. No eu-central-1-specific latency figures were found.

7. **MediaConvert post-processing pipeline.** The recommendation to use MediaConvert for HLS/MP4 transcoding is based on general knowledge of MediaConvert capabilities. No Chime-SDK-specific documentation or blog post was found that describes a complete capture-to-VOD pipeline with MediaConvert. An S3 event trigger (on concatenation output) to a MediaConvert job is the standard pattern.

8. **Concurrent media pipeline limit in eu-central-1.** Default is 10 (adjustable). For concurrent webinars with recording, each needs one capture pipeline. If NestSelf runs more than 10 concurrent recorded sessions, a limit increase is required.
