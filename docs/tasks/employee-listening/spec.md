# NestSelf Employee Listening and Workplace Reviews

## Product rules, user stories and implementation backlog

Version: 1.0  
Date: 31 October 2026  
Language: English  
Audience: Claude and other implementation agents, product, design, engineering, QA and NestSelf operations  
Status: Ready for repository inspection and staged implementation. All stories start as Not started. No delivery estimate or service price is implied.

## 1. Read this first

Build a module that helps employers understand employees' experience through recurring surveys, clear color-coded reporting and a protected channel for problems and suggestions. When a reportable result falls below a configured threshold, offer the employer a way to request and book a workplace review with NestSelf. NestSelf professionals interpret the context and author the resulting recommendations.

The core journey is:

**Measure -> show score and status -> offer a NestSelf review -> explicitly request/book a professional engagement -> human assessment and recommendations -> agreed actions -> later measurement.**

### 1.1 Confirmed product decisions

| Decision | Required behavior |
| --- | --- |
| Measurement and professional engagement are separate | Measurement belongs to the organization's contracted platform capabilities. A workplace review is a separately requested and separately scoped professional service. |
| Professionals author recommendations | A low score can reveal a review invitation. The product does not generate interventions, workshops, policy changes, diagnoses or improvement plans from the score. |
| Results use colors | Green, amber and red communicate the measured state. Gray communicates unavailable, suppressed or stale results. Always include a text label and value when reportable. |
| A low result can lead to a booking | An authorized employer user can explicitly request a NestSelf workplace review and proceed through the applicable scope, price/approval and scheduling flow. |
| Employees can raise issues | Provide a protected, employer-anonymous channel with follow-up conversation, clear recipients and case handling. |
| Organizational insight is aggregate | Employer survey reporting never exposes named responses, individual completion lists, private employee tools or consultation records. |
| Human work and measurement remain independent | Booking, purchasing or completing a review does not change a score, color or questionnaire result. |

The numeric thresholds, cadence, freshness window and initial questionnaire below are implementation defaults for a pilot. They are not claims of a validated clinical instrument or an industry-wide standard.

### 1.2 Instructions to the implementing agent

1. Read the repository's applicable `AGENTS.md` files and existing architecture before editing. Reuse current naming, packages, migrations and testing conventions.
2. Read the existing NestSelf product flows, authentication strategy and employee tools specification where available. This document adds a module; it does not replace those foundations.
3. Inspect existing identity, membership, grants, organization, CMS, scheduling, service requests, quotes, notifications and billing modules. Reuse them through explicit interfaces.
4. Implement one end-to-end slice at a time in the order in section 13. Keep unfinished capabilities behind feature flags. Do not substitute a visual mock for an actual persisted workflow.
5. Treat acceptance criteria and calculation fixtures as observable contracts. Record material departures and the reason in the repository's decision log.
6. Use the pilot defaults for routine implementation decisions. Never invent a professional-service price, payment authorization, legal certification or promise of technical anonymity.
7. No AI recommendation engine is needed for this module. All employer recommendations originate in a human-authored review report.
8. Finish each slice with meaningful tests for its calculations, access boundaries and state changes. Report implemented story IDs and remaining dependencies.

### 1.3 Relationship to existing NestSelf work

| Existing foundation | How this module uses it |
| --- | --- |
| Authentication strategy | Cognito authenticates; the application resolves membership and grants from its database. Existing web sessions, step-up requirements and mobile authentication remain authoritative. |
| Product flows and user stories | Reuse the Employee, Organization, Expert and NestSelf operations workspaces; scoped grants; organization tree; requests; scheduling; quotes; funding/approval boundaries. |
| Employee Tools and Expert Studio | Reuse suitable rich-text, preview, localization and question-authoring components. Employee tools and journals remain private and are not survey data sources. |
| CMS | Reuse the blog editor component and document format for review reports and published updates. Reports have restricted delivery and their own publication rules. |
| Service catalog | Represent workplace reviews as organization-facing services with explicit scope, applicable pricing and qualified providers. |

An organizational feedback case is a separate restricted domain from a private therapy/advisory case. Employer case handlers must never acquire access to professional support records through this module.

## 2. Scope and delivery priorities

P0 means required for the relevant pilot flow. P0-IF means required before the optional capability is enabled. P1 is a subsequent extension. The module does not require all P0 stories to be released in one deployment.

### 2.1 First complete pilot

- A NestSelf-owned, versioned five-question survey template.
- Recurring organization-wide survey cycles with fixed audience snapshots.
- Voluntary employee participation, a clear privacy notice and limited reminders.
- Finalized, protected survey reporting with cards, trends and a department heatmap where safe.
- A review invitation for current, reportable red results.
- An explicit employer request and real scheduling path, with separate scope and commercial acceptance for the professional service.
- A NestSelf queue, assigned reviewer, human-authored report and follow-up.
- A protected employee feedback channel with a named recipient function, an alternate route, two-way conversation and case statuses.
- Essential notifications, retention controls, security audit events and privacy-safe exports.

### 2.2 Later extensions

Custom employer survey templates; multi-question factors; eNPS; onboarding and exit surveys; deeper organization-tree navigation; attachments; employee idea voting; additional benchmarks; additional professional-service packages.

Automated organizational advice, employee risk ranking, performance scoring, clinical diagnosis, analysis of private journals, individual attrition prediction and automatic service purchases are outside this implementation.

## 3. People, workspaces and permissions

Use permission grants with explicit organization and resource scope. Templates make assignment convenient; job titles do not authorize access.

| Actor | Main responsibilities | Boundary |
| --- | --- | --- |
| Employee | Answer an eligible survey; submit a problem or suggestion; read and reply to own feedback case; view employer-published updates | Own records and deliberately shared organizational information only |
| Organization survey administrator | Configure permitted cadence/audience; launch or schedule cycles; see permitted aggregate reports | No identifiable response or completion list |
| HR/reporting user | Review approved aggregate reports and request a professional review if granted | Report access does not imply feedback-case access or spending authority |
| Team/department manager | See permitted aggregates for an assigned scope; participate in agreed actions | No automatic descendant access; no individual survey history |
| Designated feedback handler | Read and respond to assigned organizational feedback cases | Separate case grant; reporter identity is excluded |
| Alternate/conflict recipient | Handle a case that cannot safely go to the usual recipient | Same restriction and need-to-know scope |
| Employer commercial approver | Accept a defined review scope/quote under existing authority rules | Separate from survey reporting permissions |
| NestSelf listening administrator | Maintain approved templates, client configuration and safe reporting policies | Administrative authority does not grant raw employee records |
| NestSelf review coordinator | Triage review requests, assign qualified professionals and arrange logistics | Operational metadata and explicitly shared aggregates only |
| Assigned workplace reviewer | Read the authorized aggregate review pack; conduct the assessment; write findings and recommendations | Specific engagement, scope and validity period |
| NestSelf support | Resolve account and delivery problems | No raw survey answers, feedback bodies or private professional data |

Suggested actions to reconcile with existing authorization conventions:

`listening.configure`, `listening.templates.write`, `listening.templates.publish`, `listening.cycles.manage`, `listening.respond.self`, `listening.reports.read`, `listening.reports.export`, `feedback.create.self`, `feedback.read.self`, `feedback.reply.self`, `feedback.handle`, `feedback.assign`, `workplace_reviews.request`, `workplace_reviews.coordinate`, `workplace_reviews.scope.accept`, `workplace_reviews.engagement.read`, `workplace_reviews.report.write`, `workplace_reviews.report.publish`, `workplace_reviews.actions.manage`.

Enforce decisions in HTTP handlers, background jobs, exports, file access and real-time subscriptions. Resolve tenant scope from trusted memberships/grants. A client-supplied organization ID is never sufficient authorization.

## 4. Product rules and pilot defaults

### 4.1 Questionnaire

Use one positively keyed question per dimension in the pilot. A higher response always means a better experience. Answers are 1-5, with an explicit Skip option. All questions refer to the previous two weeks.

| Dimension key | Working employee question | Scale meaning |
| --- | --- | --- |
| `job_satisfaction` | How satisfied have you been with your experience at work over the past two weeks? | 1 Very dissatisfied; 5 Very satisfied |
| `sustainable_workload` | To what extent have you been able to complete your work within reasonable working hours? | 1 Not at all; 5 Completely |
| `manager_support` | To what extent have you received the support you need from your manager? | 1 Not at all; 5 Completely |
| `speaking_up` | How comfortable have you felt raising a problem without fear of negative consequences? | 1 Not at all comfortable; 5 Very comfortable |
| `belonging_respect` | To what extent have you felt respected and included in your team? | 1 Not at all; 5 Completely |

These are working product questions requiring an appropriate content review before publication. Preserve the dimension key, scale direction and wording version. Do not present them as copied or validated competitor instruments.

The pilot has no embedded free-text survey question. The completion screen links to the separate problem/suggestion composer, which explains its recipients and creates a case only when the employee explicitly submits it. This keeps aggregate measurement and individual correspondence understandable.

### 4.2 Cycle and audience rules

| Setting | Pilot default |
| --- | --- |
| Cadence | Every 14 days |
| Response window | 7 days; launch dates are 14 days apart |
| Reminder limit | At most two per cycle, only while open and only to still-eligible non-submitters |
| Audience | Active eligible memberships at launch; snapshot once |
| Team attribution | One primary department from the launch snapshot; no double counting across project teams |
| New starters after launch | Enter the next cycle |
| Internal transfers during a cycle | Keep the launch-snapshot reporting attribution for that cycle |
| Membership ended before submission | No new submission; cancel queued survey reminders |
| Results during collection | Collecting state; no live score or live completion count in employer views |
| Publication | A finalized cycle produces one immutable reporting snapshot |
| Current-result freshness | 45 days after cycle close, configurable for future cycles |
| Time | Store instants in UTC; calculate schedules and labels in the organization's configured timezone |

Submission is permitted only while `opens_at <= server_accepted_at < closes_at` and eligibility still holds. Take `server_accepted_at` inside the submission transaction after acquiring the cycle's acceptance lock and rechecking that it is Open. A browser start time or HTTP arrival time is not acceptance. The finalizer obtains the corresponding exclusive closing lock and waits for already accepted submission transactions to settle; an answer accepted before close is included even if that transaction finishes committing just after close. Requests acquiring the acceptance lock at or after close are rejected. Use an equivalent repository-native concurrency mechanism if it preserves these observable guarantees. Finalization must be safely retryable.

An employee may submit after answering at least one rating question. Skipped items are excluded from the item's denominator. A respondent is counted once per cycle and once per answered dimension.

### 4.3 Scoring contract

For a reportable dimension:

```text
valid_count = number of submitted answers with values 1, 2, 3, 4 or 5
favorable_count = number of submitted answers with values 4 or 5
neutral_count = number of submitted answers with value 3
unfavorable_count = number of submitted answers with values 1 or 2

score = decimal_round_half_up(100 * favorable_count / valid_count, 1)
```

Use decimal/rational-safe calculations. The official score has one decimal place; classify that same score so the displayed result and color agree. Store numerator, denominator, algorithm version and score in the protected aggregate pipeline. Report views receive only fields that pass disclosure checks.

| Score/status | Color token | Employee-facing/HR label |
| --- | --- | --- |
| `score >= 75.0` | `success` | Good |
| `60.0 <= score < 75.0` | `warning` | Monitor |
| `score < 60.0` | `danger` | Needs attention |
| No displayable current score | `neutral` | A reason-specific label |

Gray reasons: `collecting`, `not_measured`, `insufficient_responses`, `privacy_suppressed`, `stale`. Permission denial is an access decision, not a gray cell containing unauthorized context.

Use one shared scoring/status function across cards, heatmaps, exports and review-offer eligibility. A suppressed value is `null`, never zero. Historical reportable scores retain their historical status; the current dashboard labels an outdated latest result as stale and disables score-triggered invitations for that result.

The pilot has no composite overall happiness score. The organization overview shows the five dimensions. This avoids a good dimension concealing another dimension that needs attention. A later composite requires its own explicit weighting and disclosure policy.

### 4.4 Reporting context

Every reportable dimension includes its period, score, text status and permitted response/coverage context. Show the percentage of favorable, neutral and unfavorable answers only if that distribution passes the same disclosure policy. A high favorable percentage is a survey result, not a diagnosis or proof of causation.

Trend is the change in the same dimension between two finalized comparable cycles, in percentage points. Questionnaire meaning, scale, scoring and population scope must be compatible. A wording/definition change that affects comparability breaks the trend. Display participation and scope changes alongside comparisons. Do not label a small change statistically significant without an implemented and appropriate method.

### 4.5 Review-offer eligibility

Show one consolidated score-triggered offer when all conditions hold:

1. The measurement capability is enabled for the organization and a workplace review service is available to it.
2. The viewer has `workplace_reviews.request` for the displayed scope.
3. At least one dimension in that scope has a current finalized, privacy-approved `danger` status.
4. There is no active request/engagement already covering that scope and issue set. An existing item produces a progress card instead.
5. The viewer has not dismissed the offer for that report cycle. Dismissal does not hide the red measurement.

The offer's factual explanation may name reportable dimensions, their scores and comparable trends. Its fixed copy offers human review; it never proposes a cause, intervention, purchase or treatment automatically.

Suggested working copy:

> **Workload needs attention**  
> 48.0% of responses were favorable in the latest survey.  
> Our team can review these results with you, understand the context and prepare proposals for improvement.  
> **Request a workplace review**

Use `Book a workplace review` only when the next flow can actually confirm a catalog-defined appointment with applicable terms. A request requiring triage is labeled `Request`. A requested appointment is not displayed as confirmed until scheduling succeeds.

Green and amber results still allow an authorized user to request a review from the service entry point. Insufficient or stale data does not produce a score-triggered offer. The service remains optional in all states.

### 4.6 Commercial separation

- A red score creates no billable engagement, appointment, spending reservation or employer funding charge.
- Submitting a review request creates an operational request only.
- Before a paid engagement is accepted, the organization sees scope, deliverables, price/currency, terms and applicable approval requirements.
- A zero-price introductory meeting is allowed only when explicitly configured as such. Do not assume the first meeting or the audit is free.
- Reuse the existing quote, approval, scheduling and finance mechanisms. An unknown price means Request a quote, not a fabricated number.
- Accepting a scope/quote and confirming an appointment are separate recorded events. Both must use current authority and agreed terms.
- Do not route an organization review through an employee's private therapy/advisory allowance or personal benefits wallet.

## 5. Privacy and reporting contract

### 5.1 Precise anonymity promise

The pilot uses authenticated participation and a pseudonymous feedback mailbox. The employer cannot access survey-to-identity mappings, named completion or the identity behind an employer-anonymous feedback case. NestSelf may hold a restricted technical link for eligibility, duplicate prevention, reminders, the employee's own access and retention operations.

Describe this as identity-protected/confidential processing with anonymity toward the employer. Do not claim that the platform is cryptographically unable to link a submission to an account. Full unlinkability or account-independent reporting is a separate future architecture.

Store eligibility/participation linkage separately from answer payloads and case content. No ordinary employer, support, platform-admin or reviewer endpoint can resolve a reporter or a survey answer to a person. A platform-administrator label does not grant identity lookup. Exceptional identity access is not implemented by adding an impersonation or reveal-author button; any future exceptional path needs a separately governed policy.

Employee notices must explain who receives a case, what the employer can see, what NestSelf technically processes and that details the employee writes can reveal their identity.

### 5.2 Minimum cohort and safe views

Pilot minimum: **10 distinct respondents for the particular dimension in each displayed cohort**. Ten eligible employees or ten submissions to some other question do not satisfy this rule.

P0 supports company totals and one level of disjoint primary departments. Do not add arbitrary date ranges, overlapping project-team reports, combined demographics or drill-down to individuals.

Apply primary suppression first. Protect against subtracting displayed child cohorts from a parent to reconstruct a smaller hidden cohort. For the disjoint pilot hierarchy:

1. Hide every child cell with fewer than 10 valid respondents to that dimension.
2. For a reportable parent, calculate the combined respondent set of hidden children, including any residual/unassigned cohort.
3. If that hidden union contains 1-9 respondents, hide additional publishable child cells until its union contains at least 10. Select deterministically, starting with the smallest publishable child cohort, then stable cohort ID as a tie-breaker.
4. If safe parent/child disclosure cannot be established, withhold the conflicting totals or child detail. Prefer a broader safe company view.
5. Apply one canonical suppression plan across scopes, cards, heatmaps, drill-downs, distributions, exports and expert packs. A second endpoint must not expose a previously hidden value or denominator.

This is the minimum P0 rule for disjoint views, not a general privacy solution for arbitrary reporting. Privacy fixtures must pass before department reporting is enabled. Company-only reporting can ship as an earlier slice with its own minimum-cohort check.

Do not show exact small response counts or distributions inside a suppressed cell. Participation reporting also uses safe scopes and disclosure checks; it never exposes a person-by-person status list. Suppressed departments display a neutral reason, with no color-triggered review offer for that hidden result.

### 5.3 Other boundaries

- Employer reports never read private employee tools, mood journals, achievements, benefit usage or clinical/advisory conversations.
- A reviewer receives an explicitly approved aggregate pack, not all organization data, raw answers or feedback cases.
- A feedback handler can process an assigned individual case even in a small company. Statistical cohort thresholds do not block delivery of a report to the recipients disclosed to its author.
- General search, error tracking, analytics events, request logs and notification bodies exclude answer values, feedback text, personal mappings and review findings.
- Employer exports contain only the same approved aggregate fields visible in the report. They are not a raw-response export.
- Retention is configured by data class. Survey linkage, raw answers, feedback, professional-engagement documents and financial records do not inherit one blanket policy.
- Finalized reports are immutable. A correction requires a versioned release process and a privacy check across already released versions; do not expose an incremental change that isolates a removed answer.
- Record access and consequential changes as security audit events without copying restricted content into the event payload.

## 6. Screen inventory and main journeys

### 6.1 Employee workspace

| Screen | Main content and actions |
| --- | --- |
| Home survey card | Survey purpose, due date, duration, privacy summary, Start/Continue |
| Survey introduction | Recipient/reporting rules, voluntary participation, versioned notice |
| Survey questions | One clear question at a time or a compact accessible form; 1-5 labels; Skip; save state |
| Completion | Submission receipt; optional link to submit a separate problem/suggestion |
| Share feedback | Problem/suggestion/category; disclosed recipient function; employer-anonymous mode; optional context |
| My feedback | Own threads with current state, unread reply and next action |
| Feedback conversation | Reporter-visible messages, safe status and reply composer |
| Changes at work | Employer-published organizational updates and safe action summaries |

### 6.2 Organization workspace

| Screen | Main content and actions |
| --- | --- |
| Listening overview | Five dimension cards, safe participation context, period, trends, current-result freshness |
| Team heatmap | Allowed disjoint departments by dimension; color, value, status and suppression states |
| Dimension detail | Definition, safe distribution, past comparable cycles and review request entry |
| Surveys | Approved template, audience preview, schedule and cycle states |
| Feedback inbox | Assigned cases only; category, urgency, state, owner and due target |
| Case detail | Restricted two-way thread, internal notes and conflict-aware reassignment |
| Workplace reviews | Own requests/engagements, scope/terms, appointments, shared reports and follow-up |
| Agreed actions | Human-authored and accepted actions with owners, due dates and safe employee visibility |
| Settings | Granted configuration, recipients/alternates, entitlements and report visibility |

### 6.3 NestSelf operations and expert workspace

Operations has a review-request queue with owner, next action and due target. Assigned professionals have their own engagements, approved aggregate packs, appointment logistics and report editor. Sensitive feedback handling is a separately assigned function; coordinating an audit does not grant feedback access.

### 6.4 Core journeys

**Survey:** eligible employee opens invitation -> reads privacy notice -> answers/skips -> submits -> receives confirmation -> finalized aggregates become available after the cycle.

**Low score:** authorized employer sees a reportable red dimension -> opens the invitation -> explicitly requests review -> NestSelf triages -> organization accepts applicable scope/terms -> real appointment is confirmed -> reviewer conducts work -> human-authored report is shared -> organization agrees actions -> later measurement provides context for follow-up.

**Feedback:** employee chooses problem or suggestion -> sees recipients and anonymity limits -> submits -> designated handler receives case -> reporter and handler exchange messages -> handler records outcome -> reporter can comment on whether the response helped or ask for clarification.

## 7. User stories

Each story's acceptance criteria are mandatory for its declared priority. Dependency references may refer to foundations outside this document.

### Epic A: Configuration, identity and access

#### CFG-01 - Enable measurement and professional services separately

**P0 | Actor:** NestSelf client operations  
**Story:** As client operations, I configure measurement, employee feedback and workplace review availability separately so the product reflects the actual contract.  
**Depends on:** Existing organization, catalog and entitlement foundations.

Acceptance criteria:
- Each capability has an explicit organization-level setting and effective dates; disabled backend operations are rejected.
- A measurement subscription never creates a professional engagement or individual service entitlement.
- Review-request availability resolves from the organization-facing catalog and policy; absent pricing uses a quote path.
- Removing an entitlement stops new relevant work without silently deleting existing records or charging for them.
- Configuration changes are audited with actor, scope, effective time and safe field names.

#### CFG-02 - Grant scoped responsibilities

**P0 | Actor:** Authorized organization/NestSelf access administrator  
**Story:** As an access administrator, I delegate survey reporting, case handling and commercial approval independently so each person sees only the work they should perform.  
**Depends on:** Existing authorization engine.

Acceptance criteria:
- Report, export, feedback-handler, review-request, review-acceptance and reviewer grants are independently assignable within delegation limits.
- A manager relationship, company ownership or platform-admin label does not bypass restricted-domain rules.
- Scope is checked on list, detail, mutation, file and real-time operations, including direct object IDs.
- Grant revocation takes effect under the existing authorization freshness policy; queued user-initiated jobs recheck authority.
- An effective-access preview explains which permitted scope a grant enables without exposing private records.

#### CFG-03 - Configure pilot rules with immutable versions

**P0 | Actor:** NestSelf listening administrator  
**Story:** As a listening administrator, I manage questionnaire, threshold, privacy and schedule versions so published results remain reproducible.  
**Depends on:** CFG-01, CFG-02.

Acceptance criteria:
- Questionnaire, score thresholds, reporting minimum, freshness and algorithm versions are stored explicitly.
- Launching a cycle locks its relevant rules and notice version; later changes affect only future cycles.
- The reporting minimum cannot be lowered below the approved platform floor through a client setting.
- A color-threshold change never silently recolors a past published report.
- The UI previews affected future cycles and preserves a change history.

### Epic B: Survey templates and cycles

#### SUR-01 - Create and publish the core questionnaire

**P0 | Actor:** NestSelf survey content owner  
**Story:** As a content owner, I maintain the five core questions in a simple editor so measurement is consistent and understandable.  
**Depends on:** CFG-02, CFG-03; existing authoring components.

Acceptance criteria:
- Authoring supports dimension key, localized wording, scale labels and a plain-language explanation; no scripts or formula entry is exposed.
- All pilot questions use 1-5 with higher meaning better and an explicit Skip option.
- Draft, in-review, published and archived states exist; publication requires the appropriate grant.
- A phone/desktop preview displays exactly the wording and scale employees will receive.
- Used published versions are immutable. Editing creates a new version and records whether comparisons remain meaningful.

#### SUR-02 - Schedule recurring survey cycles

**P0 | Actor:** Organization survey administrator  
**Story:** As a survey administrator, I select a permitted audience and recurring schedule so employees receive a short survey at a predictable cadence.  
**Depends on:** SUR-01, CFG-01.

Acceptance criteria:
- Defaults are 14-day cadence, 7-day response window and at most two reminders; dates are previewed in organization time.
- The system validates `closes_at > opens_at`, an available published template and a permitted organization audience.
- A launch takes an immutable membership/primary-department snapshot with a unique cycle ID.
- Duplicate launch jobs cannot create duplicate cycles, audiences or notifications.
- The administrator sees safe audience totals, template version and schedule, not named participation status.

#### SUR-03 - Apply membership changes predictably

**P0 | Actor:** Platform  
**Story:** As the platform, I handle starters, leavers and transfers consistently so eligibility and reporting remain understandable.  
**Depends on:** SUR-02; existing membership events.

Acceptance criteria:
- New starters after launch enter the next cycle; they cannot access an unrelated invitation.
- A transfer does not move already collected answers into a new department for that cycle.
- An ended membership cannot submit or receive additional survey reminders.
- Answers submitted before membership ended remain handled under the applied data policy and original cohort snapshot.
- One person/membership contributes once to the relevant organization's cycle; project-team overlap does not multiply responses.

#### SUR-04 - Close and finalize a cycle safely

**P0 | Actor:** Platform  
**Story:** As the platform, I finalize each cycle once so every consumer uses the same protected result.  
**Depends on:** EMP-02, SCO-01, PRI-01, PRI-02.

Acceptance criteria:
- Submission and finalization respect the server-time boundary in section 4.2, including accepted in-flight transactions.
- Finalization atomically selects accepted submitted responses, calculates aggregates and applies disclosure rules.
- A result is not published until the complete snapshot succeeds; partial calculations remain unavailable.
- Retrying a failed worker produces one published result and one logical publication event.
- Cancellation stops collection/reminders and produces no partial employer result; a published cycle cannot be canceled to erase an unfavorable result.

#### SUR-05 - Add custom or lifecycle surveys later

**P1 | Actor:** Organization survey administrator  
**Story:** As a survey administrator, I use approved custom, onboarding or exit surveys without misleading comparison or confidentiality promises.  
**Depends on:** All P0 survey and privacy stories.

Acceptance criteria:
- Custom templates retain versioned dimensions, scale direction, notice and reporting rules.
- Custom/lifecycle answers do not enter core dimensions without an explicit validated mapping and version change.
- Small onboarding/exit cohorts remain suppressed or use a separately disclosed confidential operating model.
- A change of question meaning starts a separate trend series.
- The first release requires no general-purpose questionnaire programming or scoring builder.

### Epic C: Employee survey participation

#### EMP-01 - Understand the invitation and privacy

**P0 | Actor:** Employee  
**Story:** As an employee, I understand why I am being asked and what my employer can see before I participate.  
**Depends on:** SUR-02, CFG-02.

Acceptance criteria:
- The entry card shows purpose, estimated duration, due date and Start/Continue with the correct organization context.
- The introduction explains voluntary participation, employer aggregate access, the cohort rule and NestSelf's restricted technical linkage.
- The employee can read the full applied privacy notice and leave without answering.
- No form implies a diagnosis, performance assessment or obligation to disclose personal health information.
- A manager using their personal workspace receives the same employee privacy treatment as other respondents.

#### EMP-02 - Answer, save and submit once

**P0 | Actor:** Employee  
**Story:** As an employee, I answer a short survey on my phone and know whether my response was saved and submitted.  
**Depends on:** EMP-01.

Acceptance criteria:
- Questions support keyboard/screen-reader use, labeled values 1-5, Skip and back navigation.
- Drafts save privately with Saving, Saved and Could not save states; drafts never enter results.
- Submission requires at least one valid answer and rechecks cycle state, active eligibility and organization scope.
- A unique participation constraint and idempotency key prevent two submissions across retries/devices.
- A confirmed submission is immutable in the employee form; repeated opens show a receipt without creating a second response.

#### EMP-03 - Receive limited, neutral reminders

**P0 | Actor:** Employee  
**Story:** As an employee, I receive useful reminders while my individual participation remains hidden from the employer.  
**Depends on:** EMP-02; existing notification preferences.

Acceptance criteria:
- Only still-eligible non-submitters receive scheduled reminders; the rule is rechecked at dispatch.
- At most two reminders are sent per cycle, within permitted local-time delivery windows.
- Notification text contains no answer, score, response timestamp or sensitive context.
- Employer administration has no export or API revealing who received, opened or completed an invitation.
- A reminder retry is deduplicated; opted-out channels follow the existing preference policy.

#### EMP-04 - Share separate feedback after a survey

**P0 | Actor:** Employee  
**Story:** As an employee, I can explain a problem or propose a change after answering without confusing that conversation with aggregate measurement.  
**Depends on:** EMP-02, FBK-01.

Acceptance criteria:
- The completion screen offers the separate feedback composer and explains its disclosed recipients.
- Opening or dismissing the composer creates no case.
- Survey answers are not prefilled, attached or linked into the case for the employer.
- Submitting feedback is optional and does not affect the confirmed survey response.
- The resulting thread follows the same case privacy and routing rules as feedback submitted from Home.

### Epic D: Scoring and reporting

#### SCO-01 - Calculate dimension favorability

**P0 | Actor:** Platform  
**Story:** As the platform, I calculate every dimension using one reproducible formula so results agree everywhere.  
**Depends on:** Published questionnaire and submitted responses.

Acceptance criteria:
- Only valid submitted answers count; values 4/5 are favorable, 3 neutral and 1/2 unfavorable.
- Skipped items and drafts never enter the numerator or denominator.
- One-decimal round-half-up scoring follows section 4.3; division by zero returns unavailable.
- Raw counts and algorithm versions remain in the protected pipeline, with no employer raw-answer endpoint.
- The golden fixtures in section 14 pass in automated tests.

#### SCO-02 - Assign colors and freshness

**P0 | Actor:** Platform  
**Story:** As the platform, I assign a clear status to a reportable result so cards, heatmaps and review invitations remain consistent.  
**Depends on:** SCO-01, CFG-03, PRI-01, PRI-02.

Acceptance criteria:
- Official scores 75.0+ are green, 60.0-74.9 amber and below 60.0 red under the pilot policy.
- Unavailable/suppressed scores are null with a gray reason, never 0% or red.
- Freshness is calculated from cycle close using the applied policy; an outdated latest result is gray on the current overview.
- Historical reports retain their cycle-specific scores/statuses and clearly state their period.
- UI code and export code consume the same backend classification; purchasing a review cannot alter it.

#### SCO-03 - Compare compatible periods

**P0 | Actor:** HR/reporting user  
**Story:** As a reporting user, I compare the same dimension over time with enough context to avoid false conclusions.  
**Depends on:** SCO-01, SCO-02, reporting snapshots.

Acceptance criteria:
- Trend is expressed in percentage points, not as an ambiguous relative percentage.
- A comparison requires compatible wording/scale/scoring and the same defined organizational scope.
- Incompatible versions show Comparison unavailable and explain the changed definition.
- Each period independently passes disclosure rules; one hidden endpoint is not reconstructed by a displayed delta.
- The view shows safe participation/context information and labels a changed cohort structure where applicable.

#### REP-01 - Read organization overview cards

**P0 | Actor:** HR/reporting user  
**Story:** As a reporting user, I see the state of the five dimensions quickly and can identify which need attention.  
**Depends on:** SCO-01..03, CFG-02.

Acceptance criteria:
- Each card includes dimension, official score when reportable, color, text status, reporting period and safe response context.
- Loading, collecting, no data, suppressed, stale, error and permission-denied states are distinct.
- A red dimension stays visible even when other dimensions are green; no composite masks it.
- Sorting or emphasis may surface red dimensions but never generate explanations of their causes.
- The overview is usable on mobile and retains meaning without color perception.

#### REP-02 - Compare departments in a protected heatmap

**P0 | Actor:** HR or scoped manager  
**Story:** As an authorized user, I compare allowed departments across dimensions so I can see where experiences differ.  
**Depends on:** REP-01, PRI-01, PRI-02.

Acceptance criteria:
- Rows use the fixed disjoint company/department cohort model; columns use the five dimensions.
- Each reportable cell shows value and a status accessible by keyboard/focus; suppression shows a neutral placeholder.
- Access scope and canonical suppression are enforced by the API, including direct cell/detail requests.
- Colors indicate fixed score bands in the default view. A future relative-comparison mode must have a separate legend and label.
- Arbitrary combined filters, small subteams and overlapping project cohorts are unavailable in P0.

#### REP-03 - Explore a dimension without exposing people

**P0 | Actor:** HR/reporting user  
**Story:** As a reporting user, I inspect a dimension's definition and trend before deciding whether to request help.  
**Depends on:** REP-01, SCO-03.

Acceptance criteria:
- Detail shows the question/version, period, score, safe distribution and comparable historical series.
- Suppression and scope rules apply independently to every historical point and distribution field.
- The view offers an eligible human-review request entry without generated intervention suggestions.
- The user cannot drill into respondents, individual completion, precise submission times or employee support usage.
- Export access is independently checked rather than inferred from page visibility.

#### REP-04 - Export the same safe results

**P0 | Actor:** Authorized reporting exporter  
**Story:** As an exporter, I download the aggregate view I am permitted to share so the file agrees with the dashboard.  
**Depends on:** REP-01..03, PRI-01..02; existing controlled-file delivery.

Acceptance criteria:
- CSV contains only authorized aggregates, labels, periods, applied versions and non-identifying status fields.
- Suppressed values, unsafe counts and unauthorized scope remain absent/null in the export.
- Access is checked at request, generation and download; files use restricted delivery and expiry.
- Spreadsheet formula-leading text is escaped safely in CSV output.
- Export creation/access is audited; no generic raw-response download exists.

#### REP-05 - Publish safe updates to employees

**P1 | Actor:** Authorized HR publisher  
**Story:** As HR, I share selected organizational findings and agreed changes so employees can see what their participation led to.  
**Depends on:** REP-01, REV-08; existing rich-text publication.

Acceptance criteria:
- Draft updates use the shared blog editor and can be previewed for the selected employee audience.
- Referenced scores are taken from the safe snapshot rather than pasted from raw answer data.
- Feedback-case bodies, identities and internal review notes are not exposed by publication.
- A publisher chooses the audience and publishes explicitly; an expert report never becomes employee-visible automatically.
- Corrections are versioned and archived updates preserve their original reporting context.

### Epic E: Privacy, data lifecycle and protection

#### PRI-01 - Enforce per-dimension reporting minimums

**P0 | Actor:** Employee  
**Story:** As an employee, I am protected from my employer viewing a tiny group's survey result.  
**Depends on:** CFG-03, SCO-01.

Acceptance criteria:
- Every dimension/cycle/cohort needs at least 10 distinct valid respondents under the pilot rule.
- Skipping other dimensions does not falsely satisfy this cell's threshold.
- All cards, details, trends, distributions, exports and expert packs use the same rule.
- Suppressed responses expose neither a score nor a precise small count through API fields, tooltips or errors.
- The public response schema cannot accidentally serialize protected numerator/denominator or linkage fields.

#### PRI-02 - Prevent subtraction-based disclosure

**P0 | Actor:** Employee  
**Story:** As an employee, I am protected when someone compares totals and visible departments to infer a hidden small group.  
**Depends on:** PRI-01, fixed audience/cohort snapshots.

Acceptance criteria:
- Apply the deterministic disjoint-cohort algorithm in section 5.2, including the residual/unassigned cohort.
- Canonical primary/secondary suppression decisions are persisted with the published snapshot.
- A user cannot retrieve the hidden cells through a different scope, download, trend, expert pack or report endpoint.
- Unsafe detail falls back to a broader safe view; it never shows a placeholder that still contains raw values in HTML/network data.
- The parent/child fixtures in section 14 pass before department reporting is enabled.

#### PRI-03 - Keep technical identity linkage restricted

**P0 | Actor:** Employee  
**Story:** As an employee, I can participate or follow up without my account details becoming visible in employer reporting or case handling.  
**Depends on:** Existing restricted-domain architecture, CFG-02.

Acceptance criteria:
- Participation/linkage records, answer payloads and feedback correspondence use separate access paths and explicit DTO allowlists.
- No employer, reviewer, ordinary staff or support route resolves a submission/case to a reporter account.
- Duplicate prevention and reminder workers use the minimum necessary linkage under service authorization.
- A pseudonym is case-specific and cannot correlate different anonymous cases to one employee for handlers.
- Notices accurately describe restricted platform processing and content-based identification limits.

#### PRI-04 - Keep content out of analytics and operational logs

**P0 | Actor:** Platform operator  
**Story:** As an operator, I can diagnose failures without placing restricted employee or review content into general telemetry.  
**Depends on:** Module endpoints, existing observability.

Acceptance criteria:
- Log/request/exception serializers redact rating values, case text, report bodies, private contact details and identity mappings.
- Product analytics use coarse event names and safe opaque references; they do not contain employee-answer associations.
- Survey and feedback pages disable session replay or content-capturing analytics under the existing policy.
- Security audit events record actor/action/tenant/resource/outcome without copying content bodies.
- Tests exercise representative failures, notification payloads and analytics output for accidental disclosure.

#### PRI-05 - Apply retention, access continuity and correction policies

**P0 | Actor:** NestSelf data operations  
**Story:** As data operations, I apply appropriate lifecycle rules without corrupting published results or disclosing an author's identity.  
**Depends on:** Existing rights/retention mechanisms; PRI-01..04.

Acceptance criteria:
- Data classes have explicit retention-policy references: drafts, technical linkage, submitted answers, snapshots, feedback, review documents and financial references.
- Purge jobs are idempotent and respect applicable holds; application deletion does not imply deleting a required financial record.
- An employee's own feedback access can continue through a narrow case-specific self-access policy when organization membership ends, without restoring organization reports or survey eligibility. A fully suspended identity follows existing account recovery policy.
- Post-publication corrections/removal requests use the existing rights workflow and a versioned privacy-reviewed release; no per-answer incremental employer view is exposed.
- Expired file grants and removed reviewer permissions take effect through the controlled-file mechanism; background retention does not publish a revised report automatically.

### Epic F: Protected employee feedback and problems

#### FBK-01 - Submit a problem or suggestion

**P0 | Actor:** Employee  
**Story:** As an employee, I raise a problem or suggest an improvement without revealing my account identity to the employer.  
**Depends on:** CFG-01..02, PRI-03, configured recipients.

Acceptance criteria:
- Entry is available independently of surveys and offers Problem or Suggestion plus a small set of understandable categories.
- Before submission, show the actual recipient function/designated recipients, the alternative route and the anonymity notice.
- The employee can select employer-anonymous reporting; this is the pilot default. A text warning explains that identifying details can reveal the author.
- A valid submission creates one case with a case-specific pseudonym, reporter receipt, route, owner/queue and response target.
- No survey answer, private-tool result or consultation detail is attached automatically. Attachments are not required for the pilot.

#### FBK-02 - Continue a two-way conversation

**P0 | Actor:** Employee and designated handler  
**Story:** As a reporter or handler, I exchange follow-up questions so an anonymous report can lead to a useful response.  
**Depends on:** FBK-01.

Acceptance criteria:
- Reporter sees only their own threads; handlers see only granted/assigned cases.
- Reporter account/name/email, exact technical origin metadata and unrelated case history are excluded from the handler response schema.
- Handler messages display the accountable sender/function; internal notes are clearly separate and unavailable to the reporter.
- Message retries are idempotent; delivery failure is recoverable without revealing content in notifications.
- Notifications use neutral text and authenticated links; opening a link does not bypass participant authorization.

#### FBK-03 - Avoid recipient conflicts

**P0 | Actor:** Employee  
**Story:** As an employee, I can choose an alternative recipient when my problem concerns the usual handler.  
**Depends on:** FBK-01, configured recipient/alternate grants.

Acceptance criteria:
- Each enabled route has an active primary and an independent alternate; both are validated before the channel is enabled.
- The employee can choose the alternative route without the primary recipient receiving the case or a notification about that choice.
- The final recipient preview reflects the selected route before submission.
- Assignment/reassignment checks conflicts, scope and recipient activity; no case silently falls back to the implicated manager.
- Missing/disabled recipients send the case to the disclosed staffed alternative queue or block submission with an honest next step. The UI never reports success into an unowned inbox.

#### FBK-04 - Own the case through to an outcome

**P0 | Actor:** Designated feedback handler  
**Story:** As a handler, I manage a case with an owner, next action and response target so concerns do not disappear.  
**Depends on:** FBK-01..03.

Acceptance criteria:
- Supported internal states are Submitted, In review, Waiting for reporter, Action in progress, Resolved and Closed.
- Every open case has a handler/queue, next action and due target; overdue work escalates to the configured alternate/function.
- Internal notes, assignments, status changes and reporter-visible messages are distinguishable and audited.
- Resolution requires a reporter-facing explanation appropriate to the case; closing records an outcome reason.
- Reporter may reply or request clarification on a resolved case; this returns it to an owned active state under the case policy.

#### FBK-05 - Keep case handling independent of survey colors

**P0 | Actor:** Employee and handler  
**Story:** As a participant, I have my report handled according to its content and route even if the team has a good aggregate score.  
**Depends on:** FBK-04.

Acceptance criteria:
- A green survey result never suppresses, closes or lowers the priority of an individual case.
- Small-company reporting thresholds do not block submission to the recipients disclosed to the employee.
- Survey reporting access does not grant case access, and survey exports do not contain case correspondence.
- Case resolution or review purchases never change survey scores.
- A case is not automatically converted into a workplace-review sales lead; any organization-level professional service uses the separate request process.

#### FBK-06 - Enable sensitive reporting only with a staffed process

**P0-IF | Actor:** NestSelf and organization operations  
**Story:** As operations, I enable sensitive reporting with explicit ownership and escalation so employees see an accurate, usable channel.  
**Depends on:** FBK-01..05, named trained recipients and an agreed handling policy.

Acceptance criteria:
- Sensitive categories are controlled independently from ordinary suggestions/problems.
- Enabling them requires designated recipients, an independent alternate, operating hours, response targets and the applicable escalation route.
- The composer explains the route and when it is monitored; it does not promise continuous emergency response.
- Cases in this route have separately scoped access; ordinary managers and survey administrators cannot browse them.
- Where the channel is unavailable, show the organization's actually configured alternative process. Do not invent contact details or claim a whistleblowing certification.

#### FBK-07 - Add attachments with protected delivery

**P1 | Actor:** Reporter or handler  
**Story:** As a participant, I provide supporting files with clear visibility and identification limits.  
**Depends on:** FBK-01..06, existing controlled media/security scanning.

Acceptance criteria:
- Supported types/size limits are explicit; files are quarantined/scanned before becoming readable.
- Metadata handling is defined; the reporter is warned that image/document content and filenames may reveal identity.
- Downloads recheck case access and use short-lived restricted links; files never enter public CMS media.
- Notifications and general exports contain no attachment bytes or unrestricted URLs.
- Retention and deletion follow the case policy and recorded evidence holds.

### Epic G: Review invitations and professional service requests

#### REV-01 - Offer a human review for a red result

**P0 | Actor:** Authorized employer requester  
**Story:** As an employer user, I see a relevant invitation to speak with NestSelf when a reportable area needs attention.  
**Depends on:** REP-01..03, SCO-02, CFG-01.

Acceptance criteria:
- Eligibility follows every condition in section 4.5 and uses the protected backend result.
- Multiple red dimensions in the displayed scope produce one consolidated invitation naming only reportable facts.
- Copy offers a human assessment; it does not state causes, diagnoses or prescribed changes.
- Dismissal applies to this viewer/cycle offer, while red cards and a manual review entry remain available.
- Showing/clicking the offer creates no engagement, purchase, calendar reservation or outbound sales message.

#### REV-02 - Request a separately scoped workplace review

**P0 | Actor:** Authorized employer requester  
**Story:** As an employer requester, I explicitly ask NestSelf to help assess the results and understand the next steps.  
**Depends on:** REV-01; existing service-request foundations.

Acceptance criteria:
- Request form shows organization/scope, selected safe reporting periods, business contact, optional context and available service information.
- It explains the difference between submitting a request and accepting a paid engagement.
- Submitting records the requester, relevant result snapshot IDs, requested scope, terms/notice version and data-sharing selection.
- An idempotency key prevents duplicate requests; a concurrent active request for the same covered scope is returned or linked predictably.
- Confirmation shows request status, owner/queue and next step. Price is displayed only from configured catalog/quote data.

#### REV-03 - Triage and assign professional work

**P0 | Actor:** NestSelf review coordinator  
**Story:** As a coordinator, I qualify and assign a review request so the employer reaches someone suited to the organization and issue.  
**Depends on:** REV-02.

Acceptance criteria:
- The queue shows organization, requested scope, safe metadata, status, owner and response target.
- The coordinator can request information, propose scope, assign a qualified reviewer or decline with an employer-facing reason.
- Reviewer eligibility includes the configured service qualification, availability, language and any conflict constraint.
- Assignment grants only the specific engagement access; coordinating a request does not reveal feedback cases or raw answers.
- Absence, unassigned work and overdue requests have an explicit staffed recovery path.

#### REV-04 - Share a limited aggregate review pack

**P0 | Actor:** Authorized employer user and assigned reviewer  
**Story:** As an employer, I share the agreed reporting context so the assigned professional can prepare without receiving private employee records.  
**Depends on:** REV-02..03, PRI-01..03, REP-04.

Acceptance criteria:
- The employer can preview the exact report periods, cohorts and aggregate fields to be shared.
- The pack uses the canonical protected snapshot, including suppression; no raw answers, named participation or feedback threads are included.
- Access requires both an active specific assignment and the recorded client sharing decision; scope and expiry are explicit.
- Files/links follow controlled delivery; revocation stops new platform access and does not falsely claim to erase already downloaded copies.
- An expanded scope or later reporting period requires an explicit new sharing action.

#### REV-05 - Accept scope and commercial terms explicitly

**P0 | Actor:** Employer commercial approver  
**Story:** As an authorized approver, I accept a defined service scope and price so professional work starts under agreed terms.  
**Depends on:** REV-03; existing quotes and approvals.

Acceptance criteria:
- The scope identifies review activity, deliverables, participants, price/currency, applicable taxes/terms, validity and cancellation policy.
- If the service uses a custom quote, acceptance binds an immutable quote version; a material change requires fresh acceptance.
- Approval uses the requester's current commercial authority and existing self-approval rules; report access alone cannot authorize spend.
- The request creates no charge before the relevant acceptance/funding policy is satisfied. Any payment integration is reused rather than reimplemented.
- A free introductory appointment is represented by an explicit configured zero-price service; no implicit free-audit promise is introduced.

#### REV-06 - Book a real appointment

**P0 | Actor:** Employer requester and assigned reviewer  
**Story:** As a participant, I choose an available time and receive a confirmed review appointment with the correct scope and terms.  
**Depends on:** REV-03, REV-05 where paid; existing scheduling.

Acceptance criteria:
- Available slots come from qualified provider availability and the selected service duration; show participant timezones.
- Confirmation rechecks authorization, assignment, accepted terms, approval/funding if applicable and slot availability atomically through the existing booking workflow.
- Concurrent booking attempts cannot confirm the same provider capacity twice; retries do not create duplicate appointments.
- A failed booking remains pending/failed with a recovery action, never visually confirmed.
- Confirmation, rescheduling, cancellation and calendar details reflect this organization-facing review. Private employee clinical appointments remain separate.

### Epic H: Human findings, agreed actions and follow-up

#### REV-07 - Write and share the human review report

**P0 | Actor:** Assigned workplace reviewer  
**Story:** As the reviewer, I document findings and practical proposals after assessing the employer's context.  
**Depends on:** REV-04..06; shared rich-text editor.

Acceptance criteria:
- The editor reuses the blog editor component/document format with clear sections: context, reviewed evidence, findings, uncertainties and prioritized proposals.
- Findings and recommendations are entered by an authorized human; a low score never prepopulates interventions.
- Draft, in-review and shared/published states exist; the configured reviewer/publisher explicitly approves release.
- The report separates supported observations from hypotheses requiring further investigation and can link the reviewed safe snapshot IDs.
- The shared version is immutable and available only to named engagement recipients; internal notes are separate and not included.

#### REV-08 - Agree actions from the professional report

**P0 | Actor:** Employer engagement owner and reviewer  
**Story:** As an engagement owner, I agree which professional proposals to pursue and assign responsibility so the review can lead to change.  
**Depends on:** REV-07.

Acceptance criteria:
- A proposal becomes an action only through an explicit authorized choice or human entry.
- Each action has title, description, owner, due date, intended check and status: Proposed, Agreed, In progress, Completed or Not proceeding.
- An action references the human report/version and relevant safe dimension where appropriate.
- Owners see only their authorized action context; linking an action does not grant the full report or private case access.
- Completion is recorded by a person and does not turn a red score green. A Not proceeding decision can include a safe explanation.

#### REV-09 - Conduct follow-up against later measurement

**P0 | Actor:** Employer owner and reviewer  
**Story:** As participants, we review progress after an agreed interval and compare later survey results in context.  
**Depends on:** REV-07..08, SCO-03.

Acceptance criteria:
- Follow-up has an agreed target date/appointment and assigned owner; its inclusion or extra price comes from accepted service terms.
- A later report must independently pass privacy rules and be explicitly shared into the engagement.
- Reviewers can discuss completed actions and comparable dimension trends, with participation/context visible.
- The product never asserts that the engagement caused a score change or guarantees a favorable result.
- The professional engagement may complete while an area remains red; measurement and work completion have distinct states.

#### REV-10 - Cancel, close and revoke access correctly

**P0 | Actor:** Employer owner or NestSelf coordinator  
**Story:** As an engagement participant, I understand what happens when a request or engagement is canceled or completed.  
**Depends on:** REV-02..09; existing cancellation/finance rules.

Acceptance criteria:
- Canceling a request stops its unconfirmed work; canceling an appointment/engagement follows the accepted terms and applicable financial reversal policy.
- Status changes preserve an inspectable history and a meaningful employer-facing reason.
- Closing/canceling does not delete survey evidence, remove red results or create a substitute charge.
- Reviewer access ends according to assignment/retention policy; employer report access and professional work access remain independently governed.
- An active-engagement progress card is replaced with an appropriate completed/canceled state; a later fresh red cycle can produce a new optional invitation.

### Epic I: Operational delivery and quality

#### OPS-01 - Deliver neutral, deduplicated notifications

**P0 | Actor:** All authorized participants  
**Story:** As a participant, I receive the next action through permitted channels without restricted content leaking into messages.  
**Depends on:** Existing notifications; EMP, FBK and REV flows.

Acceptance criteria:
- Events cover survey invitation/reminder, safe report availability, feedback reply, review-request update, scope acceptance, booking and report/follow-up availability.
- Templates use existing locale and channel preferences; notifications contain neutral summaries and authenticated links.
- Red survey results do not automatically email raw scores, employee content or a sales pitch to external recipients.
- Delivery jobs are idempotent, retryable and canceled when entitlement, eligibility or recipient access no longer permits delivery.
- Permanent failures appear in the appropriate operational queue with a recovery owner.

#### OPS-02 - Explain availability and recover from failures

**P0 | Actor:** Organization and NestSelf operations  
**Story:** As an operator, I can distinguish incomplete collection, insufficient data and technical failure so nobody is misled by a missing result.  
**Depends on:** Module jobs and state machines.

Acceptance criteria:
- Failed launch/finalization/export/booking/notification jobs have inspectable safe metadata, retry state and owner.
- UI error states never substitute an old score without its original date and freshness label.
- Retrying an operation preserves request/cycle/booking identity and cannot create duplicate bills or appointments.
- Operational dashboards use counts/IDs and exclude raw survey and case content.
- Support troubleshooting cannot impersonate a reporter or download a private review pack through a generic admin action.

#### OPS-03 - Make the UI accessible and localizable

**P0 | Actor:** Employee, employer user or reviewer  
**Story:** As a user, I understand statuses and complete tasks on my device and in my supported language.  
**Depends on:** Shared design system/i18n.

Acceptance criteria:
- Reuse existing semantic color tokens; provide contrast-checked text/background pairs rather than encoding meaning only in color.
- Scores include text labels; heatmap cells and dialogs are keyboard operable with visible focus and accessible names.
- Core flows work at narrow mobile widths without horizontal clipping of essential actions; a heatmap can scroll with clear row/column context.
- User-facing copy is translatable through the existing English, Serbian and Hungarian locale structure where supported by the platform; English examples are not hardcoded UI strings.
- Loading, empty, stale, suppressed, unavailable and success states receive the same UX attention as the populated dashboard.

## 8. State machines

Use domain-owned transitions and server validation. Record actor/time/reason for consequential transitions. Security audit logs are not the same object as a workplace audit/review.

| Entity | States | Key transitions and rules |
| --- | --- | --- |
| Survey template version | Draft; In review; Published; Archived | Published versions used by cycles are immutable. |
| Survey cycle | Scheduled; Open; Closing; Published; Canceled; Failed | Open accepts eligible submissions; Closing freezes collection; Published exposes one protected snapshot; Failed has retry/recovery ownership. |
| Participation | Invited; Draft; Submitted; Ineligible | Private technical state; no employer status list. A confirmed submission is unique. |
| Organizational feedback case | Submitted; In review; Waiting for reporter; Action in progress; Resolved; Closed | Every open state has an owner/queue and next action; reporter follow-up can reopen under policy. |
| Workplace review request | Submitted; Needs information; In review; Scoped; Converted; Declined; Canceled | A request is not billable work; conversion references accepted scope and an engagement. |
| Scope/quote | Draft; Sent; Accepted; Rejected; Expired; Superseded | Acceptance binds a specific immutable version and current authority. |
| Professional engagement | Accepted; Scheduled; In progress; Report shared; Follow-up; Completed; Canceled | Scheduling and sharing have prerequisites; completion is independent of score color. |
| Review report version | Draft; In review; Shared; Superseded | Human release required; shared versions do not mutate. |
| Agreed action | Proposed; Agreed; In progress; Completed; Not proceeding | Human-authored; explicit employer agreement; no automatic scoring effects. |

An introductory/scoping meeting may belong to a request before an engagement is purchased only under a separately configured service and its applicable terms. Reuse appointment states from the existing scheduling module rather than duplicating them here.

## 9. Suggested domain model

Reconcile names with the repository. Keep module ownership clear even if tables live in one PostgreSQL database.

| Entity | Minimum information | Access/consistency rule |
| --- | --- | --- |
| ListeningConfiguration | Organization, entitlements, schedule, template reference, policy versions | Granted administrators; future-effective changes |
| QuestionnaireVersion | Stable dimension keys, question/scale wording, locale versions, publication and comparability metadata | Approved authoring; immutable after use |
| SurveyCycle | Organization, template/policy versions, open/close instants, state | Unique scheduled occurrence; deterministic finalization |
| AudienceSnapshot | Cycle, membership, launch eligibility and primary reporting cohort | Restricted; no employer participation enumeration |
| ParticipationLink | Cycle, membership/opaque response link, submit state, dedup fields | Separate technical path; no ordinary user lookup |
| SurveyResponse | Opaque ID, cycle, final/draft payload, accepted timestamp | Restricted response service; avoid identity fields in answer DTOs |
| AggregateSnapshot | Cycle, calculation version, safe-report release version, publication state | Immutable released artifact |
| AggregateCell | Snapshot, cohort/dimension, protected counts, official score, classification | Protected intermediate; only sanitized result DTOs leave service |
| DisclosureDecision | Snapshot/cell, primary/secondary suppression and safe public reason | Canonical plan reused everywhere |
| FeedbackCase | Organization, category, chosen route, opaque reporter reference, case pseudonym, handler/state/targets | Restricted organizational feedback domain |
| FeedbackMessage | Case, sender type/reference, reporter-visible vs internal, body/version | Explicit participant/handler access; body excluded from logs |
| RecipientRoute | Category, primary, independent alternate, conflict rules, staffed policy | Validated before enablement |
| WorkplaceReviewRequest | Organization/scope, requester, safe snapshot refs, context, queue/state | Authorized organization-facing request |
| DataSharingGrant | Engagement/request, approved aggregate scopes/periods, client actor, validity/revocation | A reviewer assignment alone is insufficient |
| ProfessionalEngagement | Accepted scope/quote refs, assigned professional, appointment refs, state | Separate from subscription and employee benefits |
| ReviewReportVersion | Engagement, human author, rich-text document, evidence refs, release metadata | Restricted; shared revisions immutable |
| ImprovementAction | Engagement/report ref, description, owner, due date, status, safe visibility | Explicit human creation/agreement |
| SecurityAuditEvent | Actor, organization, operation, resource, outcome and safe metadata | No restricted bodies or author-identity mappings |

Use opaque IDs, safe DTO allowlists and server-resolved scope. Tenant filters and resource authorization are both required. Database relationships must not make generic organization serializers return reporter or respondent identities.

## 10. Suggested application contracts

These are conceptual routes, not required literal paths. Match existing API conventions. Document error semantics and request/response types with the implementation.

| Capability | Contract | Essential checks |
| --- | --- | --- |
| Current employee survey | Read own eligible cycle and safe notice | Current identity, organization context, eligibility |
| Save survey draft | Upsert own draft | Open cycle; own audience record; version; safe payload |
| Submit survey | Submit idempotently | Server close boundary; eligibility; unique participation; valid answers |
| Manage cycles | Schedule/cancel permitted future/open cycle | Granted scope; locked versions; state |
| Read overview/heatmap/detail | Read sanitized published snapshot | Report grant; canonical suppression; freshness |
| Export aggregates | Generate controlled export | Export grant; same view/disclosure policy; download recheck |
| Submit feedback | Create case through disclosed route | Eligible actor; active conflict-aware recipients; idempotency |
| Read/reply to feedback | Own or assigned case operation | Participant/handler check; identity-safe DTO; internal-note separation |
| Review offer | Read eligibility/context | Current safe red cell; request permission; duplicate active-work coverage |
| Request workplace review | Create organization request | Scope; explicit intent; safe evidence references; no implicit charge |
| Accept professional scope | Accept a versioned scope/quote | Commercial authority; expiry; terms; existing approval rules |
| Confirm appointment | Reuse scheduler | Accepted terms when required; provider capacity; idempotency |
| Share review pack/report | Create/access restricted artifact | Sharing consent/scope; assignment; publication; file checks |
| Manage actions/follow-up | Human-owned workflow mutations | Engagement grants; allowed state; human attribution |

Expected failures include `not_eligible`, `cycle_closed`, `already_submitted`, `template_version_mismatch`, `scope_denied`, `route_unavailable`, `active_request_exists`, `quote_expired`, `approval_required`, `slot_unavailable` and `sharing_revoked`. Public errors must not confirm unauthorized record existence or reveal suppressed values.

## 11. Copy and design behavior

- Default palette uses green, amber, red and neutral gray semantic tokens from the design system. A red accent communicates attention; text explains what was measured.
- Distinguish a fixed-threshold score view from any later relative benchmark view. A department can be above its company average while still having an objectively low pilot-band score.
- Every chart/card names its period and question/dimension. Avoid unexplained scores such as Happiness 62.
- The protected-result label is Not enough responses or Hidden to protect confidentiality. Never show No problem detected for suppressed data.
- The review card describes available human help. It does not promise a cause, recovery, certification or a fixed outcome.
- The ordinary invitation is a dismissible inline card, not a blocking modal. An existing request displays View request; a confirmed appointment displays its actual date/time.
- Case composers use everyday language and a short recipient/privacy summary. Internal permission names and data-storage details stay out of the employee task flow.
- Rich report text and organizational updates reuse the existing blog editor. Professionals do not write Markdown, configure JSON or implement formulas through the UI.

## 12. Required cross-module events and jobs

| Event/job | Owner | Required behavior |
| --- | --- | --- |
| Cycle launch | Listening module | Lock configuration; snapshot audience/cohorts; enqueue neutral invitations exactly once |
| Membership changed | Identity/organization | Stop ineligible participation/reminders; preserve original valid submission attribution |
| Survey submitted | Listening module | Confirm once; cancel pending reminders for that participation |
| Cycle finalization | Listening/reporting | Freeze accepted responses; calculate; suppress; publish atomically |
| Report available | Notifications | Notify permitted employer recipients with neutral content |
| Feedback submitted/replied | Feedback module | Route to disclosed recipient; send neutral notification; maintain next action |
| Response target overdue | Feedback/review operations | Escalate to configured staffed alternate/queue; do not reveal content to broad distribution lists |
| Review requested | Requests module | Create staffed queue item with no automatic spending |
| Scope accepted | Existing approval/finance integration | Bind version and authority; create/link the professional engagement idempotently |
| Appointment confirmed/changed | Scheduling | Reflect real booking state and applicable terms |
| Report shared | Review module | Record immutable human-approved version; notify authorized engagement recipients |
| Access/assignment revoked | Authorization | Recheck subscriptions/files/jobs; stop newly forbidden access |
| Retention/correction | Data operations | Apply per-class rules; preserve required records and disclosure safety |

Jobs act under explicit service authority where appropriate; user-initiated jobs also recheck the initiating user's current permissions where required. A missing user grant must not stop essential retention or previously accepted system operations that have their own legitimate service authority.

## 13. Implementation order and slice completion

| Slice | Stories | Demonstrable exit condition |
| --- | --- | --- |
| 1. Foundation and survey participation | CFG-01..03, SUR-01..03, EMP-01..03, PRI-03..04, relevant OPS | Two organizations are isolated; an eligible employee submits once; employer cannot enumerate participation. |
| 2. Finalized company measurement | SUR-04, SCO-01..03, PRI-01, REP-01, REP-03 | A closed cycle produces correct company-level colors, gray states and safe details with golden tests. |
| 3. Safe department reports and exports | PRI-02, REP-02, REP-04, PRI-05 | Heatmap and downloads apply the same tested primary/secondary suppression. |
| 4. Separate professional review journey | REV-01..06, relevant OPS | Red result -> explicit request -> accepted applicable scope/terms -> real confirmed appointment. No automatic charge. |
| 5. Human professional work | REV-07..10 | Assigned reviewer receives approved aggregates, shares a human-written report, and records agreed actions/follow-up. |
| 6. Protected employee feedback | FBK-01..05, EMP-04, recipient-related configuration | Employee submits anonymously toward employer, uses an alternate route and receives a reply in an owned case. |
| 7. Optional sensitive channel | FBK-06 | Enabled only for configured, staffed routes that pass conflict/access tests. |
| 8. Subsequent extensions | SUR-05, REP-05, FBK-07 | Explicitly selected P1 work; no expansion into private employee-tool reporting. |

OPS-01..03 and privacy requirements apply to each affected slice; they are not postponed to the final slice. If scheduling, quotes or identity foundations are missing, implement/reuse the required shared capability before claiming the dependent slice complete.

## 14. Golden fixtures and meaningful verification

Use fictional organizations and users only. The fixtures below are acceptance contracts, not evidence that a particular survey method is scientifically validated.

### 14.1 Scoring and status fixtures

| Fixture | Input | Expected result |
| --- | --- | --- |
| SC-01 | 20 valid answers; 15 are 4/5 | 75.0%, green |
| SC-02 | 15 valid answers; 9 are 4/5 | 60.0%, amber |
| SC-03 | 11 valid answers; 6 are 4/5 | 54.5%, red |
| SC-04 | 10 valid answers; all 4/5 | 100.0%, green |
| SC-05 | 10 valid answers; none 4/5 | 0.0%, red |
| SC-06 | 9 valid answers; 8 are 4/5 | Suppressed gray; score/count absent from public payload |
| SC-07 | 12 survey submissions; only 9 answer a particular dimension | That dimension suppressed; other dimensions evaluated separately |
| SC-08 | 10 valid submitted answers plus drafts and skipped items | Score uses the 10 submitted valid answers only |
| SC-09 | Official score immediately below/at 60.0 and 75.0 | Correct boundary classification using the shared decimal-rounding rule |
| SC-10 | Zero valid answers | Gray not_measured; no division error; no review invitation |
| SC-11 | A formerly red latest cycle is older than its 45-day freshness window | Current overview gray stale; historical report retains red; no score-triggered offer |
| SC-12 | 48.0% current vs 56.0% compatible previous | -8.0 percentage points |
| SC-13 | Changed question meaning or scale | Comparison unavailable; no invented trend |

Also test round-half-up behavior directly at decimal boundaries, e.g. 59.95 -> 60.0 and 74.95 -> 75.0. Avoid binary floating-point rounding differences between backend and frontend.

### 14.2 Disclosure fixtures

| Fixture | Parent and disjoint child valid-response counts for one dimension | Expected result |
| --- | --- | --- |
| PR-01 | Parent 25; children 20 and 5 | Parent can show; 5 is primarily hidden; 20 must also be hidden so the 5 cannot be reconstructed. |
| PR-02 | Parent 22; children 12, 6 and 4 | 6 and 4 hidden; hidden union is 10; 12 and parent may show under the disjoint model. |
| PR-03 | Parent 31; children 12, 10 and 9 | 9 hidden; hide 10 as secondary suppression; parent and 12 may show. |
| PR-04 | Parent 20; children 10 and 10 | Both children and parent may show, subject to scope and distribution checks. |
| PR-05 | Any suppressed cell requested through detail/export/pack | Same suppression; no hidden value, exact small count or reconstructable delta. |
| PR-06 | A department exists but fewer than 10 employees answered this dimension | Eligible headcount does not unlock it. |
| PR-07 | Residual/unassigned cohort has 3 answers | Include residual in hidden-union calculation; it cannot be inferred from parent minus named departments. |
| PR-08 | Historical endpoint unsafe while current endpoint safe | Hide the delta/unsafe point; do not reconstruct the past value. |

### 14.3 Authorization and workflow fixtures

- Organization A cannot read or mutate Organization B's survey, case, pack, request, engagement or export through guessed IDs.
- An HR survey administrator cannot obtain individual answers, completion status, feedback bodies or reporter mappings without a separate applicable case grant; even a handler never receives the reporter mapping.
- A manager is denied another department and is denied hidden values through network payloads, not just the UI.
- An employee cannot read another employee's draft, response receipt, case or messages.
- An expert with an engagement assignment but no client sharing grant cannot fetch the aggregate pack.
- A withdrawn sharing grant prevents new file access and subscriptions.
- A generic NestSelf administrator/support user cannot read restricted content by impersonation or a generic object viewer.
- A report export and its source dashboard agree on score, color, scope and suppression.
- Two simultaneous submissions produce one final response; two finalization jobs produce one snapshot.
- A submission whose transactional server acceptance time is at `closes_at` is rejected; one accepted before close is not lost through finalization timing, including a commit finishing just after close.
- A queued reminder is not sent after submission or membership termination.
- A red score shows the optional review invitation and produces no booking, charge, intervention or outbound sales message.
- A green, amber, stale or suppressed result does not generate a low-score invitation; a permitted manual service request remains possible.
- Two simultaneous review requests for the same active coverage do not create duplicate professional work.
- Expired quotes and insufficient authority cannot accept commercial scope.
- Two users competing for the same provider slot result in at most one confirmed appointment.
- Review cancellation, professional completion and action completion never change measurement scores.
- A report is invisible to employer recipients until an authorized human shares it.
- Routing a case to an alternate does not notify or expose it to the conflicted primary recipient.
- A reporter reply on a resolved case creates an owned next action; it is not silently dropped.
- Sensitive reporting cannot be enabled without configured primary/alternate handling and an operating policy.
- Restricted bodies and identity mappings do not appear in log, analytics, notification, export or error fixtures.

### 14.4 Suggested test levels

Unit tests: scoring, decimal rounding, thresholds, freshness, comparability, offer eligibility and suppression rules. Property-based tests are useful for disjoint-cohort subtraction protection.

Integration tests: tenant/grant checks, submission uniqueness, cycle finalization, recipient conflicts, scope acceptance, scheduling concurrency, sharing/revocation and protected file access.

End-to-end tests: one employee survey journey; one employer report-to-review journey; one human-report publication journey; one anonymous-to-employer feedback conversation using the alternate route. Include one keyboard/mobile smoke check per core surface.

Do not write broad snapshots that only freeze the implementation. Assert observable behavior and disclosure boundaries.

## 15. Pilot definition of done

The first complete pilot is ready when:

1. Eligible employees can answer a versioned survey once, voluntarily, with clear privacy information and reliable save/submit states.
2. Finalized company/department reports show correct green/amber/red bands and honest gray states, with primary and secondary privacy safeguards.
3. No employer or ordinary administrator can obtain named survey responses, individual participation, private employee tools or reporter identity.
4. An authorized employer can move from a real red result through an explicit request, accepted applicable terms and a real appointment.
5. The professional receives only approved safe aggregates and shares a human-authored report with the intended recipients.
6. Human-authored actions and follow-up are tracked independently of measurement scores.
7. An employee can submit a problem/suggestion, use a conflict-free route and receive a reply without the employer seeing their account identity.
8. Cross-tenant, concurrency, logging, suppression, file access and critical failure-recovery checks pass.
9. Production configuration records the actual recipient process, service scope/pricing, commercial approval rules, retention-policy references and supported locale behavior.
10. Deployment notes list completed stories, gated P0-IF/P1 capabilities, known limitations and recovery ownership.

## 16. Decisions and implementation assumptions

| Item | Current instruction/default | Agent behavior |
| --- | --- | --- |
| Automated employer advice | Excluded by product decision | Do not add an intervention/recommendation generator. |
| Measurement vs professional service | Separate by product decision | Separate entitlements, requests, acceptance and billing references. |
| Color model | Fixed score bands plus gray availability states | Use shared backend classification and semantic design tokens. |
| Numeric bands | Green 75.0+, amber 60.0-74.9, red below 60.0 | Implement as versioned pilot settings, not universal evidence-based cutoffs. |
| Minimum cohort | 10 valid respondents per dimension/cell | Enforce platform floor and secondary suppression. |
| Initial instrument | Five positively keyed questions | Seed as a draft until the designated content publisher releases it. |
| Initial cadence | Every 14 days, open 7 days | Version and schedule in organization time. |
| Freshness | 45 days from cycle close | Versioned configurable default; show stale context honestly. |
| Anonymous feedback model | Anonymous toward employer; restricted technical linkage at NestSelf | Use precise notice and separate linkage access. |
| Account-independent anonymous access | Deferred | Do not pretend the authenticated mailbox is technically unlinkable. |
| Sensitive-case service | Conditional | Keep gated until actual staffed routing is configured. |
| Audit/review price | Unspecified | Read configured service/quote; use request-for-quote when absent. |
| Introductory meeting price | Unspecified | Free only if explicitly configured at zero. |
| Reviewer qualification | Organization/workplace expertise and configured service eligibility | Reuse expert qualification checks; do not assume every therapist is a workplace consultant. |
| Retention intervals | Actual per-class organizational/platform policy | Implement configurable lifecycle hooks; do not infer durations from clinical notes or accounting records. |
| Existing stack and editor | Current repository and platform references | Reuse; avoid replacing authentication, adding a second CMS or choosing a new ORM from this document. |

These settings make engineering work concrete. Commercial configuration and professional content are entered by their owners; the application must not fabricate them to make a demo appear complete.

## 17. Competitive references and provenance

Research reviewed on 31 October 2026. These references inform the product patterns. NestSelf's exact pilot thresholds, privacy implementation, questionnaire and service workflow are its own choices.

| Reference | Relevant observed pattern |
| --- | --- |
| [Workleap: How engagement scores are calculated](https://help.workleap.com/en/articles/10281722-how-engagement-scores-are-calculated) | Officevibe describes 0-10 scores and red below 6 / green at 6+ on score cards. Those are its own thresholds, not the NestSelf default. |
| [Workleap: Pulse Survey Heatmap](https://help.workleap.com/en/articles/10281694-pulse-survey-heatmap) | Team/dimension reporting, trends, benchmarks and scoped report access. |
| [Culture Amp: Admin guide to understanding survey results](https://support.cultureamp.com/en/articles/7048601-admin-guide-to-understanding-survey-results) | Favorability reporting and a heatmap whose colors compare a group with the company result. |
| [Culture Amp: Products and service plans](https://www.cultureamp.com/products-and-service-plans) | Human People Science services, workshops and results-interpretation offerings alongside software. |
| [Qualtrics: Heat Map Widget](https://www.qualtrics.com/support/employee-experience/creating-ee-project/dashboards-tab/widgets-ee/table-widgets-ee/heat-map-widget-ee/) | Color can be based on comparison deltas or configured thresholds. |
| [Great Place To Work Switzerland: Culture Consulting](https://greatplacetowork.ch/en/consulting/) | Professional action-planning workshops, focus groups and interviews linked to survey findings. |
| [Unmind: Insights and Assessments](https://unmind.com/insights-and-assessments) | Organization-level wellbeing assessment and reporting. |
| [Unmind: For Organizations](https://unmind.com/unmind-for-organizations) | Separate consultative services and expert-led organizational support. |
| [Mindgram: For Leadership](https://mindgram.com/en/for-leadership/) | Aggregate organization reporting with trends, strained areas and benchmarks. |
| [Culture Amp: Confidentiality protections in reporting](https://support.cultureamp.com/en/articles/7048386-confidentiality-protections-in-reporting) | Protection against identifying a small group by subtracting reported totals. |
| [FaceUp: Employee relations](https://www.faceup.com/en/solution/employee-relations) | Restricted case ownership and two-way communication with anonymous reporters. |

Project references used: `NestSelf_Product_Flows_and_User_Stories_v0.1.md`; `auth-strategy.pdf` (21 October 2026, draft strategy); `NestSelf_Employee_Tools_Development_Specification.md` (31 October 2026, shared authoring and private-tool boundaries).

No competitor page is treated as evidence that its product implements the exact NestSelf red-score-to-review-booking rule. That rule reflects the product direction agreed in this conversation.
