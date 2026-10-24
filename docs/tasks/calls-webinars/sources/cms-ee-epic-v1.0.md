# NestSelf
# CMS, employee experience, and the first development epic

**Product and engineering plan v1.0 | 22 October 2026**

**Epic:** `NS-CONTENT-01 - Content, discovery, and employee requests`  
**Purpose:** a foundation for product review, screen design, task breakdown, and development after basic authentication and authorization.  
**Status:** detailed proposal. Default decisions are explicit; commercial packages, professional capacity, and privacy policies must be confirmed before the pilot.  
**Scope:** NestSelf admin + employee web experience + professional handling of questions + simple polls and content requests.  
**Document language:** English. This is the English edition of the original Serbian plan, preserving its decisions, scope, and backlog.

## How to use this plan

For product decisions, read Chapters 1-4 and 20. For design and application behavior, use Chapters 5-13. For development, use Chapters 14-19 and 21-24. Chapter 25 contains sources, distinguishes researched facts from our proposals, and maps the plan to the attached project documents.

The English MD and PDF contain the same content. Estimates are planning ranges for a team that already has a usable authentication foundation and shared UI components. They are not estimates based on an existing repository: application code was not part of this review.

## 1. Recommendation: start with content that leads to a useful next step

This is a good first functional area after authentication. Employees immediately have a reason to enter NestSelf, our team gains a tool for maintaining the offering, and development exercises the same access boundaries, languages, and organizations that later modules will use.

The product should complete this loop: **find a relevant topic -> get practical help -> save or try something -> ask a question or suggest content -> receive an answer and see what happened.** Content provides standalone value and an entry point to future professional services.

### 1.1. What this epic delivers

- A structured CMS for articles, short video/audio resources, practical materials, curated answers, and collections.
- Our admin: drafting, professional review, publishing, scheduling, categories, media, audiences, featuring, and freshness monitoring.
- Employee experience: Home, discovery by need and category, search, content detail, saved items, questions, and the employee's own requests.
- Simple interest polls and brief feedback on content usefulness.
- Requests for a topic, format, or translation, each with an owner, response, and final outcome.
- A curated question-and-answer library, with a controlled flow for submitting general educational questions to the professional team.
- Basic, privacy-safe content metrics and a very limited client overview.

### 1.2. What follows in later epics

| Next area | Connection to this epic | What we prepare here |
| --- | --- | --- |
| Webinars and events | From a topic to a scheduled occurrence | Categories, presenter profile, promotional content, an interest button, and a future event reference |
| Private support and consultations | From education to personal help | Service description and authorized link; a separate domain for private intake and communication |
| Team activities | From interest to inquiries, offers, and approvals | Thematic collections and an entry point in the organization context |
| Budgets and benefits | Display of a service actually covered by the package | Capability/entitlement checks; no financial promises controlled by the CMS |
| Programs and advanced personalization | From a collection to several weeks of work | Stable identifiers, curated topics, and private usage state |

In the first version, a webinar announcement has the CTA **"I'm interested in this topic."** A "Register" button appears only when a real event module supports registration, confirmation, and access rules. Expressing interest does not reserve a place. The same principle applies to consultations: do not display an actionable booking button until the service actually works.

### 1.3. Change in sequence from the previous plan

Product flows v0.1 proposed a thin CMS followed by financial advice as the first complete service. Under the new priority, this plan moves **the content experience and handling of interest ahead of the first consultation**. Domain boundaries, grants, and confidentiality remain based on the previous documents. This is not an implicit change to the authentication strategy or a requirement to finish its entire roughly fifteen-week roadmap first.

## 2. What competitors show and what it means for NestSelf

The review uses public official pages available on 22 October 2026. We did not access competitors' private applications. The described capabilities and public organization of content were verified; their internal CMS tools, exact ranking methods, admin workflows, and contractual packages were not. Marketing claims about health outcomes and ROI are not used as NestSelf promises.

### 2.1. Comparison

| Product | Publicly confirmed pattern | Implication for NestSelf |
| --- | --- | --- |
| Mindgram | Combines professional support, educational content, workshops, and podcasts; offers several professional disciplines. [R1, R2] | Connect the library to other forms of help. Finance, family, and everyday questions broaden the reasons to use it. |
| Unmind | Organizes short practical resources and courses around sleep, work, the body, growth, relaxation, and life's challenges. [R3] | The employee's need is the primary entry point; format is an additional filter. Value and duration must be clear before opening a resource. |
| Modern Health | Connects individual support, digital resources, and professionally led Circles group sessions; an on-demand format is also available. [R4, R5] | Support a path from self-guided content to group or individual help. Live sessions and recordings have different availability and rules. |
| Spill | Publicly presents professional answers to specific employee questions, grouped under topics such as boundaries, sleep, relationships, and management. [R6] | Q&A is a standalone format for quickly finding a specific answer and a useful source of future content topics. |
| nilo | Brings together interactive self-guided resources, professionally led roundtables, individual support, and an HR overview. [R7] | Editorial programs, events, and support should share topics. Clients also need an operational activation plan. |
| Officevibe, adjacent category | Separates individual identities from survey reporting and documents thresholds, written-answer visibility, and access limitations. [R8] | A poll needs response rules, a decision owner, and safe results display. Its thresholds are not universal rules to copy. |
| Togetherall, adjacent category | Offers a peer-support community with continuous professional moderation, alongside resources and courses. [R9] | An open community is a separate operational product. NestSelf's first Q&A should be professionally answered and moderated, with clear accountability. |

### 2.2. Decisions drawn from the comparison

These are our conclusions, not claims that competitors implement exactly these rules:

1. **Users start with a problem or goal.** "I struggle to switch off after work" is a better entry point than "Video library."
2. **Offer both short and longer options.** A three-minute exercise, five-minute article, and professional conversation serve different moments.
3. **Every resource needs a clear practical outcome.** Users should know what they can try or clarify after reading.
4. **Demand should influence the editorial plan.** Close the loop between questions, polls, new resources, and employee updates.
5. **Trust is part of the experience.** Explain who can see a question and what the employer receives at the relevant point in the journey.
6. **Local language and context can be an advantage.** Initial differentiation comes from practical relevance to our users and available professionals. A large library alone does not guarantee usefulness.

### 2.3. Where the first pilot should be better

| Moment | A NestSelf promise we can operationally fulfill |
| --- | --- |
| I have little time | "Show me something useful in less than five minutes." |
| I do not know what to call my problem | Search in everyday language and short "I want to..." entry points |
| I am not ready for a consultation | I can start with an article, exercise, or general professional answer. |
| The topic I need is missing | I can suggest it and see the decision and status. |
| I am unsure what my manager can see | A brief explanation when I submit a question or answer a poll. |
| I am a manager | Resources help with conversations and teamwork; personal use stays in my personal context. |

## 3. Who the content serves and what they gain

### 3.1. Main employee jobs

| Need | Example entry point | Useful delivery | Next step |
| --- | --- | --- | --- |
| Quick relief | "I have three minutes between meetings." | A short audio exercise with a transcript | Try it now; save it for later |
| Understanding a situation | "I cannot unwind after work." | A short article, concrete examples, and one exercise | Open a related collection |
| Practical problem-solving | "How do I start a personal budget?" | A checklist and a simple example | Read a general Q&A; use support when available |
| Family or life change | "How do I balance childcare and work?" | Different situations without assuming one family model | Suggest a topic or a general question |
| Working with others | "How do I set a boundary with a colleague?" | Example phrases and conversation preparation | Try one technique |
| Self-directed learning | "I want to sleep better." | A collection of several short resources | Save the collection and continue at your own pace |

Employees gain understandable, accessible, reviewed materials, a clearer understanding of their benefits, and an opportunity to influence future topics. We do not promise that reading resolves a health condition or that opening the application demonstrates improved mental health.

### 3.2. Value for the client and NestSelf

Clients gain an accessible foundation for a company-wide program, materials for voluntary activation, and an overview of whether the program is used at a sufficiently broad aggregate level. They do not receive readers' names, individual responses, or a list of people seeking help.

NestSelf gains repeatable content production and maintenance, insight into missing topics, and a standard way to turn interest into editorial work. This supports expansion to multiple clients without a separate copy of the library for each one.

### 3.3. Experience principles

- No mandatory mental-state questionnaire before the first useful resource.
- Preferences are optional, editable, and private in the personal context.
- No pressure through streaks, public leaderboards, employee competition, or compulsory completion.
- Content is readable on a phone, has a text alternative, and states its duration clearly.
- Recommendations do not infer diagnoses from reading or search behavior.
- Service availability comes from application rules; editors cannot grant benefits through copy.

## 4. First-version boundaries and the development starting condition

### 4.1. Release levels

| Level | Included | Exit condition |
| --- | --- | --- |
| M1, first vertical slice | An admin creates and publishes an article; an invited employee reads and saves it | Works end to end, with access to drafts and unauthorized client content denied |
| V1, complete epic | CMS workflow, six categories, search, all agreed basic formats, collections, feedback, interest polls, requests, and moderated Q&A | The complete Chapter 23 acceptance scenario passes, and queues have operational owners |
| V1.1 | HR featuring suggestions, additional content languages, better bulk editing, and recommendations informed by manually curated demand | Stable pilot and demonstrated need |
| Later | Event registration, consultations, team offers and budgets, advanced programs, wellbeing measurement, and an open community | Separate epics with their own operational and access rules |

### 4.2. Minimum authentication handoff

Content development requires identity and active membership, two test clients, employee/admin contexts, a server-side session, the central `authorize()` call, basic audit, and a way to assign grants. Automated scenarios use a supported development principal with synthetic data, as defined in the authentication strategy.

Completing the first enterprise SSO integration and a native mobile application is not a dependency for M1. Before a real employee pilot, production sign-in, access revocation, applicable privacy rules, and the other release conditions of the authentication strategy must work. This epic does not bypass those conditions for using real user data.

## 5. Taxonomy: needs, topics, categories, and formats

### 5.1. Proposed categories

| Category | Example topics | Example resource | Initial status |
| --- | --- | --- | --- |
| Stress and emotional balance | Boundaries, overload, emotions, recovery | "Ending the workday without feeling permanently behind" | V1 |
| Sleep and rest | Routines, switching off, breaks, shift work | "Five minutes to prepare for a calmer evening" | V1 |
| Relationships and family | Partnership, parenting, caregiving, conflict | "Asking for help at home without an argument" | V1 |
| Money and financial security | Personal budgets, debt, emergency savings, planning | "Your first household budget review" | V1, with professional review and local context |
| Work and development | Focus, communication, change, career | "Preparing for a difficult conversation" | V1 |
| Body and everyday habits | Movement, short breaks, energy, basic habits | "A short break from sitting" | V1, with appropriate professional review |
| Everyday legal questions | Contracts, administration, family and consumer matters | "What to prepare before a general legal consultation" | Later, when a local professional and enough material are available |
| Leading people and teams | Conversations, change, supporting colleagues | "Talking to an overloaded team member" | A collection within Work and development in V1; a category later |

Publish the first six categories only when each has at least four independently useful, approved resources. Do not show the two additional categories as empty cards. A resource has one primary category for editorial ownership and up to two secondary categories for discovery.

### 5.2. Keep the different dimensions separate

| Dimension | Purpose | Rule |
| --- | --- | --- |
| Category | Stable navigation | A small controlled set; editors need taxonomy permission to add one |
| Topic | More precise relationships | Controlled vocabulary, synonyms, and duplicate merging |
| "I want to..." need | A user-friendly entry point | Manually mapped to content; not a health assessment |
| Format | Choice of consumption method | Article, audio, video, practical material, Q&A, collection |
| Duration | Choice based on available time | Up to 5 min, 5-15 min, 15+ min; actual duration |
| Language and local applicability | Comprehension and accuracy | Language is separate from the content's country/jurisdiction |
| Audience and package | Access permission | System policy, separate from descriptive tags |

The "for managers" tag supports relevance. It does not itself grant organizational privileges. An employee can read general leadership content without a manager grant unless the contract explicitly restricts that resource.

### 5.3. Languages

The authentication document specifies interfaces in Serbian Latin and Cyrillic, Hungarian, and English. Retain these locale codes in the content model: `sr-Latn`, `sr-Cyrl`, `hu`, `en`. This does not mean every resource is translated into all four languages at launch.

Each language version has its own content, review, and status. The UI displays the resource's actual language. If a translation is missing, employees can explicitly open an available version in another language or request a translation. Do not silently switch languages. A pilot client needs a starter set in the agreed language. Serbian transliteration may help create drafts; it also requires review before publication.

## 6. What the CMS actually manages

### 6.1. V1 resource types

| Type | Composition | Value and required alternative |
| --- | --- | --- |
| Article | Title, short introduction, structured body, practical steps, sources | Understand a topic and know what to try |
| Short video | Video, poster, duration, captions, transcript, short introduction | See a technique or explanation; use the text alternative when needed |
| Audio | Audio, duration, transcript, instructions on when and how to use it | A short exercise or explanation without looking at the screen |
| Practical resource | Web checklist or template, with an optional approved PDF | Practical preparation; personal answers entered are not stored in V1 |
| Curated Q&A | General question, professional answer, attribution, review date | A quick answer to a specific problem or uncertainty |
| Collection | Introduction, suggested sequence, resource references | A path through a topic in several small steps |

In V1, a collection is an editorial sequence without certificates, mandatory completion, or a separate LMS. Its resources are the same items shown in the library; do not duplicate their text.

### 6.2. Shared content contract

| Field group | Required information or behavior |
| --- | --- |
| Identity | Stable `content_id`, type, language-specific slug, schema version, language variant |
| User promise | Title, summary, "What you get," expected duration, and difficulty/preparation when relevant |
| Structure | Primary category, secondary categories, topics, needs, editorial collections |
| Authorship | Author, professional reviewer, public description of expertise, maintenance owner |
| Quality | Sources, review date, next review date, local applicability, flag for quickly outdated content |
| Accessibility | Language, alt text, captions/transcript, accessible links, readable material |
| Publication | Draft and approved revision, audience, entitlement, availability start/end |
| Media | Approved asset references, usage rights, and individual expiry dates |
| Next step | Up to three related items and no more than one primary CTA from the allowed catalog |

Required professional review depends on the topic. Financial, legal, health, and nutrition content must not present advice as universally applicable when it depends on personal circumstances or local rules. Editorial copy clearly distinguishes general education from individual advice.

### 6.3. Editor blocks

Use an existing rich-text editor with a limited set of our blocks: section heading, paragraph, list, quote, image, professional note, practical step, checklist, approved media, related resource, and CTA. Editors cannot insert arbitrary HTML, JavaScript, iframes, or styles. Store documents as validated structured JSON and render them through approved components. Tiptap supports JSON storage and rendering, making it an example of a suitable building block. [R10]

CTAs are typed: `open_content`, `open_collection`, `suggest_topic`, `ask_general_question`, `express_event_interest`, or a reference to an actually enabled service. The backend validates URLs and capability rules. Editors cannot create a fake booking or a link that bypasses eligibility.

### 6.4. Photography and tone

Show people in recognizable situations: home, family, breaks, conversations, and everyday work. Avoid stereotypical images of despair, presenting a stock-photo subject as a professional, and promises of a cure. Cards use aspect ratios and focal points that work on phones; text is not embedded in photographs. The asset carries its license, consent where required, and alt text.

The default visual direction is a light background with forest/mint accents. Colors and typography remain tokens in the existing design system. Editorial content does not select its own fonts and colors article by article.

## 7. Employee Home: what appears and in what order

### 7.1. First visit

After sign-in, users enter the personal context of the active organization. They see a short explanation of the available library and privacy, with an **"Explore topics"** button. They may choose up to three interests or skip this step. Do not ask for a reason, diagnosis, mood score, or family information. If several organizations are active, the context is clearly identified and switchable.

### 7.2. Home layout

| Order | Module | Content and rule |
| --- | --- | --- |
| 1 | Short greeting and search | "What would help you today?"; current context remains visible |
| 2 | One featured recommendation | A concrete outcome, duration, and one CTA; no rotating carousel |
| 3 | Quick need choices | "A calmer end to the day," "Better sleep," "Easier conversations," "More control over money" |
| 4 | In less than five minutes | Three or four available resources in different formats |
| 5 | Saved / continue | Up to three items, only when private state exists and the user has not disabled it |
| 6 | Explore topics | The six starter categories with short, specific descriptions |
| 7 | Topic of the month / collection | A manually approved collection; no assumption that everyone has the same problem |
| 8 | Ask a professional | One approved general answer and a link to all answers |
| 9 | Shape future topics | No more than one active poll or topic suggestion |
| 10 | Additional support | Only genuinely available options; otherwise a clear explanation of future content without a nonfunctional CTA |

On a phone, the first screen contains search, the recommendation, and the beginning of quick needs. Do not force all modules above the first scroll. Remove modules without relevant content rather than displaying empty slots.

### 7.3. Card rules

A card shows a photograph or suitable illustration, a title up to two lines, a short concrete outcome, format, duration, language when different from the interface, and a save button. An "Included in your plan" badge comes from the eligibility check. Do not label something "Free" unless the package or funding supports that claim.

Professional authorship appears on the card when it matters to selection and always on the detail page. Do not display view counts or public popularity scores in V1. They can distract from usefulness and are unnecessary for the employee's decision.

### 7.4. Behavior after first use

Continuity comes from saved items, the last audio/video position if enabled, and selected interests. Users can remove individual state and turn off continuation history. This personalization must never conclude that "someone reads about debt, therefore they need a financial intervention."

## 8. Discovery, search, and content detail

### 8.1. Employee navigation

V1 main items: **Home; Explore; Saved; My requests.** Explore includes categories, collections, and Questions and answers. The profile contains language, private preferences, notifications, and benefit explanations. Add Support and Events modules when they actually work.

### 8.2. Explore and category pages

Explore shows search, categories, a few curated collections, and recent content. A category has a brief explanation, up to five topics, a featured starting resource, Q&A, and a filterable list. Filters cover format, duration, and language; topic is an additional selection, not a parallel overwhelming list of tags.

Default sorting reflects editorial relevance. "Newest" is an alternative. Preserve selections and position when returning from a detail page. Pagination or "Show more" uses a stable order; do not create an infinite feed.

### 8.3. Search

Search covers titles, summaries, approved text, questions/answers, categories, and controlled synonyms. Examples include "I cannot switch off," "boundaries," "arguments," and "expenses." Prefer the same language and the intended meaning, while keeping format and duration visible.

Acceptance examples cover Cyrillic/Latin script, diacritics, Hungarian characters, and common everyday expressions. Preserve original text and generate normalized indexing variants. V1 uses PostgreSQL search with carefully configured synonyms/fuzzy matching. Add dedicated search infrastructure when scale and quality justify it.

A result candidate must be accessible before computing counts, facets, or snippets. Do not disclose a restricted resource's title through "12 results," autocomplete, or highlighting. Search does not include other employees' questions, requests, or private answers.

When there are no results, offer related approved topics and **"Suggest content."** Do not automatically copy the search into a request: employees first see what they will send and choose to submit it. Raw search text is not stored in standard analytics.

### 8.4. Content detail

The detail page includes title, summary, "What you get," duration, author/reviewer, professional review date, main content, and practical steps. These are followed by "Was this useful?", up to three related resources, the option to ask a general question, and an allowed next step.

Video does not autoplay with sound. Audio offers playback-speed controls and a transcript. Checklists work as web content; any checkbox state is local and disappears on closing unless a later module explicitly introduces private storage. PDF is an additional option, not the only way to access the information.

### 8.5. Required states

| State | Behavior |
| --- | --- |
| Loading | A structurally appropriate skeleton and accessible announcement; remove the previous tenant's content immediately on context change |
| No content in a category | Do not promote the category; a direct link offers a useful way back and a topic suggestion |
| Translation unavailable | Clearly identify the available language and let the user choose |
| Saved item archived | "This content is no longer available"; show an approved replacement only if accessible to the same user |
| Access expired | Neutral message that does not reveal a private title to an unauthorized visitor |
| Connection or video failure | Retry, transcript, and technical issue reporting without copying personal context |
| Session expired | Sign in, then return to authorized content; sensitive form text is not in the URL |

## 9. Our admin: editorial work from idea to maintenance

### 9.1. Admin navigation

| Screen | Main functions |
| --- | --- |
| Content overview | Drafts, pending review, scheduled, expiring soon, review required |
| Resources | List by type, language, owner, category, status, and audience |
| Editor | Content, metadata, media, sources, preview, and revisions |
| Review queue | Professional review, return with reasons, approval of an exact revision |
| Collections & Home | Collection order, predefined Home slots, and preview |
| Categories & topics | Controlled categories, synonyms, topic merging, and redirects |
| Media | Upload, processing status, rights, alternatives, usage, and expiry |
| Editorial demand | Sanitized requests, decisions, backlog, and links to published resources |
| Polls | Definition, audience, duration, aggregates, and the decision on what happens next |
| Content performance | Availability, usefulness, freshness, and privacy-safe aggregate signals |

**Restricted intake** is a separate screen and API for assigned professional handlers. It is not a default tab for an ordinary CMS author, HR, client success, or a super admin. The editorial backlog receives a reviewed brief without raw employee text.

### 9.2. Publishing flow

1. The author selects type, language, owner, and primary category; a draft is created.
2. They provide the user promise, content, sources, alternative formats, and proposed audience.
3. Validation identifies missing requirements; preview uses the actual employee layout on phone and desktop.
4. The author submits a specific revision for review. The reviewer accepts or returns it with specific comments.
5. The publisher chooses immediate or scheduled publication and confirms the audience in an effective-access preview.
6. The system publishes only the approved revision and approved media, for the approved audience and period.
7. The owner receives the next review task; media or publication expiry creates a visible operational action.

### 9.3. Revisions and states

| Record | States | Important rule |
| --- | --- | --- |
| Content revision | `draft`, `in_review`, `changes_requested`, `approved` | Approval binds the hash/ID of content, language, metadata, media, and audience |
| Publication | `scheduled`, `live`, `expired`, `withdrawn` | References the exact approved revision; the API also checks availability |
| Resource | `active`, `archived` | Archiving withdraws active publications; history remains |
| Media asset | `uploaded`, `quarantined`, `processing`, `ready`, `rejected`, `expired` | Publication requires `ready`; rights and expiry still apply after processing |

Editing published text creates a new working revision. Employees continue to see the previous version until a newly approved publication is available. Every change after approval requires review again. V1 has no "just a typo" shortcut that bypasses the rule.

Scheduling stores UTC and the selected time zone. The user receives a preview in local time. Publishing jobs are idempotent; availability does not depend solely on a worker processing a message on time. Periodic reconciliation checks missed schedules without starting a publication that is no longer authorized.

### 9.4. Urgent withdrawal and rollback

A publisher with the appropriate scope can immediately withdraw incorrect, expired, or problematic content and record the reason. Withdrawal removes it from search and recommendations and prevents new media access. Restoring an earlier revision is a new publication after checking that rights, audience, and professional review are still valid. Audit records the decision without copying original employee messages.

### 9.5. Two-person control and a small initial team

Authoring and publishing are separate permissions. The initial team may assign several permissions to one person, but professional content requires review by another qualified person. Ordinary platform instructions may have an explicitly simpler policy. Platform ownership does not silently grant self-approval.

## 10. Audiences, packages, and access rules

### 10.1. Availability formula

Employee content is accessible only when all of the following hold:

**Active principal + valid employee context + active membership + approved published language variant + valid time window + allowed audience + appropriate entitlement + valid media.**

An explicit audience allowlist may use OR between specified organizations or units; all other checks remain AND conditions. Do not create a rule where "a global tag or any company grant is sufficient."

### 10.2. Supported audiences

| Audience | V1 behavior |
| --- | --- |
| All eligible employee users | Shared NestSelf catalog, subject to the required capability |
| One or more organizations | Explicit availability assignments; no resource copies per client |
| Specific organization units | Only within the author's/publisher's allowed audience and server-side scope checks |
| Public website | Separate publication and approval; not included in V1 delivery |

For the first client, use the global catalog and very few client-specific exceptions. Team-targeted content may use a legitimate business segment, but teams must not be formed around inferred health conditions or individual reading histories.

### 10.3. Audience and benefit are different concepts

An editor can write "learn more about financial advice" but cannot set the number of covered sessions, fund balance, or booking eligibility. `required_capability` references confirmed package configuration. Service presentation gets its status from the catalog/entitlement module. V1 needs a small readable contract for enabled content capabilities; a complete funding ledger is not a prerequisite.

### 10.4. Preview and context switching

Preview is an authorized audience simulation, not impersonation of a real employee. It does not load that person's saved items, history, or questions. Switching organizations invalidates employee caches and query keys, recalculates availability, and shows separate personal state for the new membership. Shared content IDs may remain the same; private history and poll responses are not shared between employers.

## 11. Polling: which polls we introduce and how responses are used

### 11.1. Separate the purposes

| Type | Example | V1 decision | Who benefits |
| --- | --- | --- | --- |
| Content voting | "Which topic would you like next?" | Included: one question, up to five options, optional "none of these" | Employees influence the program; editors receive a demand signal |
| Format selection | "Would a short video or a checklist help you more?" | Included through the same simple poll mechanism | We choose formats people can use |
| Resource usefulness | "Was this useful?" | Included: yes / partly / no, with an optional predefined reason | Editors see whether content delivers its promise |
| Knowledge check | A question after an educational article | Later; no individual score for the employer | Employees check their understanding |
| Wellbeing pulse | A stress, mood, or psychological-safety rating | A separate later epic, with a professional instrument, processing, and reporting rules | Potential longitudinal insight, involving substantially more sensitive data |
| Event logistics | Choosing a date or confirming attendance | Event module; the response may be identified with a clear explanation | Scheduling a real occurrence and managing capacity |

Do not present an interest poll as a mental health test or its results as a diagnosis of company needs. Selecting "sleep" does not mean the employee has a sleep disorder.

Unmind publicly treats Insights & Assessments as a distinct area for personal and organizational insights. This supports treating wellbeing measurement as its own product with a professional methodology, separate from editorial voting. [R13]

### 11.2. Complete poll example

**Question:** "What would help you most in upcoming content?"  
**Options:** ending the workday more easily; better conversations; household budgeting; sleep and rest; none of the above.  
**Participation:** optional and skippable; content is never blocked.  
**Duration:** seven to fourteen days, aligned with the editorial cycle.  
**Placement:** a Home card and the relevant collection; one instance per campaign and audience.  
**After voting:** "Thank you. Your response helps us choose future topics."  
**Closure:** the owner records a decision and links the published collection or explains that the topic is being deferred.

Example editorial response: "Based on your interest, we prepared a collection to help you end the workday more easily." Do not announce that "your team is stressed" or rank teams by their health.

### 11.3. Visibility and the privacy promise

There are no public live results by default. Employees see their own choice and the final editorial decision. Our editorial dashboard receives aggregate results for an approved audience, without named response rows. Employers do not receive individual poll response distributions in V1.

UI copy: **"Participation is optional. Your employer cannot see your individual response. NestSelf uses responses for aggregate content planning."** Do not claim "complete anonymity": sign-in, duplicate-vote prevention, and limited technical data mean the system can link records under controlled conditions.

Internal distributions for small audiences require at least ten distinct participants, together with small-cell and complementary-total protections. Even above that threshold, do not show an option selected by too few people. Editors can use a broader permitted global aggregate when appropriate. K=10 is the authentication strategy's working default, not a guarantee of anonymity. Until these protections exist, distributions for small audiences remain unavailable.

### 11.4. Response rules

- One active response per `poll_instance` and participant pseudonym within that audience.
- Responses can be edited while the poll is open; retain the latest value without an analytics history of individual choices.
- Options and the meaning of the question lock after the first response; material changes require a new instance.
- Closing and response writes are transactional: reject late responses with a clear message.
- Snapshot the audience at opening for a stable denominator; recheck active membership on voting. New members enter the next instance unless another mode was explicitly defined in advance.
- Never send HR a list of who has or has not responded. Any reminder remains generic and optional.
- Frequency target: no more than one interest poll per person in seven days; a skipped poll does not keep reappearing in the same cycle.

### 11.5. Poll data

Store votes in the engagement module, separately from the CMS definition. The proposal is a per-poll HMAC pseudonym derived from identity, context, and instance, with the key in secret storage. The editorial team does not receive the key. This reduces direct linkage between polls but remains pseudonymization. Do not store IP addresses, names, or comment text in the vote table. Audit records the command's technical outcome without the selected option.

The "my response" API computes the same respondent key after authorization. Deletion and retention have defined procedures. Ordinary CMS exports never include individual votes. V1 polls do not accept free-text responses; anyone wishing to explain a topic uses a separate request with a clear disclosure.

## 12. Request flow: from a missing topic to a response and delivery

### 12.1. Request types supported by this epic

| Request type | Minimum input | Final outcome |
| --- | --- | --- |
| New topic | A topic or need from a list; optional short explanation | Existing resource, planned topic with a target date, published content, or reasoned closure |
| Different format | Existing resource and desired format | An available alternative or a realistic editorial decision |
| Translation | Resource and requested language | Published translation or an explained response |
| Webinar interest | Topic, language, optional online/in-person preference | Interest acknowledgment and, later, a separate invitation to actual registration |
| Content issue | Resource and reason: inaccurate, unclear, inaccessible, media failure | Correction, response, or recorded explanation |

A general educational question uses related infrastructure but the separate professional flow in Chapter 13. Private consultations and team-building inquiries belong to different domains, data, and later processes. An employee's workshop interest does not charge a budget, automatically send an offer to a manager, or create an appointment.

### 12.2. Employee journey

1. The employee chooses "Suggest a topic," "Request another format," or the appropriate CTA in search or on a resource.
2. They select type, topic, language, and optionally existing content. Structured choices alone are sufficient to submit.
3. If adding free text, they see who reads it and instructions not to include other people's names, medical history, document numbers, or details intended only for a private adviser.
4. They review a summary before submission. Free text goes to restricted intake; the ordinary CMS receives only an approved brief.
5. They receive a reference and their own request page with status, next action, and response expectation.
6. A neutral notification links back to the application when the team responds. Employees can add information or withdraw the request when appropriate.
7. When content is published, the same request receives an accessible resource link and a final notification. If nothing will be produced, the employee receives an explanation.

The same request may help several people, but their identities and text are not public. Our team links several sanitized requests to one editorial brief. Their count supports prioritization through permitted aggregates, not a public employee list.

### 12.3. States and responsibility

| Internal state | Employee label | Required next action |
| --- | --- | --- |
| `submitted` | Received | Triage owner checks the type and assigns an owner |
| `needs_information` | Waiting for your information | A specific question and a follow-up date |
| `triaged` | Reviewing your suggestion | Owner records a decision or links an existing resource |
| `planned` | Planned | Target period, responsible editor, next review |
| `in_progress` | Preparing content | Editorial brief and realistic target date |
| `fulfilled` | Available | A valid link or response that fulfills the request |
| `closed_with_reason` | Closed with an explanation | Reason and, where available, an allowed alternative |
| `withdrawn` | You withdrew this request | No further work apart from necessary administration |

"Planned" must not become permanent parking. Every active request has `owner_id`, `next_action`, `next_action_due`, `last_update_at`, and a fallback operational queue. An editorial work item and an employee request are separate linked records: one article can fulfill multiple requests, while one request can require several internal tasks.

### 12.4. Pilot operational defaults

The proposal is immediate acknowledgment, human triage within two business days, and a decision or meaningful status update within five business days. This is an operating target, not a promise to produce a new video within five days. The clock uses a configured business calendar, initially weekdays 09:00-17:00 in `Europe/Belgrade`; holidays and additional service calendars are explicit configuration.

For `needs_information`, send one discreet reminder after seven calendar days. After fourteen days without a reply, the system may close with an explanation and the option to submit a new request. Internal delays must never close a request as if the employee had abandoned it. Overdue work escalates to the primary and backup owners.

### 12.5. Priorities

Handle reports of inaccurate or potentially harmful content and access failures first. Group other suggestions by topic, usefulness, available expertise, production effort, and the number of interest signals that can be safely aggregated. A larger client budget does not grant access to individual questions. Sponsored topics cannot change professional conclusions or covertly replace recommended content.

## 13. Questions and answers: a knowledge base and controlled professional handling

### 13.1. Three different products

| Flow | User expectation | Who sees the original | What this epic delivers |
| --- | --- | --- | --- |
| Reading general Q&A | An approved answer to a common question | No original sender exists in the published resource model | Complete support in V1 |
| Submitting a general educational question | A professional general answer with clear timing and boundaries | Sender and assigned professional intake/expert; exceptions only under restricted rules | Complete controlled support in V1, without therapy chat |
| Seeking personal advice | A confidential conversation about a specific personal situation | Participant and authorized professional team | Separate support/consultation epic; do not imitate it through the CMS |

### 13.2. "Ask a general question" form

The form includes subject area, language, and a question limited to approximately 1,500 characters. Attachments are excluded. Before submitting, users see: **"Your question goes to an assigned member of the NestSelf professional team. Your employer does not receive it. This provides a general educational answer; for an individual assessment, use the available private support."** If private support is not yet enabled, the last sentence clearly identifies an actually available alternative.

Do not promise a live answer or 24/7 monitoring. The form includes discreet information that it is not an emergency-help channel and a link to approved local information. The responsible professional function maintains exact local contacts and copy; unverified numbers must not be hardcoded into the CMS. This defines the product boundary and does not replace a professional protocol.

### 13.3. Handling and answering

1. Create a restricted submission and a safe operational wrapper. Queue previews do not show the question body.
2. An authorized professional intake reviewer claims the item atomically; check the assignment before the first read.
3. Determine whether a general answer is appropriate. A specific clinical, legal, or financial case is not resolved through generic copy.
4. If clarification is needed, request one clear addition. Limit V1 to two clarification rounds so the flow does not become an unpromised chat service.
5. The professional prepares a response and may link approved resources. Topics outside their expertise require an appropriate assignment.
6. The answer receives professional review appropriate to the subject, is delivered privately in the application, and closes the request or routes it into a suitable supported flow.
7. Users may optionally rate the answer's usefulness. The employer sees neither the question, the answer, nor the individual's rating.

The proposed target is a first professional response within five business days, with capacity confirmed in advance. The answer identifies the professional, date, and boundary of general education. Rerouting must not broadcast the full text to a wide group of experts; assignment changes are recorded and explained to the user when they change who can actually read the submission.

### 13.4. Creating a resource for other employees

A privately submitted question never automatically becomes a Q&A resource. To use that specific question, show the sender the exact edited, generalized question and answer, intended audience, and attribution description. Separate optional permission is required for that version; declining does not affect access to their answer or benefits.

Remove names, company, team, dates, distinctive life details, and combinations that could identify someone. The new CMS item does not contain a link to the original question accessible to content authors. Any internal link needed to document permission remains in the restricted domain.

Alternatively, a professional may write a completely new standalone FAQ from a recurring general theme, without quoting a particular message or reproducing recognizable circumstances. This does not justify copying raw messages into the editorial CMS. Withdrawal of permission for a specific publication triggers review and removal of that derived item.

### 13.5. Moderation and operational sustainability

V1 has no public employee comments, employee-to-employee answers, or likes on personal questions. Q&A is a professionally authored publishing channel. This allows clear answer ownership and maintained fact-checking.

If intake encounters an urgent or serious personal issue, use an approved professional escalation protocol. Do not forward the text to HR or attempt to diagnose through workflow automation. Daily queue monitoring and coverage for absent professionals are required. If coverage is unavailable, pause new submissions with an honest explanation while existing items retain response plans. V1 cannot be considered fully operational without a real owner and backup for this queue.

## 14. Personalization, collections, and Home curation

### 14.1. A simple deterministic start

Filter first for access, published revision, language, validity windows, and technical availability. Rank eligible candidates using editorial priority, explicitly selected interests, selected language, recency, and format diversity. Do not repeat the same resource across Home rows.

V1 ranking should use explainable weights and manual featuring within limited slots. Weights are product configuration, not an unrestricted field for every editor. AI recommendations, an embedding database, and inferred health profiles are unnecessary for a useful starting Home experience.

### 14.2. Fallback rules

1. An approved pin for the specific authorized audience, when relevant.
2. An approved global recommendation in the requested language.
3. An available resource matching an explicitly selected interest.
4. An editorially selected introductory resource in a supported language.
5. If no candidate exists, omit the slot and present a clear language/category choice.

No fallback broadens audience, entitlement, or language without a visible user choice. A mandatory platform notice is not an ordinary "featured article": if such notices are needed, model them separately and do not use them for promotional pressure.

### 14.3. Collections

Starter collections: **"An easier end to the workday," "First steps with a household budget,"** and **"Conversations we keep postponing."** Each contains three to five existing resources, a total duration, and a suggested sequence. Employees may open any part.

If a resource is withdrawn, reassess the collection immediately. Remaining parts must still make sense; a collection below the minimum useful item count leaves promotion and creates a task for its owner. Employees do not see hidden titles or counts of inaccessible private collection members.

### 14.4. Client-specific featuring

In V1, our publisher may feature an approved resource for a client within their scope. In V1.1, HR may propose featuring, with NestSelf approval and scheduling. HR cannot edit professional copy, make reading a condition of benefits, or receive a list of people who opened the content.

## 15. Privacy, permissions, and data retention

### 15.1. Visibility matrix

| Information | Employee | CMS author/publisher | Assigned professional intake | HR/manager |
| --- | --- | --- | --- | --- |
| Published resource | If accessible | Within assigned scope | As an eligible user or within work scope | As an eligible user |
| Draft and review | No access | According to separate permissions | Assigned professional review only | No access |
| Saved items and history | Own, per context | No named overview | Only if intentionally shared in a supported flow | No access |
| Raw request free text | Own | No access | Active assignment and appropriate purpose only | No access |
| Sanitized editorial brief | Own visible outcome | Assigned editorial work | As needed within assignment | No employee identity link |
| General question and private answer | Own | Only a separately approved CMS derivative | Assigned work | No access |
| Individual poll choice | Own | No named access | Not part of the professional assignment | No access |
| Permitted aggregate signals | Final editorial decision | Approved aggregates and thresholds | No automatic additional access | Limited monthly company overview only |

Platform owners, ordinary support, and client success do not have hidden universal access to private information. Restricted submissions follow the authentication strategy's four controlled entry paths: participant, explicit professional assignment, separate supervision permission where applicable, or time-limited emergency access. An administrative grant alone is insufficient.

### 15.2. Proposed permissions

| Action | Scope and control |
| --- | --- |
| `content.create`, `content.edit` | Assigned collections/resources and allowed languages/audiences |
| `content.review` | Topic/professional discipline and exact revision; independent review where required |
| `content.publish`, `content.withdraw` | Assigned audience and entitlement envelope |
| `taxonomy.manage`, `home.manage` | Controlled platform scope or assigned client scope |
| `media.manage` | Asset rules and ownership; does not grant access to restricted attachments |
| `poll.manage`, `engagement.aggregate.read` | Definitions and permitted aggregates only |
| `editorial_demand.manage` | Sanitized briefs and statuses, without employee free text |
| `restricted_submission.read/respond` | Active professional assignment and purpose; additional restricted-domain condition |
| `reports.aggregate.read` | Company scope, monthly window, and small-cohort protection |

These names propose extensions to the central action catalog. Do not introduce a second system of hardcoded CMS roles. The "author," "publisher," and "intake expert" templates simply make grant assignment easier.

### 15.3. Aggregates and analytics

Employee-facing and employer reporting follow allowed audiences and thresholds. V1 company reporting uses a fixed monthly window and broad program-usage metrics. There are no small-team filters, exact usage timestamps, combined category/location filters, named exports, or raw text. Suppress below-threshold cells and complementary totals from which they could be calculated.

The threshold of ten applies to relevant participants in the displayed metric, not merely the company's headcount. A company with one hundred employees and one Q&A user does not receive a separate Q&A metric. Global editorial reporting also respects purpose and identifiability, especially for small client-specific resources.

### 15.4. Telemetry and notifications

- No advertising pixels, session replay, or input recording on employee or restricted screens.
- Raw searches, questions, answers, poll options, and free text are absent from standard logs, exception payloads, and URLs.
- Analytics events use minimal identifiers and a defined purpose; mapping resource IDs to sensitive topics is also protected.
- Promotional notifications are optional and separate from responses to a user's request. Dedupe and preference checks apply at send time, not only at message creation.
- Push/email subjects are neutral: "You have a new message in NestSelf." Deep links require authorization; email does not include the question or private-support topic.
- Users can report technical issues without sending the entire form. Redacted diagnostics contain the case/request ID and a safe error code.

### 15.5. Working retention proposal

These are product defaults for review with the responsible legal/privacy function. They do not adopt medical-record retention periods from other domains. Free text in this epic is not used for clinical notes.

| Domain | Proposal | Important condition |
| --- | --- | --- |
| Content and revisions | Active content plus 24 months of archived revisions for editorial accountability | Licensing or another justified requirement may need a different period |
| Saved items | While the user keeps them and retains appropriate access | User-deletable; leaving an employer does not automatically transfer them to another employer |
| Media position / continuation history | Up to 90 days of inactivity; optional | Turning it off deletes active private state |
| Individual poll response | Up to 90 days after closure | Afterwards, retain only appropriately processed aggregate results |
| Raw editorial request and general-question text | Up to 90 days after closure unless a longer justified reason applies | If it is actually a professional case, apply separate classification and the approved policy |
| Operational metadata and statuses | Up to 12 months | No message body; purpose is operational review and user rights |
| Analytics events | Minimal pseudonymous processing period, proposed at 90 days | Broader monthly aggregates proposed for up to 12 months, subject to risk review |
| Audit | Central authentication/audit policy and applicable obligations | No private-content copy; restricted access |

Deletion covers primary storage, derived indexes, caches, and an approved backup-expiry plan. Before the pilot, policy review must address user export, withdrawal of publication permission, and employees losing membership. The UI must not promise immediate deletion of all backup copies.

## 16. Editorial program and the people running it

### 16.1. Initial content

| Item | Pilot target | Note |
| --- | --- | --- |
| Short articles | 24 | At least four useful starter resources per active category; other formats can contribute to that minimum |
| Curated Q&A | 8 | Specific everyday questions, independent of employee submissions |
| Audio | 4 | Short, good-quality recordings with transcripts |
| Video | 4 | Short, captioned, transcribed, and built around a realistic demonstration |
| Practical materials | 2 | Web version; optional accessible PDF |
| Collections | 3 | References to existing resources, without counting content twice |
| Active poll | 1 | A known owner and a plan for publishing the decision |

The target is **42 standalone resources + 3 collections**, not 45 entirely different topics. The minimum content release threshold is 30 approved standalone resources, six meaningful categories, and three useful collections. Prove technical support for each format with a synthetic example and at least one real approved resource of that type. If content falls short, reduce the publicly visible category count and explicitly revise the pilot goal; do not fill gaps with generic copy.

### 16.2. Roles and cadence

| Responsibility | Pilot obligation |
| --- | --- |
| Product/content owner | User promise, priorities, taxonomy, and approved publishing plan |
| Editor | Article preparation, language quality, media, accessibility, and regular refresh |
| Professional reviewers | Review the relevant discipline and confirm suitability for general education |
| Publisher | Audience, scheduling, final checks, and urgent withdrawal |
| Intake professional + backup | Private questions and free text; daily queue review and responses within target |
| Client success | Campaign proposals and privacy-safe company aggregates, without original employee messages |

Weekly: short priority planning, review of new requests, overdue checks, and publication preparation. Monthly: close the poll, publish "You asked - we prepared," review usefulness, and check the next month's offering. Every 90 days: review taxonomy and the portfolio, withdrawing content that is no longer accurate or useful.

### 16.3. Maintaining quality

For general education, proposed regular professional review is every six to twelve months. Material dependent on regulations, market conditions, or specific recommendations should be reviewed at least every three months or sooner when an event requires it. Reviewers can set shorter periods. Once review expires, potentially changing professional claims leave promotion and are temporarily withdrawn according to policy; evergreen platform instructions may follow another regime.

Media-license changes, consent withdrawal, or an inaccuracy report can immediately end availability without waiting for a scheduled cycle. Owners see the collections and Home slots depending on the item.

### 16.4. Content and support capacity

A rough planning assumption for the first 42 resources is 85 hours of core production: 24 articles x 2 h, 8 Q&A x 0.75 h, 4 audio x 3 h, 4 video x 4 h, and 2 practical materials x 1.5 h. Adding professional review, language editing, rights, and entry gives approximately **120-170 working hours** for one language. This is not a professional video-production timeline; new recordings, special licenses, and translations can materially increase the work.

A sustainable initial monthly cadence might be four articles, two Q&A, two short audio/video resources, and one new or refreshed collection. Adjust it to actual demand. Translation is not a "free button"; professional and language review need separate planning.

For questions, use the capacity formula: **new questions x average triage, response, and review time + clarification and absence coverage**. For example, ten questions per week x 25 minutes is approximately 4.2 hours of professional work before additional review and backup coverage. Real weekly capacity must exist before the service is sold or the form opens.

## 17. Technical approach: a thin domain CMS in the existing platform

### 17.1. Proposed architecture

Retain the modular NestJS backend, PostgreSQL/Prisma, existing server-side sessions and grants, Valkey for caches/jobs, and private S3 media, consistent with the authentication strategy. Employee and admin surfaces communicate with our API. This epic adds domain modules, not another identity platform.

| Module | Data ownership |
| --- | --- |
| Content | Resources, revisions, translations, publications, taxonomy, collections, and Home slots |
| Media | Rights, processing, availability, technical metadata, and authorized delivery |
| Engagement | Private saved items, preferences, usefulness, poll definitions/votes, and own status |
| Editorial demand | Sanitized briefs, decisions, tasks, and resource links |
| Restricted intake | Original free text, general questions, private answers, assignments, and permission for derived publication |
| Notifications/reporting | Neutral delivery, aggregations, and privacy protections; no copy of restricted content |

A structured editorial model and an existing editor provide a small purpose-built CMS in our admin, replacing the need for a general page builder. The authentication document remains the source for sessions, step-up, network, regions, and baseline deployment. No hosting configuration by itself establishes legal compliance.

### 17.2. Why this choice, and when to use a headless CMS

| Option | Advantage | NestSelf cost/risk | Recommendation |
| --- | --- | --- | --- |
| Our structured admin + an existing editor | One authentication and authorization system; exactly the same workflow and scope as the platform | We maintain revisions, review, scheduling, and forms | Default V1 choice with a small number of resource types and slots |
| Self-hosted headless CMS, such as Payload | Existing editorial capabilities and a configurable model | Must prove session, grant, preview, audience, and audit integration; another runtime increases maintenance | Consider a limited spike if the team already knows it or editorial UI requirements grow |
| Hosted editorial SaaS | Fast editing and less infrastructure | Additional vendor, data processing, access adapter, cost, and potential regional constraints | Possible for approved public content after separate assessment; employee interactions remain in the application |

Payload documents custom authentication strategies and configurable access control. Integration is possible; this does not mean it automatically shares our sessions and grants. [R11] No selected CMS receives employee poll responses, private messages, or budgets.

Before M1, run a spike of no more than two days only if there is a real candidate and someone familiar with it. Prove a staff session, central scope, revision/review, language variant, preview, and private asset. If this does not save enough total work, retain the thin internal module. Record the choice as an ADR instead of opening a multiweek tool-selection project.

### 17.3. Media and access revocation

Uploads enter private quarantine. Before `ready`, validate file type, size, and actual content, remove unwanted metadata, and check files according to the adopted upload process. Limit allowed types; SVG, HTML, and executables are not employee upload formats in this epic. The CMS uses controlled photographs, audio, video, and PDF.

For V1, deliver protected media through an authorized API/BFF path supporting Range and checking every new request. Private content has no public S3 URL or shared public cache. Publishing a reference does not change the object's access rights. A cover image may use public caching only when explicitly safe and licensed for that use.

Introducing CloudFront signed URLs or cookies for video throughput requires an explicit decision: already issued access has its own expiry and does not check our grant for every byte. AWS documents expiration checks at request time and the behavior of downloads already in progress. [R12] Do not promise immediate revocation of already delivered bytes or a downloaded PDF. A move to signed delivery needs an agreed short TTL, tests, and an updated revocation model; it must not silently weaken authentication expectations.

### 17.4. Caches, jobs, and reliability

Cache keys include audience/tenant context, language, and availability version. Personalized responses never use a shared public cache. Grant, membership, publication, or asset-right changes invalidate the relevant cache. Direct URL responses always recheck access.

Publication commands, poll writes, request submission, and work closure have idempotency protection. A database transaction writes state changes and an outbox event. Workers deduplicate notification and indexing work; retries cannot create another publication, response, or notification. Scheduled jobs check current state rather than assuming the original permission remains valid.

## 18. Data model and key invariants

### 18.1. Domain records

| Entity | Important fields and relationships |
| --- | --- |
| `ContentResource` | ID, type, owner, primary category, status, schema version |
| `ContentVariant` | Resource + locale, slug, local applicability; unique resource/locale combination |
| `ContentRevision` | Variant, JSON body, metadata, source references, author, revision number, review evidence |
| `Publication` | Approved revision, audience policy/version, entitlement reference, UTC validity windows, state |
| `Category`, `Topic`, `Need` | Controlled values, translated labels, synonyms, legacy-slug redirects |
| `CollectionEntry` | Parent resource, child resource, order, optional instruction; cycles forbidden |
| `MediaAsset` | Storage reference, checksum, type, status, rights, expiry, available alternatives |
| `HomeSlot` | Predefined slot type, scope, locale, priority, validity |
| `SavedItem`, `PlaybackState` | Person/membership context + resource; private data and deletion support |
| `PollDefinition`, `PollInstance` | Question/options, language, audience snapshot, validity, purpose, decision owner |
| `PollResponse` | Instance, respondent pseudonym, optional choice value, update timestamp; no name or raw text |
| `ResourceFeedback` | Resource/revision, usefulness, allowed reason code; per-context pseudonym, no public profile |
| `EditorialRequest` | Type, operational status, safe IDs, owner, next action, due date, outcome |
| `EditorialBrief` | Sanitized topic, work description, priority, links to planned resources |
| `RestrictedSubmission`, `PrivateReply` | Original, participant, active assignment, purpose, private answer, retention class |
| `PublicationPermission` | Exact generalized version, audience, employee decision, timestamp; restricted link |
| `AuditEvent`, `OutboxEvent` | Action, principal/context, safe resource references, version, delivery/dedupe state |

Publication does not copy private employee data into content tables. A brief has no implicit lookup that lets an ordinary CMS user open the original. A global resource and its company-specific availability are separate records.

### 18.2. Invariants development must preserve

1. Only an approved revision can be published; every relevant change invalidates approval.
2. Assets, preview, search, recommendations, and direct URLs use the same effective availability decision.
3. A collection cannot broaden access to a child resource; publishing a child does not automatically publish its parent.
4. A person in two organizations has no merged employee interactions across them.
5. A poll has no more than one current response per participant key; repeating a call does not change the participant count.
6. Raw employee text has no path through generic CMS endpoints, reports, or exports.
7. An active request always has an owner or a clearly defined staffed fallback queue; reassignment does not erase the deadline.
8. A `fulfilled` reference is delivered only if accessible to the sender; otherwise the request needs another legitimate closing action.
9. Content grants cannot let an editor expand their publishing scope or create benefits.
10. An operational retry is not a new business decision and cannot duplicate a message, vote, or publication.

### 18.3. Minimal read model

The employee API returns only an authorized publication: `id`, locale, title, summary, outcome, format, duration, category, approved media references, reviewedAt, available CTAs, and the employee's own bookmark. It does not return draft IDs, review comments, other audiences, private source-submission IDs, or unpublished translations. Admin and employee DTOs are separate.

## 19. API contracts, events, and analytics

### 19.1. Proposed endpoint groups

These routes are planning contracts, not a claim that they already exist in code. All state-changing web commands use CSRF protection consistent with the cookie model, validated payloads, and server-resolved context.

| Group | Example contract | Control |
| --- | --- | --- |
| Home/discovery | `GET /api/employee/home`, `/content`, `/categories`, `/collections/:id` | Active membership + available publication |
| Search | `GET /api/employee/search` | Filter before results and facets; no raw-query analytics |
| Content detail | `GET /api/employee/content/:id` | Same eligibility check as lists; allowed locale |
| Personal state | `PUT/DELETE /api/employee/saved/:id`, `/preferences` | Own membership context only |
| Feedback | `PUT /api/employee/content/:id/feedback` | Available resource, controlled vocabulary, spam prevention |
| Poll | `GET /api/employee/polls`, `PUT/DELETE /polls/:id/response` | Snapshot eligibility, active membership, validity, unique participant |
| Request | `POST /api/employee/editorial-requests`, `GET /:id`, `POST /:id/withdraw` | Own request; original text in restricted storage |
| General question | `POST /api/employee/general-questions`, `GET /:id/reply` | Participant path in the restricted module |
| CMS | `/api/admin/content`, `/revisions`, `/submit-review`, `/approve` | Separate create/edit/review actions and scope |
| Publication | `/api/admin/publications`, `/schedule`, `/withdraw` | Publisher grant, approved revision, audience |
| Media | `/api/admin/media/uploads`, `/api/employee/media/:id` | Allowed upload + authorized delivery; no open storage URL |
| Work queue | `/api/admin/editorial-demand`, `/assign`, `/transition` | Safe metadata and sanitized briefs only |
| Restricted work | `/api/intake/assignments`, `/claim`, `/read`, `/reply` | Professional assignment, purpose, step-up, audit under authentication rules |
| Report | `/api/admin/content-metrics`, `/api/org/program-summary` | Separate read models and central suppression logic |

### 19.2. Events and idempotency

Business events: `content.review_requested`, `content.approved`, `publication.started`, `publication.withdrawn`, `media.expired`, `poll.closed`, `editorial_request.submitted`, `editorial_request.overdue`, `editorial_request.fulfilled`, `general_question.reply_ready`.

Events carry an ID, tenant/context where required, actor/system provenance, version, and safe references. They do not contain question or answer bodies. Before sending a notification, consumers check current membership, purpose, preferences, and target visibility. Failed delivery has a retry limit and an operational recovery queue.

In V1, the employee request page refreshes status on opening, regaining focus, and selecting "Refresh." While active, it may use discreet HTTP polling every 30-60 seconds with backoff and suspension in the background. Server state remains authoritative, and each fetch rechecks access. New real-time infrastructure is not required to close the epic. This technical polling is separate from the surveys and voting in Chapter 11.

### 19.3. Metrics that are actually useful

| Metric | Definition | Interpretation |
| --- | --- | --- |
| Activation | Activated eligible users / invited eligible users in the same period | Measures onboarding, not content quality |
| First useful action | Users saving a resource, explicitly rating usefulness, trying a practical step, or reaching meaningful consumption / activated eligible users | Content-product activation; keep the definition stable during comparisons |
| Meaningful consumption | Article/Q&A: at least 30 seconds of active display and at least 50% of content; audio/video: at least 50% watched/listened | An approximate attention signal, not proof that content helped |
| Usefulness | "Yes" responses / all yes/partly/no responses; show voluntary response count in permitted aggregates | Selection bias; not a representative study of all users |
| Search without results | Searches with no accessible result / all searches | Missing content or synonyms; raw queries do not enter analytics |
| Request loop closure | Requests receiving an answer/explanation within target, and requests actually fulfilled / relevant submissions | Distinguish a good response from producing a new resource |
| Q&A response time | Median and P90 business time from submission to first professional answer | Measures queue service, not clinical quality |
| Freshness | Active resources with valid review and rights / all active resources | Content we can responsibly offer |

Meaningful-consumption tracking does not collect raw mouse positions, screenshots, or a full browsing timeline. The client sends minimal milestone signals that the server deduplicates. Users can access content without a longitudinal personal profile. Editorial insights use aggregates; private playback state remains separate.

### 19.4. Pilot hypotheses

For the first four weeks, working targets could be: at least half of activated users open one resource; at least one-third take a defined useful action; at least 70% of voluntary usefulness respondents select "yes"; at least 90% of requests receive a meaningful decision/status within target; and 100% of active resources have an owner and valid rights. These are **learning hypotheses**, not industry benchmarks or contractual commitments.

Interpret results alongside absolute counts, invitation volume, and the initial portfolio. Small cohorts can produce unstable percentages and must remain suppressed in company reporting. Do not derive ROI, reduced sick leave, or therapeutic outcomes from clicks and views.

## 20. Epic charter and business exit criteria

### 20.1. Epic `NS-CONTENT-01`

**Problem:** after signing in, employees need immediate real value, while NestSelf needs to maintain the offering without a developer for every publication. Interests and questions currently lack a defined feedback loop.

**Outcome:** the editorial team independently publishes and maintains authorized content; employees find it by need, use it on phones, save it, and provide feedback; topic suggestions and general questions reach an operational outcome.

**Product owner:** NestSelf product/content owner. **Technical owner:** platform tech lead. **Operational owner:** editorial lead, with a named professional intake owner and backup. One person may cover several responsibilities; permissions and professional reviews remain separate.

### 20.2. In scope

Admin authoring/review/publishing; media and rights; six initial categories; six basic resource types; separate language variants; audiences and package capabilities; employee Home/Explore/search/detail; saved items; optional preferences and playback position; usefulness feedback; interest polls; editorial requests with status and closure; curated Q&A and moderated general questions; neutral notifications; minimal privacy-safe aggregates; audit, retention, and necessary operational recovery.

### 20.3. Out of scope

New authentication mechanisms, SCIM, native mobile; a general page builder; an open forum and peer chat; an AI adviser or personalization from sensitive history; clinical assessment; live-video infrastructure; event capacity, registration, and attendance; financial wallets, invoicing, and budget approvals; a supplier marketplace; a full LMS, certificates, or compulsory training; independent HR editing of professional content; public marketing CMS delivery.

These implementation boundaries preserve room for future modules. Domain references and typed CTAs support expansion without presenting unfinished functionality as available.

### 20.4. Business exit

1. Editors and reviewers can prepare, review, publish, correct, and withdraw content without SQL or developers.
2. Employees on phones reach a useful resource through a few clear choices and know who reviewed it.
3. Other clients' content, drafts, and private employee data cannot leak through UI, API, media, search, exports, or logs.
4. One real poll has opened, closed, and received an editorial outcome; at least one request is fulfilled and another closed with a reason.
5. One general question has been assigned, professionally answered, and delivered to its sender, with proof that ordinary CMS and employer accounts cannot see the original.
6. Initial published content, professional capacity, and operational calendars are ready. A technically successful empty library is not a completed pilot.

## 21. Development backlog

Every M1-M4 item is V1/P0 for closing this epic. Milestones define delivery order, not permission to permanently skip later items. Subsequent P1/P2 candidates are separate in Section 21.8.

### 21.1. Foundation and access

| ID / delivery | User story | Acceptance criteria |
| --- | --- | --- |
| FND-01 / M1 | As the platform, I distinguish editorial, personal, and restricted data. | Employee DTOs contain no draft/restricted references; two-tenant fixtures pass negative scenarios; raw submissions have no generic CMS read path. |
| FND-02 / M1 | As an owner, I assign content privileges through grants. | Authors can edit without publishing; publishers act only within scope; audience simulation does not read real personal state; all routes use central authorization. |
| FND-03 / M1 | As an editor, I add media delivered only to its authorized audience. | Unapproved uploads are unavailable; type/size/rights are checked; unauthorized direct URLs and new Range requests are denied; expiry removes availability. |
| FND-04 / M1 | As a development team, we have a stable content format and renderer. | Supported blocks have a schema version; the server rejects disallowed blocks/URLs; XSS payloads cannot execute; media have text alternatives. |

### 21.2. Editorial CMS

| ID / delivery | User story | Acceptance criteria |
| --- | --- | --- |
| EDT-01 / M1 | As an author, I prepare and preview an article. | Required metadata and audience validate; preview matches employee rendering at different widths; autosave cannot silently overwrite another person's newer change. |
| EDT-02 / M2 | As a professional reviewer, I approve an exact revision. | Changes after approval require review again; return comments are visible to authors; expertise and required independence are checked. |
| EDT-03 / M2 | As a publisher, I schedule, correct, and withdraw content. | The previous live revision remains until the new one is approved; scheduling/expiry tolerate retries; jobs with revoked grants cannot publish; withdrawal prevents new access. |
| EDT-04 / M2 | As a taxonomy owner, I maintain categories, topics, and languages. | Merged topics do not duplicate content; legacy slugs redirect safely; each language version has its own review; empty categories are not promoted. |
| EDT-05 / M2 | As a publisher, I curate collections and Home slots. | No cycles; stable ordering; child availability is checked; slots cannot bypass entitlement or repeat the same resource on Home. |
| EDT-06 / M4 | As a content owner, I know what needs review or withdrawal. | Dashboard shows due reviews and expiring rights; asset changes identify dependent resources; owner and backup receive tasks; audit preserves decisions. |

For the M1 demonstration, EDT-01 includes minimal publication of one reviewed synthetic item through a publisher command. The complete EDT-02/03 review/scheduling workflow is required before the V1 pilot uses real professional content.

### 21.3. Employee experience

| ID / delivery | User story | Acceptance criteria |
| --- | --- | --- |
| EMP-C01 / M1 | As an employee, I see a useful Home after sign-in. | Current context is displayed; an available resource states its outcome/duration; switching organizations removes previous cards; unavailable modules do not appear as empty sections. |
| EMP-C02 / M2 | As an employee, I explore needs and categories. | Six pilot categories contain meaningful content; filters compose correctly; returning from detail preserves selections; unavailable items do not enter result counts. |
| EMP-C03 / M2 | As an employee, I find content using everyday language. | Tests cover Latin/Cyrillic script and diacritics; snippets/facets do not reveal drafts or another tenant; no-results allows suggestions without automatically submitting the query. |
| EMP-C04 / M1 | As an employee, I use content detail on my phone. | Text, attribution, and alternatives are readable; video does not start with sound; CTAs are valid actions only; failed media offer a transcript and recovery. |
| EMP-C05 / M1 | As an employee, I save and remove content. | Repeated saves do not duplicate items; other users have no access; tenant contexts remain separate; archived resources show a neutral unavailable state. |
| EMP-C06 / M2 | As an employee, I choose interests and language. | Skipping does not restrict content; choices can be deleted; no silent language fallback; disabling history stops creation of a playback profile. |

### 21.4. Feedback and polls

| ID / delivery | User story | Acceptance criteria |
| --- | --- | --- |
| ENG-01 / M3 | As an employee, I rate usefulness without a public profile. | Own responses can be changed; reasons use controlled labels; individual feedback is absent from employer exports; unavailable resources do not accept new feedback. |
| ENG-02 / M3 | As an editor, I create a brief poll with a clear purpose. | Question, options, decision owner, audience, and validity are required; options lock after the first response; this flow does not accept a health-assessment type. |
| ENG-03 / M3 | As an employee, I vote and change my choice before closing. | One current response per key; concurrent/retry calls do not duplicate it; expired or revoked contexts are denied; the UI does not promise complete anonymity. |
| ENG-04 / M3 | As an editor, I close a poll and publish the next step. | Small-cohort distributions are suppressed; HR has no individual answers; the decision can link an accessible resource; no false event registration is created. |

### 21.5. Content requests

| ID / delivery | User story | Acceptance criteria |
| --- | --- | --- |
| REQ-01 / M3 | As an employee, I suggest a topic, format, or translation. | Structured input is sufficient; free text goes to restricted storage; the summary identifies what is sent and to whom; retry creates one request. |
| REQ-02 / M3 | As an editor, I work from a safe brief and next action. | Queue excludes original bodies; assignment has owner/backup; every active record has a due date; status transitions are controlled. |
| REQ-03 / M3 | As an employee, I track and clarify my request. | Only own requests are visible; status explains the actual next action; clarification is available only to assigned intake; withdrawal stops further editorial work apart from necessary records. |
| REQ-04 / M3 | As an owner, I complete the request and close the loop. | Completion requires an outcome or reason; links are accessible to the sender; multiple requests can share a brief without exposing authors; overdue and notification failures have recovery paths. |

### 21.6. Q&A and professional intake

| ID / delivery | User story | Acceptance criteria |
| --- | --- | --- |
| QA-01 / M2 | As an employee, I read specific general answers. | Q&A is a complete resource with category/language; answers have professional attribution and review; search and related links use the same access rules. |
| QA-02 / M4 | As an employee, I submit a general question to a controlled queue. | Form explains purpose, recipient, and response expectation; no attachments; original is restricted; ordinary admins and HR have no read path even with a known ID. |
| QA-03 / M4 | As an assigned professional, I answer and request clarification. | Claims are concurrency-safe; assignment/step-up are checked on read/reply; absence is rerouted; private answers are visible only to the participant and appropriate professional assignment. |
| QA-04 / M4 | As an employee, I choose whether a specific generalized version may be published. | Default is no publication; exact text and audience are shown; the raw original is not a CMS field; withdrawing permission triggers review of the derived publication. |

### 21.7. Operations and release

| ID / delivery | User story | Acceptance criteria |
| --- | --- | --- |
| OPS-C01 / M4 | As a product owner, I measure usefulness and quality without exposing people. | Denominator definitions are stable; k=9 suppresses and k=10 checks the allowed aggregate; complementary-total/filter-leak tests pass; employers have no named drilldown. |
| OPS-C02 / M3-M4 | As a user, I receive neutral updates about my request. | Subject excludes question/topic; links recheck access; promotional opt-out works; retries do not duplicate; failed delivery is operationally visible. |
| OPS-C03 / M4 | As a user and platform, we control private state and retention. | History deletion works in active storage; poll/raw-submission retention jobs have verified outcomes; indexes/caches are cleared; deactivation does not arbitrarily delete professional records. |
| OPS-C04 / M4 | As a release owner, I launch a complete flow the team can operate. | Chapter 23 scenario passes; runbook, seed content, and named owners exist; rollback and job recovery are verified; no critical access/privacy defects remain open. |

### 21.8. P1 and P2 backlog

| Priority | Candidate | Inclusion trigger |
| --- | --- | --- |
| P1 | HR proposals to feature approved content | Multiple clients regularly request a local activation plan |
| P1 | Editorial bulk import and improved translation coordination | Manual entry becomes a measurable bottleneck |
| P1 | Additional language versions of audio/video | Contracted language scope and production budget exist |
| P1 | Private exercise journal or program progress | Clear employee need and a separate privacy decision |
| P1 | Knowledge checks without individual employer scores | Quality programs and a professional question editor exist |
| P2 | Wellbeing pulse and personal check-ins | Professionally validated method, clear data ownership, complete response model |
| P2 | Open community and peer support | Required moderation capacity and a separate product assessment exist |
| P2 | Advanced recommendation engine | Catalog scale and measured benefit justify another system |

## 22. Implementation sequence and estimate

### 22.1. Milestone plan

| Milestone | Approximate period | Delivery | Review evidence |
| --- | --- | --- | --- |
| M1 | Weeks 1-2 | Domain boundaries, grants, minimal editor, article, private asset, employee detail, bookmark | Admin publishes synthetic content; Employee A can access it; Employee B outside its audience cannot access even the asset |
| M2 | Weeks 3-4 | Full review/publishing, categories, languages, Home, collections, all formats, search | Published revision stays live during review of the new one; languages and audiences work on phones |
| M3 | Weeks 5-6 | Feedback, polls, requests, next-action queue, notifications | One poll reaches an editorial outcome; one request links an available resource; another closes with a reason |
| M4 | Weeks 7-8 | Restricted general questions, derived-Q&A publication permission, metrics, retention, operational controls, pilot | Professional answer without admin/HR leakage, plus the complete acceptance scenario |
| Contingency/pilot | Up to Week 9 as needed | Observed issues, accessibility, content, operational adjustments | Concrete evidence of readiness for real users |

The M1 demonstration target is five to ten business days after authentication handoff, depending on existing components and media delivery readiness. A demonstration is not a shortcut to production publication of unreviewed professional content.

### 22.2. Working estimate for two engineers

| Workstream | Engineering working days |
| --- | --- |
| Model, grant integration, media, validated schema/renderer | 7-9 |
| Editorial admin, revisions, review, scheduling, taxonomy, collections | 10-12 |
| Employee Home, browse, search, detail, private state | 10-13 |
| Usefulness feedback and interest polls | 5-6 |
| Editorial requests and operational queue | 5-6 |
| Moderated general questions and publication permission | 6-8 |
| Telemetry, privacy controls, integration verification, runbook | 7-9 |
| Total before contingency | 50-63 |
| With approximately 20% contingency | 60-76 |

This represents approximately six to eight full working weeks for two engineers, and **roughly seven to nine calendar weeks** including pilot stabilization. It assumes both engineers can spend most of their time on this epic. Significant other commitments reduce capacity and require the schedule to be recalculated; contingency is not a substitute for availability.

Product decisions, approximately five to eight designer days across early phases, Chapter 16 content production, professional review, and targeted QA time are also required. These are not additional engineers included in the table. Multilingual localization of the entire starter portfolio and professional media production are estimated separately.

### 22.3. Work allocation

Engineer A leads the domain model, authorization integration, publication rules, engagement API, restricted assignments, and jobs. Engineer B leads the admin editor, employee screens, accessibility, media controls, and operational queue views. Both review access boundaries, logged data, and UI/API contracts together.

Start design, content production, and starter-portfolio review alongside M1. The main risk is not development alone: a completed CMS without good initial resources and a staffed intake queue will not demonstrate product value.

### 22.4. If an earlier demonstration is needed

M1 is the minimum proof: one content language, two clients in synthetic data, one article and media asset, central grants, employee rendering, and a bookmark. M2 provides a library people can already use. Polls, requests, and Q&A remain part of the agreed V1 epic. Any earlier limited pilot explicitly records which parts are not open and is not described as complete V1 delivery.

## 23. Testing and acceptance scenario

### 23.1. Synthetic acceptance dataset

Prepare Organization A with 30 and B with 12 synthetic employees, multiple teams, and at least one person with two active memberships. Add an author, publisher, professional reviewer, intake professional and backup, HR user, and ordinary support account. Include global, tenant-only, unit-only, future, expired, and draft content, plus language variants.

Test views with nine and ten relevant participants within a fixed monthly window. Employee headcount and participating-user count must not accidentally become the same metric.

### 23.2. End-to-end demonstration

1. The author creates an article and audio with a Serbian transcript, adds a category and Audience A, and submits for review.
2. Employees A and B try to open a known draft ID and asset: access is denied.
3. The reviewer returns the article for changes; the publisher cannot publish an unapproved revision.
4. After professional approval, the publisher publishes for A. Employee A finds it by need, category, and search, listens, and saves it.
5. Employee B receives no title, snippet, facet count, or media. The person with two memberships switches context and sees no A state in B.
6. The author edits the article; employees continue seeing the previous approved revision. The new version appears only after approval again.
7. Employee A votes. Concurrent retries do not increase response counts; a closed poll rejects a late write.
8. The editor closes the poll and links a new collection; small cohorts have no option distribution, including on ordinary internal dashboards.
9. Employee A suggests a translation and submits a general question. Ordinary CMS and HR accounts cannot read the original, including through exports or direct APIs.
10. Assigned intake reads the question after the required session check, receives clarification, and delivers a professional general answer.
11. The employee declines publication of the generalized version: their answer remains available, and no CMS derivative is published. A separate permitted example completes the publication flow.
12. The request reaches an outcome; an intentionally failed notification retries without duplicating the business outcome and has a visible recovery owner.
13. The publisher withdraws a problematic resource. It disappears from Home/search; its bookmark shows a neutral unavailable state, and its collection is reassessed.
14. An HR report with k=9 remains suppressed; k=10 returns only allowed aggregates; complementary totals and repeated filters cannot reveal a small group.
15. The employee deletes private history and loses membership. New requests and media access are denied; approved retention processes preserve only what is required.

### 23.3. Important negative and boundary cases

| Area | Check |
| --- | --- |
| Tenant/scope | Alter IDs in URLs, request bodies, asset links, collections, and exports; list and direct-read access outcomes agree |
| Publication race | Editing during approval; two concurrent publications; worker retry after withdrawal or grant revocation |
| Cache | Switching organizations, changing audiences, and withdrawing content cannot return prior responses from shared caches |
| Time | Identical publication/expiry seconds, session expiry during input, time zones, repeated/nonexistent daylight-saving hours |
| Poll | Two simultaneous responses from one person, option changes after the first vote, concurrent closing/submission, deactivation during a campaign |
| Restricted access | A known submission ID does not help an admin; reassignment removes the former handler's read path; queue logs and error payloads exclude originals |
| Q&A publication | Declined or withdrawn permission, text changed after permission, a uniquely identifying detail in the generalized version |
| Media | Wrong type/checksum, oversized upload, disguised PDF/SVG, expired rights, unauthorized Range requests, cached old links |
| Accessibility | Keyboard access, visible focus, screen-reader labels, contrast, zoom, captions/transcripts, reduced motion |

### 23.4. Technical definition of done

- Relevant unit/integration and end-to-end checks cover business boundaries, concurrent writes, and denied access, not only successful UI navigation.
- The central route/default-deny test and access golden table from the authentication foundation include new actions and resource types.
- Staging has repeatable acceptance fixtures and a job/notification recovery scenario.
- API/read models are documented; migrations have a safe deployment and rollback approach; fixtures do not contain real users' raw private data.
- Indicative performance target: P95 below 500 ms for ordinary list/detail APIs using a representative pilot dataset and agreed load, initially 100 concurrent sessions. Measure video transfer separately.
- Mobile target: a readable responsive interface without disruptive layout shifts; aim for LCP around 2.5 seconds on the agreed test connection. These are targets to verify, not measured results already achieved.
- Content release thresholds, professional reviews, rights expiry, and applicable privacy conditions have owners and completion evidence.

## 24. Working decisions, risks, and a concrete starting point

### 24.1. Decisions this proposal already makes

| ID | Default decision | Change if |
| --- | --- | --- |
| D-C01 | Content epic precedes the first consultation | The pilot already has an operationally ready service blocked by content delivery |
| D-C02 | Thin CMS in our admin with an existing rich-text editor | A short proven headless spike materially reduces total work without a second policy system |
| D-C03 | Six categories and a small number of quality formats | Actual starter content requires a smaller earlier limited pilot |
| D-C04 | Six resource types; collections are simple sequences | A specific need exists for an LMS or structured program |
| D-C05 | Polling starts with interests and usefulness | A separate professional wellbeing-measurement product is approved |
| D-C06 | No public individual answers or employee comments | Separate operational coverage exists for a community product |
| D-C07 | General questions use professional restricted intake | Capacity is unavailable; submission remains closed until it is provided |
| D-C08 | Published Q&A derivatives require review and permission for the exact version | Privacy review requires a stricter procedure; never automatic publication of originals |
| D-C09 | HR does not publish professional content in V1 | V1.1 introduces controlled proposals/promotion with the same scope boundaries |
| D-C10 | Employer employee-usage reporting is broad, monthly, and protected with k=10 | The responsible privacy function approves another safe model |
| D-C11 | UI is locale-ready; actual translation follows pilot scope | A client requires a broader initial language portfolio and production plan |
| D-C12 | Protected media API checks every new request | An explicitly approved signed-delivery model has an accepted revocation window |

These assumptions allow the model and first synthetic flow to develop without waiting for every future commercial decision. Before the real pilot, confirm practical details: who responds, in which languages, against which calendar, using which content, and under which adopted retention/privacy policy.

### 24.2. Main risks and responses

| Risk | Early warning | Response |
| --- | --- | --- |
| Library remains generic | Views without saves, usefulness, or return visits | Specific outcomes, local examples, and conversations with voluntary pilot users |
| CMS consumes the first development quarter | Growing blocks, page types, and exceptions | Lock V1 resource types and Home slots; move everything else to a separate backlog |
| Requests accumulate | Missing owners and repeatedly moving deadlines | Capacity review, honest explanations, staffed fallback; no false closure |
| Questions turn into therapy chat | Long personal conversations in general Q&A | Clear boundaries, limited clarifications, and a real consultation flow when available |
| Employees lose trust in privacy | Unclear question visibility or a client requesting named reporting | Accurate concise UI copy, actual server-side prohibitions, no named drilldown |
| Media increases maintenance/cost substantially | Large files, poor playback, repeated rights incidents | Initial limits, transcripts, transfer measurement, controlled later delivery choice |
| Publications become outdated | Missed reviews and expired media licenses | Owners, due dashboard, reconciliation, explicit automatic withdrawal policy |
| Multiple languages slow the portfolio | Translated UI without enough actual content | Contracted pilot languages, separate localization estimates, no silent fallback |

### 24.3. First ten concrete tasks

1. Record an ADR for the CMS boundary, editor choice, and separation of restricted submissions.
2. Create synthetic users, two clients, employee/admin contexts, and negative grant scenarios.
3. Define `ContentResource`, variant, revision, publication, and media schemas with required fields.
4. Extend the central action catalog and test table; prove an author without publishing rights.
5. Implement one approved content renderer and private media delivery path.
6. Build an admin article form and employee preview using the same renderer.
7. Add a minimal publisher command and employee list/detail endpoints using identical availability logic.
8. Build Home, cards, detail, and bookmarks on mobile; verify context switching.
9. Demonstrate drafts, an available resource, denied direct URLs, revision changes, and withdrawal.
10. Use the demonstration to finalize M2 design and continue through the backlog while the editor builds the starter portfolio in parallel.

### 24.4. Artifacts development should produce

Implementation should include a short ADR, updated permission/action catalog, API/read-model contract, content-schema documentation, repeatable synthetic seed, publication and intake runbooks, a retention-job specification, and an acceptance-verification record. These are expected epic outputs; this plan does not claim those files already exist in the repository.

## 25. Sources, decision provenance, and alignment

### 25.1. Attached project foundations

**P1 - NestSelf_Product_Flows_and_User_Stories_v0.1.md**, 21 October 2026, attached copy. Inherited foundations: the four-workspace model, CMS/operations boundary, permission grants and scope, employee confidentiality, content flow F1, and initial CMS/EMP stories. New work expands content delivery, polling, editorial requests, and moderated Q&A.

**P2 - auth-strategy.pdf**, version 1.0, 21 October 2026, 18 pages, draft for founder review. Inherited foundations: Cognito identity; database-owned NestSelf authorization; web cookie/BFF model; a single decision function; employee/organization contexts; restricted-domain boundary; baseline AWS stack; default k=10 with more fixed time windows; localized sign-in. This plan does not independently validate pricing, library versions, or legal claims in the authentication document.

### 25.2. External sources

All pages are official sources reviewed on 22 October 2026. Descriptions are summarized; product decisions in earlier chapters are NestSelf proposals.

- **R1 - Mindgram, Homepage.** Combining content, workshops, and professional services; available professional disciplines. https://mindgram.com/en/
- **R2 - Mindgram, How it works.** Public description of educational workshops, podcasts, and professional support. https://mindgram.com/en/how-it-works/
- **R3 - Unmind, Content and Courses.** Short practical content and thematic areas. https://unmind.com/content-and-courses
- **R4 - Modern Health, Member experience.** Different support modalities and connected resources. https://www.modernhealth.com/member
- **R5 - Modern Health, Introducing On-Demand Circles.** Professionally led group sessions and recorded-format availability. The page has a more recent update date, while parts describe earlier product development; this is not treated as a feature launched today. https://www.modernhealth.com/post/introducing-modern-health-on-demand-circles
- **R6 - Spill, Ask a therapist.** Public employee Q&A organized by specific topics. https://www.spill.chat/questions
- **R7 - nilo, How it works.** Interactive self-guided resources, roundtables, professional support, HR overview. https://nilohealth.com/how-it-works/
- **R8 - Workleap, Officevibe & anonymity.** Different protections for aggregate results and written answers. Officevibe's specific thresholds are not equated with NestSelf defaults. https://help.workleap.com/en/articles/10281766-workleap-officevibe-anonymity
- **R9 - Togetherall, About Togetherall.** Community, self-guided resources, continuous professional moderation. https://togetherall.com/en-us/faqs/about-togetherall/
- **R10 - Tiptap, Output and content handling.** JSON/HTML storage and rendering documentation. Our server-side validation and security boundaries are additional implementation requirements. https://tiptap.dev/docs/guides/output-json-html
- **R11 - Payload, Custom strategies; Access control.** Configurable authentication and access enable integration; they do not automatically satisfy NestSelf's grant model. https://payloadcms.com/docs/authentication/custom-strategies ; https://payloadcms.com/docs/access-control/overview
- **R12 - AWS, CloudFront signed URLs.** Validity windows and checks when downloading private objects. https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html
- **R13 - Unmind, Insights & Assessments.** A separately developed product for personal and organizational wellbeing insights; a reason to separate that scope from simple interest polls. https://unmind.com/insights-and-assessments

### 25.3. Traceability to previous stories

| Previous ID | This plan | Status |
| --- | --- | --- |
| CMS-01 / CMS-02 | FND-03/04, EDT-01, EDT-04 | Detailed content contract, accessibility, preview |
| CMS-03 / CMS-05 | EDT-02/03/06 | Revisions, independent review, publishing, withdrawal, maintenance |
| CMS-04 / SYS-01 / SYS-06 | FND-01/02/03, Chapters 10 and 15 | Same rules for API, search, media, logs, restricted data |
| CMS-06 / EVT-01 / EMP-11 | Content/replay contract and the next event epic | Announcements and interest here; actual registration and event delivery later |
| EMP-02 | EMP-C01 through EMP-C06 | Home, browse, search, detail, private saved items |
| EMP-12 / SYS-03 / SYS-05 | ENG/REQ/QA, OPS-C02 | Preferences, feedback, controlled requests, neutral notifications, retries |
| ORG-06 / OPS-05 | V1 publisher promotion; V1.1 HR proposal; OPS-C01 | Limited activation and privacy-safe aggregates |
| SYS-10 | OPS-C03 and Section 15.5 | Per-domain retention/deletion, with policy adoption before the pilot |

### 25.4. Explicit limits of the conclusions

Research confirms relevant public product patterns. It does not establish competitors' internal CMS choices, content-production costs, authorization implementations, or suitability for every contract. Effort estimates, starter-resource counts, SLA targets, retention defaults, and the internal CMS choice are NestSelf planning assumptions. Validate them through the first implemented flow, professional and privacy review, and a real pilot.


