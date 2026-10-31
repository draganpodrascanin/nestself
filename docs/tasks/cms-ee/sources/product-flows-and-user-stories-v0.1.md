# NestSelf — Product flows and user stories

Working product specification v0.1 · 21 October 2026

Purpose: turn the B2B wellbeing concept into a reviewable operating model and a development backlog. This is a proposal, not a record that all commercial and operational policies have been approved. Prices, session allowances, insurance coverage, refund terms, response targets and rollover terms remain configurable decisions.

## 1. Product model

NestSelf has four authenticated workspaces, a public website, and one shared platform. These are different task-oriented interfaces; they do not require four separate backends or repositories.

| Workspace | Users | Main jobs | Suggested navigation |
| --- | --- | --- | --- |
| Employee | Eligible employees; managers in their personal capacity | Consume content, use benefits, request support, book and attend consultations, register for events | Home; Explore; Support; Appointments & events; Messages; My benefits |
| Organization | Employer owner, HR, team/budget managers, approvers, finance and reporting users | Manage eligibility, teams, delegated authority, budgets, team activities and aggregate program reporting | Overview; People & teams; Benefits & policies; Budgets; Activities; Approvals; Reports; Settings |
| Expert | Advisers, therapists, facilitators, optional practice leads | Maintain availability, handle assigned requests, communicate privately, deliver services and track payable work | Today; Requests; Calendar; Conversations; Resources; Earnings; Profile |
| NestSelf operations | Platform owner, client success, content team, coordinators, support and finance | Configure clients and services, publish content, organize events, route requests, reconcile funding and delivery | Work queue; Clients; Experts; Catalog; Content; Events; Requests & bookings; Finance; Access & audit |
| Public website | Prospects and visitors | Understand the offering and find public information | Offering; For employers; Experts; Resources; Contact |

An employer manager remains an employee. The personal and organization workspaces have an explicit context switch. No management privilege exposes the manager's colleagues' private support activity.

### What is CMS, and what needs an application module?

| Capability | CMS responsibility | Operational responsibility |
| --- | --- | --- |
| Article, video, podcast, resource collection | Authoring, review, translation, images, publication and audience | Access entitlement, bookmarks and employee-only reading history |
| Expert profile | Biography, photography, languages and specialties | Credential approval, eligibility to deliver a service, availability and assignments |
| Service listing | Description, expected format and public presentation | Price/version, duration, provider eligibility, funding, cancellation and approval policy |
| Webinar | Landing page, presenter information and approved replay | Scheduled occurrence, registration, capacity, delivery provider and access control |
| Workshop | Description, facilitator information and materials | Quote, approval, funding reservation, scheduling and participants |
| Team building package | Photos, description and sample options | Tailored inquiry, comparable offers, supplier confirmation, deposit and settlement |
| Private consultation | General service description and preparation materials | Confidential request, routing, appointment, conversation, funding and service outcome |

Use a CMS for the editorial workflow. Keep case messages, consultation details, permissions, budget transactions, voucher authorizations and bookings in application-owned modules with explicit access rules.

## 2. People, permission templates and scope

Personas describe work. Permissions authorize actions. A job title is neither sufficient authorization nor a requirement to create a new hard-coded role.

Start with permission templates so onboarding is understandable, and allow authorized administrators to adjust scoped grants. One small NestSelf team member may hold several templates. A large client may separate every responsibility.

| Persona/template | Typical permissions | Default scope and boundaries |
| --- | --- | --- |
| Platform owner / super administrator | Client configuration; access administration; platform settings; audit | Platform administration. Professional case content requires a separately governed access path; an admin label does not automatically grant it. |
| Client success / client operations | Assigned-client configuration, onboarding, contract setup, service operations | Assigned organizations; no private conversation bodies or professional notes |
| Content author | Create drafts and submit changes | Assigned collections and own drafts |
| Content reviewer / publisher | Review, schedule, publish, archive | Assigned collections; separate publish permission |
| Service coordinator | Route requests, propose providers, assist scheduling | Assigned queues and minimum scheduling metadata; no professional notes |
| Support operator | Account help and delivery troubleshooting | Assigned support cases; no consultation-content impersonation |
| NestSelf finance | Funding reconciliation, invoices, settlements, provider payables | Necessary financial records; no case narrative |
| Expert | Own availability, assigned private work, own payable work | Own assignments and approved service categories |
| Expert lead / practice administrator | Expert onboarding review, workload and routing | Assigned practice or provider group; clinical supervision access is separate from operational leadership |
| Employer owner | Company access delegation, contract settings, approved policies | Own organization; company ownership does not expose private employee cases |
| HR / people administrator | Roster, eligibility, teams, program settings and permitted reports | Own organization or delegated organizational units |
| Team / budget manager | Activity requests, assigned budgets and approved aggregates | Explicit team or department; descendant access only if granted |
| Approver | Decide requests under a defined policy and authority limit | Routed approval items; no automatic people-admin or budget-transfer access |
| Employer finance | Fund allocation, top-up requests, invoices and permitted spend reports | Assigned cost centers; no employee consultation narrative or private booking roster |
| Reporting user | Read approved aggregate reports | Assigned units, privacy filters and export limits |
| Employee | Own benefits, content, consultations, conversations and event registrations | Self plus entitled shared content and events |
| Event facilitator / supplier, optional later | Assigned delivery details and minimum logistical information | Specific activity; no organization-wide people access |

### Grant model

Each grant contains a subject, allowed actions, resource scope, optional conditions, validity period and delegation boundary. Example actions: `content.write`, `content.publish`, `people.invite`, `org_units.manage`, `budget.read`, `budget.allocate`, `spend.approve`, `events.request`, `bookings.coordinate`, `reports.aggregate.read`, `access.delegate`.

Example: a manager can request activities and approve up to EUR 500 for Engineering, including designated subteams, but cannot transfer funds or view another department. Another person may allocate funds for the entire company while having no event approval authority.

Enforce authorization in the API, background jobs, exports, file delivery and real-time channels. Hiding a menu item is not authorization. Resolve scope server-side from membership and grants, not from a client-supplied organization identifier.

Initial rules:

- Default deny; explicit, inspectable grants; changes are audited.
- Administrative grants cannot cross company boundaries or exceed the grantor's delegation envelope.
- A manager relationship does not itself grant access to all reports, spending or descendant units.
- Self-approval is disabled unless explicitly allowed by a documented company policy. An alternate approver must exist.
- A transfer to another team and loss of employment trigger entitlement and scope re-evaluation. Existing clinical continuity and billing obligations are resolved under a separate contract policy.
- Emergency access to restricted professional records, if required at all, is separate, time-limited and logged. Routine support uses redacted operational views.

### Organizational structure

Model the organization tree, project teams, reporting relationships, budget ownership and approval routing separately. They often overlap but are not interchangeable.

For the pilot, use a simple company → department → team tree, one primary cost center per employee, an optional line-manager reference, and explicit scoped grants. The model can later support additional project-team memberships without charging multiple budgets for the same booking. Prevent cycles and define who can move a unit.

## 3. Service and client policy model

A subscription grants product capabilities. A benefit policy determines whether a person may use a particular service. A funding source pays the eligible charge. A request coordinates the work. An appointment reserves delivery capacity.

Do not make a single wallet represent all five concepts.

| Service type | Scheduling model | Suggested default approval | Possible funding |
| --- | --- | --- | --- |
| Article / recorded resource | On demand | None | Subscription entitlement |
| Included shared webinar | Registration for scheduled occurrence | None | Subscription entitlement |
| Private advisory chat | Assigned asynchronous thread | None within benefit | Included entitlement or specified service fund |
| Financial / legal consultation | Direct booking or request-and-match | None within allowance | Shared advisory fund; allowed employee payment later |
| Psychotherapy | Eligible-provider appointment | No line-manager approval for covered sessions | Employer therapy fund or verified insurer authorization |
| Team workshop | Fixed catalog session or tailored quote | Manager authority or higher approval above limit | Team/company activity fund |
| Team building | Inquiry and comparable offers | Quote acceptance by authorized budget holder | Team/company activity fund |

These are proposed defaults, not universal requirements of the industry or insurance plans.

### Per-client, per-service policy fields

| Policy area | Decisions |
| --- | --- |
| Eligibility | Active organization membership, allowed groups, location, service category, eligible provider and applicable contract dates |
| Benefit entitlement | Included access, per-person session allowance, per-period cap and shared-fund availability |
| Booking model | Direct booking; request-and-match; quote request; scheduled group registration |
| Funding | Allowed sources, source priority, optional approved fallback, maximum covered amount and employee contribution availability |
| Approval | None; always; above amount/allowance; funding exception only. Approver scope, authority, expiry and escalation are explicit. |
| Privacy | Fields visible to each actor; whether any identifiable financial exception goes to the employer; aggregate suppression rules |
| Delivery | Duration, language, online/in-person, response target, lead time and cancellation/no-show rules |
| Period rules | Budget period, carryover, expiry and any permitted conversion between categories |

Version the applied policy and price on a confirmed booking. Recheck active eligibility, available funds and availability before confirmation. Do not silently rewrite already confirmed bookings when a company changes policy.

The pilot needs a few explicit policy modes, not a general visual workflow builder. Resolve company defaults and explicit service overrides predictably; narrower overrides cannot exceed the contract's permitted benefits or access boundaries.

### Approval and confidentiality

Recommended default: private support uses pre-approved allowances or a confidential pooled fund. Team activities use delegated spending authority and, when required, managerial approval.

If a client requires approval for personal support, route a minimal funding request to a designated confidential benefits/finance approver where possible. Do not forward the employee's intake text, attachments, conversation or professional reason to a line manager. Before submission, show the employee exactly which fields and recipients are involved.

Identifiable approval requests can reveal that someone is seeking support even if the reason is hidden. Do not promise anonymity in that mode. For stronger confidentiality, seek employer approval for a fund-level top-up rather than an identifiable individual consultation, or provide an agreed alternative funding route.

## 4. Money, allowances and insurer authorizations

### Separate concepts

1. Subscription: payment for access to the app, content and other purchased capabilities.
2. Employer fund: money available for agreed service categories.
3. Personal allowance: a policy limit on an employee's covered usage; it is not necessarily a segregated cash balance.
4. Team activity allocation: delegated employer funds for specified activities.
5. Insurer authorization/voucher: permission under a specific payer agreement, potentially covering a number of sessions or a maximum amount.
6. Employee contribution: optional self-pay or co-pay, if enabled and operationally supported.

Keep the earlier subscription + expert-chat + service-fund packaging configurable. Do not bake an unsettled pricing split, fund rollover or credit-conversion promise into code.

### Employer fund lifecycle

Record credits, transfers, reservations, consumption, releases and reversals in an append-only transaction history. Store monetary amounts in currency minor units and session entitlements as a separate unit type.

`available = credits + transfers_in - transfers_out - consumed - active_reservations`

Example: a company funds EUR 10,000 and transfers EUR 2,000 to Engineering. The company-level account has EUR 8,000 available and Engineering has EUR 2,000. The consolidated total is EUR 10,000. A EUR 600 approved activity reserves EUR 600 in Engineering, leaving EUR 1,400 available there. The consolidated report includes that same reservation once.

An allocation is a transfer within the same employer funding envelope, not newly created money. A separate per-person or manager authority limit can still constrain spending.

At booking confirmation, reserve the required funds or session units atomically with the booking decision. At delivery, consume according to the agreed service rule. On a covered cancellation, release the reservation. A late-cancellation fee or no-show charge is a distinct, versioned rule and must be disclosed before confirmation.

### Insurer voucher lifecycle

The proposed employee experience is simple: enter code → see covered services and remaining entitlement → choose an eligible expert/time → confirm. Behind that experience, the code must resolve to a trusted authorization.

Validate issuer, contract, eligible person or membership, eligible service/provider, effective dates, session/amount balance and any approved co-pay. A text code by itself is not proof that an insurer will pay. An integration, a preloaded authorization batch or a controlled manual verification process must establish validity under an actual agreement.

Use states such as `pending_verification`, `active`, `exhausted`, `expired`, `revoked`; reservation and consumption are ledger events tied to the authorization. Do not assume every code is single-use. A code can authorize several sessions with an explicit validity window.

Reserve a session at confirmation; consume it at the contract-defined event. Reinstatement after cancellation follows the issuer agreement. Claims, payer adjudication and cash settlement are separate from booking and service delivery. An authorization can be valid while an eventual claim remains unpaid or disputed.

Never charge an employer fund as an invisible fallback when an insurer rejects coverage. Explain the alternative and obtain the employee's choice where another permitted source exists. Mask codes, restrict lookup, rate-limit attempts and exclude full codes from messages and logs.

### Three illustrative client configurations

| Client | Advisory consultation | Therapy | Team workshop |
| --- | --- | --- | --- |
| A | Direct booking from a pooled advisory fund within personal allowance | Employer therapy fund only | Manager may commit up to EUR 500; above that, a higher approver decides |
| B | Request-and-match; confidential approval only beyond included allowance | Verified insurer authorization only | Every quote needs the assigned budget owner's approval |
| C | Included advisory allowance, then explicit funding exception | Insurer first, employer alternative only if contract allows and employee chooses it | Budget holder can book directly within an assigned limit |

Amounts are examples. The service catalog is shared; client configuration changes access, funding and approval behavior.

## 5. Detailed operating flows

### F1. Publish content

1. An author chooses article, video, podcast or collection and adds accessible content, imagery, language and categories.
2. The author selects the intended audience: public, eligible platform users, a client, or a permitted organization group.
3. Draft preview uses the employee/public layout and clearly shows its audience.
4. A reviewer with the appropriate subject responsibility approves sensitive professional material; a publisher schedules or publishes the approved version.
5. Eligible users discover the item. Unpublished material and restricted assets cannot be accessed through direct URLs.
6. Corrections create a version; unpublishing removes discovery and prevents new restricted access. Reports shown to employers do not identify who read sensitive material.

### F2. Financial advice — direct booking

1. Employee opens Support → Financial advice and sees included access, coverage, delivery format and expected response time.
2. They choose an eligible adviser and an available slot. A private intake question is optional unless necessary for routing or service delivery.
3. The app explains price, payer, covered amount, any employee amount, cancellation terms and who can see the information.
4. The server rechecks eligibility and policy, briefly holds the slot, and reserves the funding source. Confirmation is one consistent operation with recoverable external-provider steps.
5. Employee and expert receive confirmation. A generic notification links to the authenticated booking; calendar export uses a neutral title by default.
6. At the scheduled time, authorized participants enter a private video room. The session is not recorded by default.
7. Expert records delivery status. Funds move from reserved to consumed under the policy; provider payable and payer reconciliation are separate records.
8. Employee can leave optional private service feedback. Employer reporting uses safe aggregate program and financial metrics.

Do not ask an expert to manually send a calendar when valid availability already exists. Direct booking is the short path for a well-defined service.

### F3. Financial advice — request, matching and time proposals

1. Employee submits the support category, preferred language, time windows and optional private context. They are told who can read their context.
2. The system evaluates eligibility and funding. A request may exist without reserving an appointment or spending money.
3. When approval is required, a separate minimal approval item is routed. Private intake stays in the case domain. No scarce time slot is held for days while approval is pending.
4. An expert or coordinator accepts/routes the request according to granted scope. A coordinator sees scheduling needs, not professional notes.
5. Expert opens relevant availability or proposes several times. Proposed times are not confirmed appointments and may expire or become unavailable.
6. Employee receives an opted-in neutral SMS/push/email, for example: “Novi termini su dostupni. Pogledaj ih u NestSelf aplikaciji.” The link requires authentication.
7. Employee selects a still-available time. Funding, approval ceiling and availability are rechecked; the booking is confirmed and required funds are reserved.
8. If none work, employee suggests alternatives. If the request exceeds the operational response target, it returns to the staffed queue with an owner and next action.
9. Delivery, cancellation and settlement follow F2.

Use request-and-match when qualification, adviser suitability or availability requires coordination. Avoid creating a mandatory administrative hop for every routine consultation.

### F4. Approval, exception or rejection

1. The policy routes a request to an authorized approver with a maximum amount, permitted category, validity date and minimal visible fields.
2. Approver approves, rejects with a safe employee-facing reason, or requests non-sensitive clarification.
3. Approval authorizes a defined spending ceiling; it does not guarantee a time slot and does not itself consume the budget.
4. If policy reserves money at approval for an event quote, that hold has an expiry and an explicit release path. Personal booking approval normally authorizes spend without a long-lived hold.
5. Employee or organizer proceeds before expiry. A price increase beyond the approved ceiling requires fresh approval or an allowed lower-cost option.
6. Missing approver, self-approval conflict, approver absence or timeout routes to a configured alternate. Silence never means approval.
7. A rejection or expired approval closes that funding path and offers only permitted alternatives.

### F5. Therapy covered by employer fund

1. Employee selects therapy and sees the relevant session allowance and coverage.
2. Only providers eligible for that service and client policy can be booked.
3. Employee selects a time and sees payer, personal amount if any and cancellation terms.
4. Confirmation reserves employer funds and the relevant entitlement. The company cannot open the employee's appointment or conversation from its roster.
5. Expert delivers the service. A professional care record, if NestSelf stores one, is a separate restricted domain from scheduling and billing.
6. Additional sessions follow the available entitlement or a disclosed confidential funding-exception process. Professional recommendations do not automatically authorize employer spending.

### F6. Therapy covered by insurer authorization

1. Employee enters an authorization code through My benefits or during booking.
2. System verifies it against the trusted source; manual review displays `pending verification` and a clear next action rather than promising coverage.
3. A verified authorization displays eligible services/providers, validity, remaining units and any co-pay.
4. Employee selects an eligible session. Concurrent booking attempts cannot reserve the same final unit twice.
5. Confirmation reserves a unit without charging the employer fund.
6. Delivery consumes the unit under the issuer policy and generates the necessary payer reconciliation record.
7. If authorization expires before a selected service date, is revoked, or does not cover the provider, booking is blocked until an explicitly permitted funding route is selected.
8. A cancellation releases or consumes units under the contract; financial disputes go to reconciliation, not a silent second payer charge.

### F7. Team workshop or team building

1. A manager opens Activities and either books a standard workshop package or requests offers.
2. For an offer request, they enter team, participant count, objective, preferred dates/location, budget ceiling and relevant logistical needs.
3. NestSelf coordinator checks the request, obtains availability and sends comparable versioned offers with scope, total price, inclusions, exclusions, expiry and cancellation/deposit terms.
4. Manager selects an offer. The server checks budget, authority and the configured approval route.
5. The authorized acceptance reserves the agreed funds. Supplier/facilitator confirmation is tracked separately; the employee-facing activity is marked confirmed only when operational conditions are met.
6. Organizer invites the permitted team/audience. Participants register or decline; capacity is enforced. Necessary logistics are shared only with the delivery party.
7. Organizer sees operational attendance for the company event where appropriate. This never grants access to participants' individual support histories.
8. After delivery, NestSelf confirms attendance/delivery for settlement, consumes the agreed charge and collects feedback.
9. Material quote changes need renewed acceptance and, where applicable, approval. A canceled or expired quote releases its reservation according to disclosed terms.

A standard fixed-price workshop can use a shorter booking flow. A customized 25-person team building request needs inquiry and offer handling, not an expert-consultation form.

### F8. Shared webinar

1. Content/event operator creates a scheduled occurrence, presenter, capacity/access policy and delivery configuration.
2. Eligible employees discover the webinar and register. Included webinars have no per-person funding approval.
3. System sends chosen reminders and an authenticated join path. Attendee visibility and private Q&A behavior are clearly stated.
4. Presenter delivers the webinar through an appropriate broadcast/webinar tool. An ordinary shared 1:1 meeting link is not reused.
5. Attendance is operational metadata. Employer reports use aggregate participation, rather than sensitive named participation histories.
6. A replay is an independently reviewed content item. Prefer a presenter-only recording without participant faces, names, chat or personal questions; publication follows the announced recording policy.

### F9. Changes, cancellations and provider failure

1. Employee/expert selects a permitted change; the app shows the financial and timing effect before confirmation.
2. Rescheduling rechecks eligibility and funding validity. Keep the original booking until the replacement can be committed consistently, or expose an explicit recoverable transition.
3. A cancellation frees capacity and releases/reverses funds as the applied rule requires. A fee is separately identified.
4. Expert absence routes affected bookings to the coordinator; employee chooses a replacement or cancellation. No undisclosed reassignment of private conversation history.
5. Video failure offers an authenticated reconnect/help path and an agreed fallback. Support can see connection/delivery metadata without entering the professional conversation.
6. Duplicate clicks, retries, delayed video callbacks and payment messages cannot duplicate a reservation, debit or provider payment.

### F10. Join, team move and leave

1. HR imports or invites an eligible employee; validation reports duplicates and invalid rows before applying a batch.
2. Employee verifies the invitation and activates their own identity. Team membership grants benefits only according to policy.
3. A team move changes future charging scope and management/report access from an effective date; historical transactions keep their original attribution.
4. When the employer benefit ends, future access and bookings are evaluated under the agreed termination/continuity rule. HR removal does not delete professional records or erase settlement obligations.
5. Employee is told which access ends and what happens to an existing appointment. Personal identity and employer eligibility are separate concepts.

## 6. Lifecycle states

Do not encode request, approval, booking and payment in one giant status field.

| Entity | Core states / events | Key rule |
| --- | --- | --- |
| Content | draft; in_review; published/scheduled; archived | Published audience and asset access agree |
| Service request | submitted; needs_information; awaiting_assignment; assigned; awaiting_selection; fulfilled; closed/canceled | Every active request has an owner, next action and due target |
| Approval | pending; approved; rejected; expired; withdrawn | Decision binds scope, amount and validity |
| Appointment | short hold; confirmed; completed; canceled; no_show | Confirmation requires eligible capacity and funding |
| Quote | draft; sent; selected; accepted; expired; withdrawn; superseded | Acceptance refers to an immutable quote version |
| Group activity | requested; sourcing; awaiting_acceptance; awaiting_supplier_confirmation; confirmed; delivered; canceled | Approval, reservation and supplier confirmation remain inspectable |
| Funding | credited; transferred; reserved; consumed; released; reversed | Append history; never silently overwrite consumed balances |
| Insurer authorization | pending_verification; active; exhausted; expired; revoked | Eligibility is distinct from eventual payer settlement |
| Settlement | unsubmitted; submitted; accepted; rejected/disputed; paid | Service completion is not proof of payment |

Support views should translate these into useful next steps: “Waiting for you to choose a time,” “Waiting for funding approval,” “Your request is being matched,” or “Waiting for provider confirmation.”

## 7. Visibility rules

| Information | Employee | Assigned expert | NestSelf operations | Employer / manager |
| --- | --- | --- | --- | --- |
| Employee membership, eligibility and team | Own | Minimum needed for delivery/coverage | Assigned-client people operations | Authorized roster administrators within scope |
| Private intake and professional conversation | Own | Assigned case and explicit access | Only explicitly authorized professional intake function when required; not general client success | Unavailable |
| Professional notes, if stored | Defined patient-facing access route | Responsible professional and explicitly authorized clinical supervision | Separate professional access controls | Unavailable |
| Appointment logistics | Own | Own assignments | Assigned scheduling personnel | No named private-consultation roster |
| Payer authorization and billing reference | Own coverage summary | Minimum delivery/coverage fields | Designated finance/coverage staff | Employer gets only its permitted financial view; insurer gets necessary contracted billing data |
| Personal consultation usage and costs | Own | Own delivery/payment records | Necessary operational and financial scope | Privacy-safe aggregates; identifiable funding exception only when explicitly disclosed |
| Team event invitations and logistics | Own invited activity | Assigned facilitation details | Assigned event coordinators | Authorized organizer for that event |
| Content consumption and personal feedback | Own | Only if intentionally shared | Restricted operational aggregate or follow-up access | Aggregate, with suppression; no sensitive named reading history |

Employer reports use a minimum eligible/participating cohort rule and safeguards against identifying people through small groups, complementary totals, repeated filters or narrow dates. The exact threshold is a product/privacy decision, not a guarantee of anonymity by itself. Until that design is ready, show broad company-level metrics and budget information rather than detailed team-level private-support breakdowns.

Keep private support funding in a sufficiently broad pool where possible. Tiny team budgets, exact timestamps and itemized costs can otherwise reveal who used a service even without names.

## 8. Story catalog

Stories below are backlog seeds with concrete acceptance criteria. P0 = required for the relevant pilot flow; P1 = expansion after that flow works; P2 = later. P0-IF = required only if the named integration/business model is included in the pilot. Priority does not mean all stories must ship before the first demonstration.

### Platform owner

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| PLAT-01 | P0 | As platform owner, I create a client organization and assign its initial owner so onboarding can start. | Organization identity, timezone, contract dates and owner are recorded; invitation is scoped to that client; another client's records remain inaccessible. |
| PLAT-02 | P0 | As platform owner, I grant an operator only the actions and client scope needed for their work. | A template can be adjusted; effective access is previewable; grant/revoke records actor, scope and time; unauthorized API access is rejected. |
| PLAT-03 | P0 | As platform owner, I enable purchased services and baseline benefit policies. | Disabled services cannot be booked; service-specific overrides stay within the contracted envelope; applied policy has a version. |
| PLAT-04 | P0 | As platform owner, I inspect consequential access and financial changes. | Audit identifies actor, tenant, action, affected record and safe change details; raw messages, full voucher codes and professional notes are excluded. |
| PLAT-05 | P1 | As platform owner, I manage exceptional professional-data access separately from administrative access. | Approved purpose, narrow scope, expiry and access log are required; ordinary support impersonation cannot read private cases. |

### Client success and internal client operations

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| OPS-01 | P0 | As client operations, I configure an assigned client's package and service settings. | I can change only assigned tenants; future effective date is supported; confirmed bookings retain their applied terms. |
| OPS-02 | P0 | As client operations, I help HR onboard people from a validated roster. | Preview shows valid rows, duplicates and errors; an import can be retried without duplicate memberships; private support data is absent. |
| OPS-03 | P0 | As client operations, I enable direct booking or request-and-match for a client/service. | Employee entry point and expert queue follow the selected mode; the change does not reopen completed cases. |
| OPS-04 | P0 | As client operations, I see unresolved operational work and a next action. | Requests can be filtered by owner/status/due target; overdue work has an escalation destination; no request is silently orphaned. |
| OPS-05 | P1 | As client success, I prepare a safe program review for an employer. | Report uses permitted aggregates; small-group drill-down/export is suppressed; private usage rows and case content cannot be exported. |
| OPS-06 | P1 | As client operations, I pause a service or client while resolving an operational issue. | New bookings follow the pause rule; existing appointments are flagged for explicit handling; the pause does not delete records. |

### Content authors, reviewers and publishers

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| CMS-01 | P0 | As author, I create a resource with its language, category, accessible media and intended audience. | Required metadata and image alternatives validate; draft is not discoverable or accessible through an unprotected asset URL. |
| CMS-02 | P0 | As author, I preview and submit a draft for review. | Preview matches the target layout and audience; submission records a version; submitting is separate from publishing. |
| CMS-03 | P0 | As reviewer/publisher, I approve or return changes and publish the approved version. | Publish permission is checked separately; comments and decisions are recorded; employee access begins only at publication. |
| CMS-04 | P0 | As publisher, I restrict a resource to entitled audiences. | Search, direct URL and media access enforce the same audience; moving between clients never exposes the restricted resource. |
| CMS-05 | P0 | As publisher, I correct or archive published content. | History is retained; an archived item leaves discovery; existing bookmarks show a clear unavailable/update state. |
| CMS-06 | P1 | As publisher, I reuse an approved webinar replay in the content library. | Replay is reviewed for participant information; access and expiry are explicit; public publication is a separate choice. |

### Service coordinators and support

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| COORD-01 | P0 | As coordinator, I assign an unowned request to an eligible expert. | Eligibility, service type, language and availability can be checked; assignment is logged; only necessary context is disclosed. |
| COORD-02 | P0 | As coordinator, I help an employee find another time or adviser. | I see scheduling metadata; the employee accepts the replacement; new funding and slot checks occur before confirmation. |
| COORD-03 | P0 | As coordinator, I handle unanswered requests or expert absence. | The work item has an owner and response target; a timeout creates a next action; replacement/cancellation is visible to the employee. |
| COORD-04 | P0 | As coordinator, I record delivery uncertainty without making an unauthorized charge. | A disputed/no-connection booking can be flagged; charge handling follows the service policy or authorized finance review. |
| COORD-05 | P0 | As support operator, I help with sign-in or video access. | Redacted diagnostic metadata is available; no conversation body, professional note or private employee session can be opened through support access. |

### NestSelf finance and coverage operations

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| FIN-01 | P0 | As finance, I record employer funding and reconcile allocations, holds and consumption. | Every balance is traceable to transactions; transfers do not create funds; committed funds cannot be spent again. |
| FIN-02 | P0 | As finance, I produce employer statements and expert payables. | Employer statement excludes private case narrative; expert payables reconcile delivered work and agreed rates; billing and payout status remain distinct. |
| FIN-03 | P0-IF | As coverage operations, I load or verify insurer authorizations under an active agreement. | Issuer, eligibility, eligible services/providers, units and validity are validated; pending checks cannot promise coverage; code lookup is restricted. |
| FIN-04 | P0 | As finance, I resolve a cancellation, fee or financial discrepancy through a recorded adjustment. | Original transactions remain; reversal/release identifies reason and authority; retry does not duplicate the adjustment. |
| FIN-05 | P1 | As finance, I track insurer claims and unpaid/disputed settlements. | Delivery, claim submission, adjudication and payment are separately visible; rejection does not automatically debit a different payer. |

### Experts

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| EXP-01 | P0 | As expert, I maintain my professional profile and approved service offering. | Public/profile edits are distinguishable from approval of credentials and service eligibility; unapproved categories cannot receive bookings. |
| EXP-02 | P0 | As expert, I publish recurring availability, exceptions and booking buffers. | Slots display in the viewer's timezone; time off removes new availability; overlapping bookings are prevented across NestSelf clients. |
| EXP-03 | P0 | As expert, I accept an assigned request or return it for rerouting. | Only assigned/minimum matching context is visible; declining requires a safe operational reason; the employee request returns to a staffed queue. |
| EXP-04 | P0 | As expert, I offer suitable times to an employee. | Proposals have validity and timezone; a proposal is not a booking; a selected time is rechecked and atomically reserved. |
| EXP-05 | P0 | As expert, I discuss preparation and scheduling through a private assigned thread. | Employee and assigned expert have access; professional context is not copied into approval cards or employer reports. |
| EXP-06 | P0 | As expert, I enter the private consultation room for my confirmed appointment. | Access is appointment-specific and time-bounded; unrelated staff cannot join; recording is off by default. |
| EXP-07 | P0 | As expert, I mark completed, canceled or missed delivery. | Authorized transitions require safe operational evidence/reason; the funding rule applies once; professional notes are not required in billing fields. |
| EXP-08 | P1 | As expert, I view expected and settled earnings for my delivered services. | Own records only; delivery, amount owed and paid status are distinct; adjustments can be queried without exposing other experts' records. |

### Expert lead / practice administration

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| LEAD-01 | P0 | As expert lead, I verify a provider's credentials and allowed service categories. | Review status, reviewer and effective/expiry dates are recorded; pending or expired eligibility blocks new matching for affected services. |
| LEAD-02 | P1 | As expert lead, I distribute work within my provider group. | Only eligible providers and scoped queues are visible; reassignment is logged and respects employee continuity and disclosed context sharing. |
| LEAD-03 | P1 | As expert lead, I review response times and delivery quality. | Operational quality metrics do not automatically reveal professional notes; any clinical supervision access uses a separate explicit permission. |

### Employer owner and HR

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| ORG-01 | P0 | As employer owner, I delegate HR, budget, approval and reporting responsibilities. | Grant preview shows actions, scope and limits; delegation cannot exceed my authority or expose professional support records. |
| ORG-02 | P0 | As HR, I invite employees and maintain eligibility. | Invitations are verified and revocable; duplicate employment records are detected; membership history has effective dates. |
| ORG-03 | P0 | As HR, I create departments/teams and maintain reporting references. | Tree cycles are rejected; primary charging unit is explicit; a line manager does not automatically gain administrative permissions. |
| ORG-04 | P0 | As HR, I move or deactivate an employee. | Future eligibility and management scope update predictably; existing reservations follow a surfaced continuity rule; no private record is deleted from the roster action. |
| ORG-05 | P0 | As employer owner, I choose permitted funding and approval policies for each service. | Only contract-supported choices are selectable; the effect is previewed; confirmed bookings keep their versioned terms. |
| ORG-06 | P1 | As HR, I promote relevant content, webinars and team activities. | Audience is scoped and previewed; communication does not reveal recipients' private consultations or reading behavior. |
| ORG-07 | P0 | As HR, I understand program coverage and open operational tasks. | Dashboard shows eligible population, configured benefits and relevant activity tasks; private support histories are absent. |
| ORG-08 | P1 | As reporting user, I review program participation and funding at my allowed scope. | Aggregate reports and exports apply cohort/filter protections; a small team cannot be used to identify an individual service user. |

### Team managers, budget owners and approvers

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| MGR-01 | P0 | As manager, I see the activity funds and authority available for my team. | Available, reserved and spent are distinct; another team is inaccessible; private employee support spend is not exposed as named rows. |
| MGR-02 | P0 | As manager, I request a workshop or team building offers for my team. | Participant estimate, objective, dates/location, price ceiling and funding scope are captured; request receives an owner and next action. |
| MGR-03 | P0 | As manager, I compare versioned offers and accept an authorized option. | Total price, scope and cancellation terms are comparable; an expired/superseded offer cannot be accepted; budget/authority checks run at acceptance. |
| MGR-04 | P0 | As approver, I decide a request within my scope and spending ceiling. | I cannot approve my own request without explicit policy; approval/rejection is logged; sensitive case content is absent. |
| MGR-05 | P0 | As organizer, I invite the activity audience and see necessary logistics. | Invite list is scoped to the activity; capacity is enforced; invitation status grants no private support access. |
| MGR-06 | P0 | As manager, I request a budget top-up when the current allowance cannot cover an activity. | The request is separate from a spend commitment; approval does not itself duplicate the fund balance; a missing approver has an alternate route. |
| MGR-07 | P1 | As approver, I delegate temporary approval coverage while absent. | Time-limited delegate stays within my authority; expiry is enforced; self-approval conflicts route elsewhere. |

### Employer finance

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| CLFIN-01 | P0 | As employer finance, I allocate available activity funds to permitted units. | Transfers are within authorized scope; total funds are conserved; existing reservations prevent over-allocation. |
| CLFIN-02 | P0 | As employer finance, I review statements and funded service totals. | Statement reconciles opening funds, additions, transfers, reservations and consumption; private employee case narrative and booking roster are absent. |
| CLFIN-03 | P0 | As a designated confidential approver, I decide a disclosed funding exception. | The employee knows what fields I receive; only the funding ceiling and permitted minimal identifiers are shown; no private explanation is forwarded. |
| CLFIN-04 | P1 | As employer finance, I approve period renewals, top-ups and agreed carryover. | Action follows contract rules and effective dates; unused funds are not silently expired or converted; transaction history remains traceable. |

### Employees

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| EMP-01 | P0 | As employee, I activate my account and understand my benefits. | Verified membership selects the correct client context; available services and who pays are clear; company roster access is not granted. |
| EMP-02 | P0 | As employee, I discover and save content that my plan includes. | Search and media access respect entitlement; personal reading/bookmarks are not visible to my manager. |
| EMP-03 | P0 | As employee, I see the coverage for a service before committing. | Included entitlement, payer, covered amount, any contribution and cancellation terms are visible; company-wide fund totals need not be exposed. |
| EMP-04 | P0 | As employee, I book an eligible expert directly when the service allows it. | Only valid slots/providers are offered; final checks prevent double booking and overspend; confirmation includes a clear next step. |
| EMP-05 | P0 | As employee, I request help without knowing which expert to choose. | Minimal routing information and private optional context can be supplied; a response expectation and request status are displayed. |
| EMP-06 | P0 | As employee, I choose from proposed times or suggest alternatives. | Notification opens my authenticated request; expired/unavailable proposals are explained; my choice does not bypass funding approval. |
| EMP-07 | P0-IF | As employee, I activate verified insurer coverage with a code. | Validity, eligible service/provider and remaining sessions are shown; invalid/pending coverage cannot be used; no employer charge is hidden in the flow. |
| EMP-08 | P0 | As employee, I understand any required approval before submitting it. | App identifies recipients and exact visible fields; private intake is excluded; rejection/expiry and permitted alternatives are clear. |
| EMP-09 | P0 | As employee, I message my assigned expert and attend a private video appointment. | Only authorized participants can access; notifications are neutral; a connection problem has a usable help/reconnect route. |
| EMP-10 | P0 | As employee, I cancel or reschedule with an understood financial effect. | Cutoff, fee and entitlement reinstatement are shown before action; updates affect availability and funding exactly once. |
| EMP-11 | P0 | As employee, I register for an included webinar or invited team activity. | Access/capacity are checked; reminders follow preferences; recording and participant-visibility expectations are stated. |
| EMP-12 | P1 | As employee, I manage communication preferences and give feedback. | SMS/email/push choices and safe contact details are honored; optional feedback is not exposed as a named employer report. |

### Event operators, facilitators and suppliers

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| EVT-01 | P0 | As event operator, I publish a webinar occurrence with presenter and access policy. | Date/timezone, delivery configuration and audience validate; eligible registration and join paths work. |
| EVT-02 | P0 | As event coordinator, I turn a team request into comparable offers. | Offers have versioned scope, total price, validity and delivery/cancellation conditions; supplier availability is tracked. |
| EVT-03 | P0 | As coordinator, I confirm delivery and reconcile a chosen activity. | Funds and acceptance are valid; supplier confirmation is visible; failed confirmation releases or escalates the reservation explicitly. |
| EVT-04 | P1 | As presenter, I deliver a webinar and submit an appropriate replay. | Presenter access is limited to the event; attendee privacy settings are applied; replay passes content review before publication. |
| EVT-05 | P2 | As an external facilitator/supplier, I view only the logistics of my assigned activity. | A scoped portal or controlled delivery packet contains minimum necessary details; there is no access to unrelated employee or company records. |

### System and integration behavior

| ID | Priority | Story | Acceptance criteria |
| --- | --- | --- | --- |
| SYS-01 | P0 | As the platform, I authorize every access using current identity, scope and assignment. | Cross-client ID manipulation, unauthorized file access, exports and real-time subscriptions are rejected server-side. |
| SYS-02 | P0 | As the platform, I confirm capacity and funding consistently under concurrency. | Two people cannot book the same exclusive slot; simultaneous requests cannot overspend the final funds or authorization unit; failed attempts leave no orphaned holds. |
| SYS-03 | P0 | As the platform, I notify users without exposing a support category on a lock screen. | Templates are neutral, preferences honored and links authenticated; delivery retries do not duplicate appointments or charges. |
| SYS-04 | P0 | As the platform, I expire unused holds, proposals and approvals. | Expiry has a configured clock; released funds/capacity are available again; active paid/confirmed work is not accidentally expired. |
| SYS-05 | P0 | As the platform, I handle retries and provider failures safely. | Commands and external callbacks are idempotent; provider/payout failure enters a recoverable queue; no silent inconsistent confirmation is shown. |
| SYS-06 | P0 | As the platform, I preserve professional confidentiality across the application. | Private case bodies are absent from employer views, general search, analytics events, notifications and ordinary diagnostic logs. |
| SYS-07 | P0 | As the platform, I apply a confirmed booking's recorded commercial rules. | Price, funding source, approval ceiling, cancellation policy and timezone are recoverable; later policy edits do not silently change its charge. |
| SYS-08 | P1 | As the platform, I reconcile external busy calendars without exposing their private event titles. | Availability conflicts block new slots; timezone/DST cases are handled; external sync failures are surfaced. |
| SYS-09 | P2 | As the platform, I synchronize insurer authorizations or claims when an agreed integration exists. | Contract-specific mapping, authentication, retries, reconciliation and rejection handling are tested; integration is not assumed to exist for every insurer. |
| SYS-10 | P0 | As the platform, I retain and remove data according to an approved per-domain lifecycle. | Employment deactivation is distinct from record deletion; retention/export/deletion requests route to authorized operations; billing and professional obligations are preserved under the defined policy. |

## 9. Development order

### Step 0 — close the minimum operating decisions

Agree the first pilot service, booking mode, delivery staffing, coverage source, approval mode, cancellation rule and the owner of unresolved requests. Review the first few employee and expert screens against those rules. No final pricing or insurer API is required to model the domains, but a live insured pilot requires a real verification and settlement agreement.

### Step 1 — build the minimum shared foundation

- Organization, identity, employment membership, primary team/cost center and scoped permission grants.
- A small catalog containing one private consultation, one content item and one webinar occurrence.
- Minimal CMS draft/review/publish workflow; reuse a suitable editorial tool instead of building a general page builder.
- Basic client policy, transaction-backed funding reservations, restricted case metadata and a work queue.
- Shared design-system components, localization-ready labels and explicit workspace context.

Keep the foundation thin enough to immediately support the next vertical flow. Do not spend months implementing the whole CMS before an employee can receive a service.

### Step 2 — first complete service flow

Build financial advice end to end: eligible employee → service coverage → direct slot selection or staffed matching → confirmed booking → neutral reminder → private video → delivery → fund consumption → expert payable and safe client statement.

Use an existing video provider through a controlled adapter after evaluating requirements; building a video infrastructure is not a prerequisite for validating NestSelf. For the pilot, app-managed availability plus explicit time off may replace external calendar sync, provided experts commit to keeping availability current.

First demonstration data: one company, two teams, a company owner, a scoped manager, two employees, one expert and one coordinator. Show that the manager cannot access a private request and that two users cannot take the same last slot or spend the same last entitlement.

### Step 3 — exercise configuration differences

Add a second test client with a different approval mode. Demonstrate the same service with automatic allowance versus an explicit funding exception. Add the insurer authorization route when included in the pilot; manual verified import is sufficient initially if the payer agreement supports it.

The domain model for alternate funding belongs in the foundation. Building every payer integration does not.

### Step 4 — deliver the group activity flows

Ship webinar registration and delivery, fixed workshop booking, and the tailored team request → offers → approval → funds reserved → supplier confirmed → delivered flow. Use coordinator-assisted sourcing before creating a supplier marketplace.

### Step 5 — expand from observed demand

External calendar sync; more advanced chat dispatch and staffing; additional approval levels; insurer integrations; automated settlements; richer privacy-safe reports; external supplier portal; dedicated native mobile clients if required by actual usage.

The employee experience must work well on mobile from the beginning. Native packaging can follow once the shared flows and API behavior are stable.

### Pilot exit criteria

1. An eligible employee can receive a real service without manual database changes.
2. The expert and coordinator can complete their work from their scoped interfaces.
3. A second client uses a different funding/approval configuration without a code fork.
4. No employer or generic admin view reveals private employee case content.
5. Booking, cancellation and completion reconcile funds and entitlements without duplicate consumption.
6. Every stalled request, failed notification or failed provider step has an operational recovery owner.
7. At least one content item and webinar can be published and accessed by the intended audience.

## 10. Suggested implementation boundaries

Begin with one modular application/backend and shared authentication. Separate domain ownership in code and storage/access rules even if deployed together.

| Module | Owns |
| --- | --- |
| Identity & access | Identities, organization membership, permission grants, scopes and delegation |
| Organization | Tree, teams, reporting references and effective-dated employment |
| Catalog & entitlements | Service definitions, package capabilities, benefit policies and eligible provider categories |
| Content | Editorial metadata, review, publication, audiences and controlled media |
| Requests & coordination | Support requests, safe routing information, assignment, next action and operational response targets |
| Professional interaction | Restricted intake, conversations and any separately approved professional records |
| Scheduling | Availability, short-lived holds, appointments, capacity and video access |
| Funding & approvals | Employer accounts, allocation transactions, coverage authorizations, funding reservations and approval records |
| Group activities | Webinar occurrences, registration, team requests, offers, supplier confirmation and attendance |
| Billing & settlement | Statements, insurer claims where applicable, provider payables, cash settlement and discrepancies |
| Notifications & reporting | Preference-aware delivery and permitted aggregate views, not a copy of private case content |

Use separate identifiers and states for a request, appointment, approval, coverage reservation and invoice. Link them explicitly. Keep external video, SMS, calendar and insurer providers behind replaceable adapters.

Before implementation, define privacy ownership and operational data retention for the actual markets and contracts. This specification describes product behavior; it is not a claim that a chosen hosting location or configuration establishes legal compliance.

## 11. Decisions still open

| Decision | Recommended initial working assumption | What would change it |
| --- | --- | --- |
| First private service | Financial advice with a limited expert pool | Existing therapy operations are much more ready for a real pilot |
| Personal support approval | Automatic within allowance; confidential funding exception when needed | A client contract requires another disclosed routing model |
| Direct booking vs matching | Direct booking for standardized services; matching for requests that need it | Provider availability and qualification needs |
| Budget pools | Separate advisory, therapy and team-activity purposes | Explicit cross-category conversion agreement |
| Rollover | No invented rule; store period/expiry explicitly and agree before launch | Commercial decision on unused funds and top-ups |
| Insurer verification | Controlled verified authorization records before automated integration | Payer offers a reliable supported authorization/claims API |
| Employee self-pay/co-pay | Model it; enable only with a complete supported payment/refund flow | Commercially necessary in the first pilot |
| Chat operations | Private request/appointment thread first; staffed general advice queue when service commitments exist | The chat add-on is sold as a core pilot benefit |
| Recording | Private consultations off by default; reviewed presenter-only webinar replay | An explicit suitable recording workflow and policy |
| Reports | Broad company aggregates first; finer breakdowns only with privacy protections | Adequate cohort size and a reviewed reporting design |
| Management levels | Arbitrary organizational depth; simple pilot tree and explicit grants | A pilot customer needs multiple cost-center/approval hierarchies |
| Clinical documentation | Keep existing approved professional record process until storage scope is agreed | Experts require professional records inside NestSelf from launch |

## 12. Research grounding

The product choices above are NestSelf recommendations. Public documentation supports confidentiality and employee-initiated access as real operating patterns, but does not establish that every provider or client follows the same approval model.

- Mindgram, public platform description and FAQ, accessed 21 October 2026: describes expert consultations, legal/financial specialists, content, workshops and employer collective reporting without identifying individual platform use. [Official overview](https://mindgram.com/en/)
- Health Assured, published EAP referral guidance, accessed 21 October 2026: describes practical legal/financial support, consent for a management referral, and an alternative employee-initiated access route that removes the employer from the process. This is one provider's guidance, not a universal approval rule. [Official referral guidance](https://pages.healthassured.org/rs/047-RGT-212/images/ZURG_EAP%20Helpline%20Referral%20Form-2022.pdf)

Insurance coverage, authorization format, eligible providers, reinstatement and claim settlement must be established with the actual insurer. This draft does not assume psychotherapy is covered by every plan or that any particular payer already supports codes or an API.
