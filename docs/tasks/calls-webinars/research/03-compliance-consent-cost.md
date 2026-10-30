# Compliance, consent and cost

Research date: 2026-10-24. Sources from 2022-2026 unless noted.

## Facts

### AWS Chime SDK -- compliance and data residency

| id | claim | source URL | confidence | as of |
|---|---|---|---|---|
| LAW-01 | Chime SDK is in scope for SOC 1/2/3, ISO 27001/27017/27018/27701/22301, CSA STAR, C5 (Germany), FINMA (Switzerland). All listed services are covered under all listed certifications. | https://aws.amazon.com/compliance/iso-certified/ ; https://aws.amazon.com/compliance/services-in-scope/SOC/ ; https://aws.amazon.com/compliance/services-in-scope/C5/ | high | 2026 |
| LAW-02 | Chime SDK is a HIPAA-eligible service (requires executed BAA). | https://aws.amazon.com/compliance/hipaa-eligible-services-reference/ | high | 2026-10-15 |
| LAW-03 | AWS has no GDPR-specific "services in scope" list. GDPR is addressed through the automatic Global AWS DPA, not a certification scope page. The GDPR Privacy Features page lists "Amazon Chime" (not separately "SDK") as supporting encryption, deletion, monitoring, and no remote access. | https://aws.amazon.com/compliance/services-in-scope/ ; https://aws.amazon.com/compliance/gdpr-center/service-capabilities | high | 2026 |
| LAW-04 | The AWS Global Data Processing Addendum (DPA) applies automatically to all customers whenever they use AWS to process personal data. No separate signature required. Announced April 2023, replacing the earlier GDPR DPA. EU 2021 SCCs and a Supplementary Addendum with government-access commitments are incorporated into Service Terms automatically. | https://aws.amazon.com/blogs/security/new-global-aws-data-processing-addendum/ ; https://aws.amazon.com/compliance/eu-data-protection/ | high | 2023-04 / 2024 |
| LAW-05 | eu-central-1 (Frankfurt) is a supported Chime SDK control region, media region, media-pipeline control region, and media-pipeline data region. Hardcoding the media region is recommended by AWS for regulatory data residency. Meeting events (EventBridge/SQS/SNS) are delivered in the control region. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-meetings-regions.html | high | 2026 |
| LAW-06 | AWS does NOT explicitly guarantee that no meeting metadata leaves the EU when both control and media regions are eu-central-1. Billing metadata and operational telemetry may be processed globally. | multiple AWS docs | medium | 2026 |
| LAW-07 | Media is encrypted in transit (DTLS + UDP; TLS/443 fallback). Audio is decrypted server-side for mixing then re-encrypted (NOT end-to-end encrypted). Video is forwarded via SFU and remains encrypted client-to-client. Media capture pipeline output in S3 supports SSE-S3 or SSE-KMS with customer-managed keys. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-faq.html ; https://docs.aws.amazon.com/chime-sdk/latest/dg/sse-kms.html | high | 2026 |
| LAW-08 | Live transcription with Amazon Transcribe in eu-central-1 uses eu-central-1 for standard Transcribe. Transcribe Medical would route to eu-west-1 (Ireland) -- a data residency concern. | https://docs.aws.amazon.com/chime-sdk/latest/dg/transcription-options.html | medium | 2026 |
| LAW-09 | ExternalUserId (attendee identifier) is stored as meeting metadata. AWS recommends not using PII directly. Meeting attendee quota: 250 standard, 100 HD; up to 10,000 with media replication. | https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-faq.html | high | 2026 |

### Serbia -- recording, telehealth, data protection

| id | claim | source URL | confidence | as of |
|---|---|---|---|---|
| LAW-10 | Criminal Code Art. 143: third-party secret recording punishable by fine or 3 months to 3 years. Whether a participant may record their own call is ambiguous -- the statute targets conversations "not intended for" the recorder, but no court ruling confirms participant recording is lawful. Prosecuted by private action. | https://www.wipo.int/wipolex/en/legislation/details/17052 | high (statute), low (interpretation) | 2016 consolidated |
| LAW-11 | ZZPL (Sl. glasnik RS 87/2018, in force 2019): health data is special category (Art. 17). Processing requires explicit consent (Art. 17(2)(1)) or processing by/under a health professional bound by secrecy. Lawful bases mirror GDPR (Art. 12). | https://www.paragraf.rs/propisi/zakon_o_zastiti_podataka_o_licnosti.html | high | 2018 |
| LAW-12 | DPIA mandatory (ZZPL Art. 54) for large-scale processing of special-category data including health data. Must include description, necessity/proportionality, risk assessment, mitigations. DPO must be consulted. Prior consultation with the Commissioner required if high residual risk remains (Art. 55). | https://www.paragraf.rs/propisi/zakon_o_zastiti_podataka_o_licnosti.html | high | 2018 |
| LAW-13 | Telemedicine is unregulated in Serbia. The Health Care Act (2019) neither recognises nor regulates it. Video counselling is not prohibited but not explicitly authorised. Standard of care unchanged; increased liability risk for distance services. | https://cms.law/en/int/expert-guides/cms-expert-guide-to-digital-health-apps-and-telemedicine/serbia | high | 2025-07-07 |
| LAW-14 | Commissioner's position: employers must NEVER know an employee's diagnosis. Fines: legal entity RSD 50,000-2,000,000 (~EUR 425-17,000); natural person up to RSD 2,000,000. | https://www.021.rs/info/srbija/319703/poverenik-ni-u-jednom-slucaju-poslodavac-ne-treba-da-zna-dijagnozu-radnika | high | 2022 |
| LAW-15 | Psychologists: professional secrecy under Art. 4 of Law on Conditions for Psychological Practice (Sl. glasnik RS 25/96, 101/2005). Lawyers: strong privilege (Zakon o advokaturi + Ethics Code Arts. 9, 14-16). Financial advisers: no specific confidentiality statute found. | https://www.minrzs.gov.rs/sites/default/files/2021-02/zakon_o_uslovima_za_obavljanje_psiholoske_delatnosti.pdf | medium | 1996/2005 |
| LAW-16 | Non-medical "wellbeing counselling" has no separate regulatory framework in Serbia. Data protection obligations are identical because health-related data remains a special category under ZZPL regardless of whether the service is labelled clinical or non-clinical. | https://cms.law/en/int/expert-guides/cms-expert-guide-to-digital-health-apps-and-telemedicine/serbia | medium | 2025 |
| LAW-17 | International transfers (ZZPL Arts. 63-67): EU/EEA is adequate by Convention 108. Transfers to non-adequate countries need Commissioner-approved SCCs, BCRs, or specific authorisation. | https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/serbia | high | 2026-03-10 |
| LAW-18 | Draft new PDPA released 2026-07-30: expands to 175 articles, adds video-surveillance chapter (6-month max retention), AI rules, raises minimum fine to RSD 200,000. Parliament dissolved for Oct 2026 elections; current 2018 law continues. | https://captaincompliance.com/news/serbias-draft-personal-data-protection-law-major-expansion-on-ai-surveillance-and-transfers/ | high | 2026-08 |

### Hungary -- recording, telehealth, data protection

| id | claim | source URL | confidence | as of |
|---|---|---|---|---|
| LAW-19 | Criminal: one-party consent (Btk. S 422 targets covert intrusion/interception, not a participant recording their own call -- Kuria BH 2014.5.134). Civil: Ptk. Art. 2:48 requires consent to make any voice/image recording; violation gives grievance damages (serelemdij) under Art. 2:52 without proof of financial harm. | https://www.recordinglaw.com/world-laws/world-recording-laws/hungary-recording-laws/ | medium | 2024 |
| LAW-20 | Telemedicine: Decree 60/2003 S 9(7) permits remote diagnosis, therapy, prescribing by healthcare workers. Made permanent via Decree 33/2020 (September 2020). Provider must ensure broadband, data security, patient identification, and a teleconsultation protocol. No comprehensive permanent framework has followed. | https://cms.law/en/int/expert-guides/cms-expert-guide-to-digital-health-apps-and-telemedicine/hungary | high | Sep 2025 |
| LAW-21 | Psychotherapy (Eutv. S 103): restricted to physicians or clinical psychologists with the psychotherapy added qualification. Non-clinical counselling is unregulated -- no licence needed, ordinary consumer law applies. | https://www.therapyroute.com/article/mental-health-licensing-regulation-in-hungary-2025-guide-by-therapyroute | medium | 2025 |
| LAW-22 | Health data: Act XLVII of 1997 governs health data processing; GDPR prevails in conflicts. Amended 2019 (Act XXXIV) for GDPR alignment. Medical confidentiality applies. | https://whitecase.com/insight-our-thinking/gdpr-guide-national-implementation-hungary | high | 2024 |
| LAW-23 | Attorney confidentiality: Act LXXVIII/2017 -- absolute secrecy over all facts obtained while practising, continues after cessation of practice. Financial adviser confidentiality: no specific statute found. | https://njt.hu/jogszabaly/en/2017-78-00-00 | high (attorneys), low (fin. advisers) | 2017 |
| LAW-24 | NAIH enforcement: Budapest Bank fined HUF 250M (~EUR 653K, 2022) for undisclosed AI analysis of call recordings. Employer fined HUF 15M (2024) for disproportionate monitoring. | https://www.recordinglaw.com/world-laws/world-recording-laws/hungary-recording-laws/ | medium | 2022/2024 |
| LAW-25 | Hungary transposed the EAA via Act XVII of 2022, obligations from 28 June 2025. Exact scope of national transposition for employee-only platforms is unconfirmed. | https://www.disabilityworld.org/regulations/hu/ | medium | 2025 |

### Retention, minimisation, consent UX

| id | claim | source URL | confidence | as of |
|---|---|---|---|---|
| LAW-26 | GDPR Art. 5(1)(e): personal data kept no longer than necessary; controller must define and justify the period. No fixed period mandated. | GDPR text | high | 2018 |
| LAW-27 | Counselling retention benchmarks: BACP notes 3-year complaint window; IACP recommends 7 years after last service; Edinburgh 5 years; Bradford 7 years; Talkspace 10 years (medical records equivalent). | https://www.bacp.co.uk/news/news-from-bacp/blogs/2026/ ; https://iacp.ie/files/UserFiles/Download-Area/IACP-Record-Keeping-and-Retention-Guidelines-V2.1.pdf ; https://www.talkspace.com/retention-policy | high | 2023-2026 |
| LAW-28 | Recording therapy sessions requires explicit GDPR Art. 9(2)(a) consent: freely given, specific, informed, unambiguous, before recording begins. Separate consent for each purpose. Withdrawal at any time under Art. 7(3). Right to erasure under Art. 17, with exceptions for legal claims defence and public health. | GDPR text; https://tandemhealth.ai/resources/knowledge/gdpr-therapy-session-recording-what-therapists-must-know | high | 2018/2026 |
| LAW-29 | EDPB WP248 rev.01: meeting 2+ criteria from the list (health data, vulnerable subjects, new technology, systematic monitoring) triggers mandatory DPIA under Art. 35. Video counselling hits at least 3. | https://ico.org.uk/for-organisations/guide-to-the-general-data-protection-regulation-gdpr/data-protection-impact-assessments-dpias/ | high | 2026 |
| LAW-30 | BetterHelp/Talkspace cautionary precedent: BetterHelp shared metadata with Facebook (2020); US Senate investigation followed. Lesson: metadata about counselling participation is itself sensitive. | https://www.npr.org/2022/07/18/1110699297/betterhelp-talkspace-privacy-data-tips-online-therapy | high | 2022 |

### Accessibility

| id | claim | source URL | confidence | as of |
|---|---|---|---|---|
| LAW-31 | EAA (Directive 2019/882) applied from 28 June 2025. Covers consumer-facing digital services. Recital 11 excludes products/services provided "only to persons acting in a professional capacity." Pure B2B/employee-only platforms are generally outside scope. | https://eye-able.com/blog/eaa-b2b | high | 2026-02 |
| LAW-32 | Employment Equality Directive 2000/78/EC: employers have reasonable-accommodation obligations. An inaccessible employee wellbeing platform could create liability regardless of EAA scope. | https://karlgroves.com/the-european-accessibility-act-and-b2b-software-what-internal-platforms-must-comply-with/ | medium | 2026 |
| LAW-33 | WCAG 1.2.4 (AA): live captions required for live audio in synchronised media (webinars). WCAG 1.2.2 (A): captions required for prerecorded audio (replays). WCAG 1.2.5 (AA): audio descriptions for prerecorded video. | W3C WCAG 2.2 | high | 2023-10-05 |
| LAW-34 | EN 301 549 v4.1.1 Clause 6: covers bidirectional voice/video communication including RTT interoperability, caller identification, video resolution/frame rate, and audio-video sync. | https://www.deque.com/blog/en-301-549-v4-1-1-is-final-what-changed-what-it-means-and-what-you-should-do/ | medium | 2026 |
| LAW-35 | Serbia has no enacted digital accessibility law. A national study is in preparation. RATEL telecom accessibility rulebook (2025) applies from June 2026 but covers telecom equipment, not web platforms. | https://www.danas.rs/drustvo/vlada-srbije-pocela-izradu-nacionalne-studije-za-procenu-digitalne-pristupacnosti-u-srbiji/ | medium | 2025 |

### Pricing

| id | claim | source URL | confidence | as of |
|---|---|---|---|---|
| COST-01 | Chime SDK Meetings: $0.0017/attendee-minute, billed in 6-second increments. Same rate for send, receive, and send-receive capability types. Content share included. No separate HD rate. | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| COST-02 | Media replication: $0.0085/minute/destination WebRTC session (on top of attendee-minutes). Up to 40 destinations for 10,000 standard participants. | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| COST-03 | Media capture pipeline: composited 1080p $0.0125/min; individual stream $0.0017/stream-min. Billed in 6-second increments. | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| COST-04 | Media concatenation pipeline: $0.002/minute of processed segments. | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| COST-05 | Media live connector (to RTMP/IVS): $0.09/stream-minute for HD video. | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |
| COST-06 | IVS low-latency input: Advanced HD $0.85/hr, Standard $2.00/hr, Basic $0.20/hr. Output (Europe Tier 1): HD $0.072/viewer-hr, SD $0.036/viewer-hr, audio-only $0.0072/viewer-hr. | https://aws.amazon.com/ivs/pricing/ | high | 2026-10 |
| COST-07 | Amazon Transcribe streaming: ~$0.024/min (tiered, first 250k min). EU rate unconfirmed; use $0.024/min for conservative budgeting. | https://aws.amazon.com/transcribe/pricing/ | medium | 2026-10 |
| COST-08 | S3 Standard (eu-central-1): ~$0.0245/GB/month. CloudFront Europe: first 1 TB/month free, then $0.085/GB. | https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/ ; third-party sources for S3 | high (CloudFront), medium (S3) | 2026-10 |
| COST-09 | Echo reduction pricing: not published on the AWS pricing page. May be included in the attendee-minute rate or may be an unlisted charge. | https://aws.amazon.com/chime/chime-sdk/pricing/ | low | 2026-10 |
| COST-10 | Volume discounts available with minimum commitments (contact AWS sales). | https://aws.amazon.com/chime/chime-sdk/pricing/ | high | 2026-10 |

---

## Cost model

### (a) 1:1 consultations (Chime SDK Meetings, no recording by default)

| Parameter | Value |
|---|---|
| Duration | 45 minutes |
| Attendees | 2 (expert + employee) |
| Rate | $0.0017/attendee-minute |
| Per-session cost | 45 x 2 x $0.0017 = **$0.153** |

| Scale | Attendee-minutes | Monthly cost |
|---|---|---|
| 500 consultations/month | 500 x 45 x 2 = 45,000 | **$76.50** |
| 2,000 consultations/month | 2,000 x 45 x 2 = 180,000 | **$306.00** |

Note: the existing D-22 estimate of $51/month for 500 x 30-min sessions is consistent ($0.0017 x 30,000 = $51). Our 45-min assumption raises the figure to $76.50.

### (b) Monthly webinar (60 minutes)

**Option A -- Pure Chime SDK (up to 250 per session; media replication beyond)**

| Attendees | Attendee-min | Meetings cost | Replication sessions | Replication cost | Total |
|---|---|---|---|---|---|
| 100 | 6,000 | $10.20 | 0 | $0.00 | **$10.20** |
| 300 | 18,000 | $30.60 | 1 x 60 min | $0.51 | **$31.11** |
| 1,000 | 60,000 | $102.00 | 3 x 60 min | $1.53 | **$103.53** |

Replication = ceil(attendees / 250) - 1 destinations; $0.0085/min/destination.

**Option B -- Chime SDK + IVS live connector (presenter in Chime, viewers on IVS)**

| Component | 100 viewers | 300 viewers | 1,000 viewers |
|---|---|---|---|
| Chime (1 presenter, 60 min) | $0.10 | $0.10 | $0.10 |
| Live connector HD (60 min) | $5.40 | $5.40 | $5.40 |
| IVS input (Advanced HD, 1 hr) | $0.85 | $0.85 | $0.85 |
| IVS output (HD Europe, per viewer-hr) | $7.20 | $21.60 | $72.00 |
| **Total** | **$13.55** | **$27.95** | **$78.35** |

**Summary: IVS wins above ~200 viewers** (Chime viewer cost $0.102/hr vs IVS $0.072/hr, but IVS carries fixed per-event overhead of $6.35).

### (c) Webinar recording + replay for 1,000 views

| Item | Arithmetic | Cost |
|---|---|---|
| Composited 1080p capture (60 min) | 60 x $0.0125 | $0.75 |
| Concatenation (60 min) | 60 x $0.002 | $0.12 |
| S3 storage (720p transcode, ~1.1 GB) | 1.1 x $0.0245 | $0.03/month |
| CloudFront delivery (1,000 views x 1.1 GB, 50% avg completion) | 550 GB, within 1 TB free tier | $0.00 |
| CloudFront delivery (1,000 full views x 1.1 GB) | 1,100 GB; 100 GB above free tier x $0.085 | $8.50 |

**Recording + replay total: $0.90 (realistic) to $9.40 (full-view upper bound).**

### Combined monthly totals

| Scenario | Consultations | Webinar | Recording + replay | **Monthly total** |
|---|---|---|---|---|
| Small (500 consults, 100-viewer webinar, 720p replay) | $76.50 | $10.20 | $0.90-$9.40 | **$87-$96** |
| Medium (500 consults, 300-viewer webinar, 720p replay) | $76.50 | $27.95 | $0.90-$9.40 | **$105-$114** |
| Growth (2,000 consults, 1,000-viewer webinar, 720p replay) | $306.00 | $78.35 | $0.90-$9.40 | **$385-$394** |

Excluded: Transcribe (~$1.44/hour if used), data transfer for signaling (negligible), MediaConvert for adaptive-bitrate transcoding.

---

## Recommendations for NestSelf

### 1. Hardcode eu-central-1 for control, media, and pipeline regions; use SSE-KMS for recordings
Ensures data stays in Frankfurt for both meeting media and capture output. Customer-managed KMS keys give NestSelf control over encryption at rest. Avoid Transcribe Medical (routes to eu-west-1). Rests on: LAW-05, LAW-06, LAW-07, LAW-08.

### 2. Do not use end-to-end encryption claims; acknowledge the audio-mixing architecture
Chime SDK decrypts audio server-side for mixing. Marketing and DPIAs should state "encrypted in transit and at rest" but not "end-to-end encrypted." The AWS DPA and ISO certifications cover the server-side processing. Rests on: LAW-07, LAW-01.

### 3. Require dual explicit consent before any recording; default to no recording
Both Serbian and Hungarian law require consent for recording (Serbia: ambiguous criminal law + clear ZZPL Art. 17 requirement; Hungary: Ptk. Art. 2:48 civil law requirement). Both parties must affirmatively opt in per session. Consent must be granular, logged with timestamp, and revocable. The UI must show a clear recording indicator. Rests on: LAW-10, LAW-11, LAW-19, LAW-28.

### 4. Complete a DPIA before launch (mandatory in both jurisdictions)
Video counselling hits 3+ EDPB high-risk criteria (health data, vulnerable subjects, new technology). ZZPL Art. 54 and GDPR Art. 35 both mandate a DPIA. Cover: Chime SDK data flows, metadata storage, consent mechanisms, encryption, access controls, retention schedule, cross-border transfer assessment, breach notification, and the employer-isolation architecture. Rests on: LAW-12, LAW-29.

### 5. Architect strict employer isolation: no diagnosis, no session content, no individual participation data
The Serbian Commissioner has stated employers must never learn an employee's diagnosis. The NAIH in Hungary has fined employers for disproportionate monitoring. NestSelf must ensure employer clients receive only aggregated, anonymised utilisation statistics. Individual session existence should not be visible to the employer. Rests on: LAW-14, LAW-24, LAW-30.

### 6. Position non-clinical services as "wellbeing counselling," not psychotherapy
In Hungary, psychotherapy is restricted to physicians or clinical psychologists with added qualifications (Eutv. S 103). In Serbia, telemedicine is unregulated, creating liability risk for clinical framing. Non-clinical wellbeing counselling avoids health-sector licensing in both countries, though data protection obligations remain identical because health-related data is still a special category. Ensure experts who do provide regulated services (psychotherapy, legal advice) hold the proper licences. Rests on: LAW-13, LAW-16, LAW-20, LAW-21.

### 7. Use Chime+IVS architecture for webinars above ~200 attendees
IVS is cheaper per viewer ($0.072/hr vs $0.102/hr), provides adaptive bitrate and player SDK, and handles thousands of viewers without WebRTC session management. Below ~200 viewers, pure Chime SDK is simpler and cheaper. Rests on: COST-01, COST-05, COST-06.

### 8. Store minimal session metadata; set 7-year retention for metadata, delete recordings promptly
Keep only: date, duration, pseudonymised participant IDs, session type, completion status. Never store verbatim transcripts or session content on the platform. Clinical notes belong in the expert's own professional record system, not NestSelf's database. Recordings (when they exist, e.g., webinar replays) should be retained only for the business purpose duration, then deleted. Session metadata: 7 years (covers IACP recommendation, BACP complaint window, standard limitation periods). Implement a right-to-erasure workflow. Rests on: LAW-26, LAW-27, LAW-28.

### 9. Build to WCAG 2.2 AA for video features now, even though the EAA may not strictly apply
The EAA's Recital 11 likely exempts pure B2B/employee platforms, and Serbia has no digital accessibility law. However: Hungary's transposition may be broader, the Employment Equality Directive (2000/78/EC) creates reasonable-accommodation obligations, and retrofitting is more expensive than building right. Provide live captions for webinars (WCAG 1.2.4, Amazon Transcribe Streaming), captions for replays (WCAG 1.2.2, Transcribe batch + human review), and keyboard-accessible video controls. Test caption accuracy in Serbian and Hungarian before launch. Rests on: LAW-31, LAW-32, LAW-33, LAW-35.

### 10. Budget $87-$394/month for video at launch scale; negotiate volume pricing early
At 500 consultations + 100-viewer webinar: ~$87-96/month. At 2,000 consultations + 1,000-viewer webinar: ~$385-394/month. The dominant cost is attendee-minutes for consultations. Volume discounts are available from AWS with minimum commitments; worth negotiating once NestSelf passes ~1,000 consultations/month. Rests on: COST-01, COST-10.

---

## Could not verify / open questions

1. **Serbia participant recording legality:** Art. 143 targets conversations "not intended for" the recorder; no court ruling confirms whether a call participant may record without the other's consent. Safe position: always require dual consent.

2. **Serbia Commissioner DPIA blacklist categories:** Decision in OG 45/2019, 112/2020 -- content available only in Serbian, specific categories not verified.

3. **Hungary Btk. S 223 and psychologists:** Whether psychologists are explicitly named in the professional-secrets criminal offence (alongside doctors, lawyers, clergy) could not be confirmed from English-language sources.

4. **Serbia telemedicine adoption 2024-2026:** Searched in English and Serbian; found nothing beyond the 2019 Health Care Act. A regulation may exist only in Serbian-language official gazettes.

5. **Financial adviser confidentiality in both jurisdictions:** No specific statute found in either country. General data protection law applies by default.

6. **Echo reduction pricing:** Not published on the AWS Chime SDK pricing page. May be bundled or separately billed.

7. **Amazon Transcribe eu-central-1 streaming rate:** Could not confirm the exact per-minute rate for the Frankfurt region. Used $0.024/min as conservative estimate.

8. **S3 eu-central-1 exact rate:** $0.0245/GB/month from third-party sources; official pricing page did not render region-specific data. High confidence given cross-source agreement.

9. **Hungary EAA transposition scope for employee platforms:** Act XVII of 2022 transposes the EAA, but whether it extends beyond the directive's consumer-facing scope to employee-only platforms is unconfirmed.

10. **Serbia draft PDPA timeline:** Released July 2026, consultation closed September 2026, but Parliament dissolved for October 2026 elections. Adoption timeline unknown.

11. **NAIH guidance on EAPs/wellbeing platforms:** No NAIH decision or guidance specifically addressing employee assistance programs was found. The closest is pandemic-era guidance on employer processing of employee health data.

12. **Transcribe Medical data residency:** Confirmed it routes to eu-west-1 for the eu-central-1 Chime media region, but this is for medical transcription only (which NestSelf should avoid).
