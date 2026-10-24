#!/usr/bin/env python3
"""Build the founder review HTML for docs/tasks/calls-webinars from the markdown package."""
import html
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
OUT = ROOT / "pdf" / "calls-webinars-review.html"
DEC = (ROOT / "02-decisions.md").read_text(encoding="utf-8")
STORIES = (ROOT / "04-user-stories.md").read_text(encoding="utf-8")


def inline(text: str) -> str:
    t = html.escape(text, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    return t


def table_rows(md: str, first_cell_pattern: str):
    rows = []
    for line in md.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and re.fullmatch(first_cell_pattern, cells[0]):
            rows.append(cells)
    return rows


def section(md: str, start_heading: str, end_heading_prefix: str) -> str:
    start = md.index(start_heading)
    end = md.find(end_heading_prefix, start + len(start_heading))
    return md[start: end if end != -1 else len(md)]


# ---------- data from the markdown ----------
founder = table_rows(section(DEC, "## 9. Founder decisions", "## 10."), r"F-CW-\d{2}")
spikes = table_rows(section(DEC, "## 8. Spikes", "## 9."), r"SPIKE-CW-\d{2}")
legal = [re.sub(r"^\d+\.\s*", "", l).strip() for l in section(DEC, "## 10. Legal", "\n## 11").splitlines() if re.match(r"^\d+\.\s", l)]

story_groups = []  # (group title, [rows])
current = None
for line in STORIES.splitlines():
    if line.startswith("### ") or line.startswith("## "):
        title = line.lstrip("#").strip()
        current = None
        if re.search(r"\b(CALL|WBN|WKS|PLT)-", title) or any(k in title.lower() for k in ("consultation", "webinar", "workshop", "platform", "mobile", "appointment")):
            current = (re.sub(r"\s*\(`?[A-Z]+-\d+`?.*\)$", "", title), [])
            story_groups.append(current)
        continue
    if current is not None and line.startswith("|"):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if re.fullmatch(r"(CALL|WBN|WKS|PLT)-\d{2}", cells[0]):
            if len(cells) < 5:
                print("WARN short row", cells[0], file=sys.stderr)
            current[1].append(cells)
story_groups = [g for g in story_groups if g[1]]
n_stories = sum(len(g[1]) for g in story_groups)
not_written = []
m = re.search(r"##+ [^\n]*not written[^\n]*\n(.*?)(?=\n## |\Z)", STORIES, re.S | re.I)
if m:
    for line in m.group(1).splitlines():
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 3 and cells[0] not in ("Topic", "---") and not cells[0].startswith("-"):
                not_written.append(f"**{cells[0]}.** {cells[1]} ({cells[2]})")

# ---------- condensed decisions ----------
DECISIONS = [
    ("D-CW-01", "ruled", "One epic, four milestones", "M0 foundation, M1 consultations with the end-of-call follow-up, M2 webinars live and always recorded, M3 scale and certificates, M4 mobile, workshops and captions. The formats share the adapter, the session model, the client and the diagnostics."),
    ("D-CW-02", "ruled", "A minimal appointment spine, not the booking engine", "Nothing about appointments exists in the code. The epic adds only what a call needs. Availability, booking, funding and rescheduling are a later epic behind a fixed contract seam."),
    ("D-CW-03", "ruled", "Webinar occurrences here, replays in the CMS", "Registration, live session, Q&A and the recording up to a finished MP4 are built here. Review and publication of the replay follow the CMS epic's workflow."),
    ("D-CW-04", "ruled", "Out of scope for the whole epic", "Phone dial-in and SMS, professional notes, settlement, employer reports, live captions, webinars above 1,000 attendees, native mobile modules and chat in consultations."),
    ("D-CW-05", "settled", "A provider adapter with a fake for local work", "A `VideoProvider` with the Chime implementation and a deterministic fake for development and tests. Only the current `chime-sdk-meetings` namespace is used."),
    ("D-CW-06", "settled", "Everything in eu-central-1", "Control, media and pipeline regions are hard-coded and validated at start-up. Product copy says encrypted in transit and at rest, never end-to-end, because audio is mixed on the server."),
    ("D-CW-07", "spike", "The meeting is created at the first join", "A Chime meeting ends after five empty minutes, so it cannot be created at booking. A Redis lock serialises concurrent first joins; the idempotency token is a second line of defence."),
    ("D-CW-08", "ruled", "Rejoin reuses the same attendee", "Join tokens have no clock expiry. Credentials are cached in Redis for the window, never written to PostgreSQL or logs, and the response is marked no-store."),
    ("D-CW-09", "ruled", "Explicit end plus a safety net", "End for everyone deletes the meeting at once. A delayed job closes any room at the scheduled end plus 15 minutes. No extension: the follow-up is scheduled on the post-call screens instead."),
    ("D-CW-10", "ruled", "Meeting features per format", "720p video, echo reduction on, full HD content share. Capacity 4 for a consultation, 250 for a webinar, 30 for a workshop. Webinar attendees are receive-only."),
    ("D-CW-11", "ruled", "Opaque identities towards the provider", "Random per-session participant ids as external ids and the organisation id as tenant id. No name or email ever leaves the platform."),
    ("D-CW-12", "ruled", "Provider events through a queue into the worker", "Direct queue notifications plus an EventBridge backstop. Every event is stored once under a unique key and applied safely out of order; attendee-minutes are derived from events."),
    ("D-CW-13", "ruled", "Client observability without content", "The browser posts failure events and 30-second quality aggregates to the API. Kept 90 days. Alerts on join failures and slow starts."),
    ("D-CW-14", "ruled", "Webinar delivery by audience size", "One meeting up to 250 attendees in M2. Media replication to 1,000 in M3, because 200 to 300 attendees are expected in the first year. Streaming beyond that is documented, not built."),
    ("D-CW-15", "ruled", "Attendee anonymity enforced on the server", "Attendees never send video. No roster for attendees, a count for presenters, names only for the moderator. A host gives the floor, audio only; the attendee unmutes to speak; the host can take it back."),
    ("D-CW-16", "ruled", "Interaction on Socket.IO and PostgreSQL", "The webinar chat, hand-raise, polls and quick signals use the existing gateway with authorised rooms. Chime data messages and Chime messaging are not used."),
    ("D-CW-17", "ruled", "Audience policy, registration and windows", "All eligible members, chosen organisations or units. Capacity is locked at registration; the recording is announced there. Hosts join 30 minutes before, attendees 15. Employers never receive lists."),
    ("D-CW-18", "spike", "Every webinar is recorded, presenter-only", "Recording starts with the webinar and stops with it. Only presenter video and audio are captured into one MP4 in a KMS-encrypted Frankfurt bucket; everyone sees REC (spikes 3 and 4)."),
    ("D-CW-19", "settled", "Consultations are not recorded for now", "Your answer to F-CW-01. The API role has no pipeline permission. The dual-consent data model stays specified for a later decision after the DPIA."),
    ("D-CW-20", "ruled", "One web client package on the Chime JavaScript SDK", "`@nestself/video` has its own hooks and components on the design tokens. The AWS React component library is not used because it brings its own styling."),
    ("D-CW-21", "ruled", "Pre-join is mandatory", "Camera, microphone, speaker and network checks, join with camera off, opt-in blur and browser permission help. Camera on by default after the preview."),
    ("D-CW-22", "ruled", "In-call behaviour", "Speaker view, a three-state connection badge, degraded mode down to audio, two minutes of reconnection then rejoin, a five-minute cue that also reminds the expert of the follow-up, the crisis block with Serbian hotlines one tap away, keyboard and reduced-motion support."),
    ("D-CW-23", "ruled", "No live captions yet", "Chime's transcription does not accept Serbian or Hungarian. Replay captions through batch transcription with human review are an M4 item."),
    ("D-CW-24", "spike", "Mobile joins through the web client inside the app", "No maintained React Native module exists. The app opens a ticketed web call route in a WebView. Native modules are a later epic (F-CW-05)."),
    ("D-CW-25", "ruled", "Tables and tenancy", "Nineteen tables under forced row-level security, including approval items and webinar messages. Outcomes hold a delivery status and connection data only, never notes. Feedback never reaches the employer."),
    ("D-CW-26", "ruled", "Neutral notifications", "Reminders 24 hours and 1 hour before with a neutral subject and a private calendar entry, templates in four locales. No push or SMS in this epic."),
    ("D-CW-27", "ruled", "No chat in consultations", "Only quick signals such as I cannot hear you and the expert's running-late message. Workshops get a chat kept for 24 hours."),
    ("D-CW-28", "ruled", "Support diagnostics", "One endpoint with exactly the redacted field set of the auth strategy, proven by a serialisation test and audited on every view."),
    ("D-CW-29", "ruled", "Retention defaults", "Session metadata 7 years, diagnostics 90 days, questions 12 months, feedback 24 months, raw recording segments 30 days. Pending your L-02 and L-03 answers."),
    ("D-CW-30", "ruled", "Employer isolation", "No route returns participants, registrations, question authors or feedback to organisation-scoped principals. Aggregates only above a group of five, and those belong to the reporting epic."),
    ("D-CW-31", "ruled", "Infrastructure", "A video stack per stage: events queue, EventBridge rule, recordings bucket and two managed policies. The dev stage deploys it alone, like the auth stack."),
    ("D-CW-32", "ruled", "Dependencies", "Four AWS and Chime packages plus a test mock, and a WebView in M4, added to the catalog. Calendar files and date formatting are written in-house."),
    ("D-CW-33", "ruled", "Verification contract", "Authorisation golden cases, event idempotency tests, browser journeys with fake media, motion suite entries, a nightly real-provider smoke test and a load test before the first large webinar."),
    ("D-CW-34", "settled", "Every webinar is recorded; consultations are not", "Your answer to F-CW-01. No recording switch on an occurrence; the recording is announced at registration, in the email and in the lobby; the replay always goes to content review."),
    ("D-CW-35", "settled", "Attendees never have cameras; chat and the floor", "Your answer to F-CW-02. Hosts post to everyone; attendees write to the hosts and a host publishes, anonymously by default. A hand-raise can be given the floor: audio only, host-controlled."),
    ("D-CW-36", "ruled", "The ceiling is technical, not a product rule", "250 per meeting in M2, 1,000 with replication in M3. Until then the occurrence form refuses a larger capacity and says why."),
    ("D-CW-37", "settled", "Follow-up on the post-call screens, approval by policy", "Your answer to F-CW-06. The expert proposes a time after the outcome; the employee confirms, suggests three windows or declines; the organisation policy routes a manager approval that never shows the category."),
    ("D-CW-38", "settled", "Serbia only; Hungarian is a language", "Launch for client companies in Serbia. Hungarian serves the minority in Vojvodina. Serbian law in the checklist, Serbian hotlines in the crisis block, Serbian captions first."),
]
assert len(DECISIONS) == 38

STATUS_PILL = {"settled": ("success", "settled"), "ruled": ("soft", "ruled, default applies"), "spike": ("warning", "ruled, spike pending")}

FOOT = "NestSelf · Consultations and webinars · review copy"


def page(body: str, part: str = "", cls: str = "") -> str:
    return f'<section class="page {cls}" data-part="{part}">{body}<div class="page-footer"><span>{FOOT}</span><span class="num"></span></div></section>\n'


def head(eyebrow: str, title: str, meta: str = "") -> str:
    return f'<div class="page-head"><div><span class="eyebrow">{eyebrow}</span><h2>{title}</h2></div><div class="meta">{meta}</div></div>'


parts = []

# ---------- cover ----------
parts.append('''<section class="page cover" data-part="cover">
  <div class="cover-art-wrap"><svg class="cover-art" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="0.5" aria-hidden="true"><circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="38"/><circle cx="50" cy="50" r="28"/><circle cx="50" cy="50" r="18"/><circle cx="50" cy="50" r="8"/></svg></div>
  <div class="cover-inner">
    <div class="wordmark">nestself</div>
    <h1>Consultations and webinars</h1>
    <p class="subtitle">Private expert and employee video sessions, webinars for client companies and small group workshops on Amazon Chime SDK in Frankfurt. The plan, the decisions, the stories, and your ten answers as they were applied.</p>
    <div class="cover-meta">
      <div><strong>Epic NS-CALLS-01</strong>Review copy, 24 October 2026</div>
      <div><strong>Status</strong>Founder answers applied, v1.1</div>
      <div><strong>Full package</strong>docs/tasks/calls-webinars/</div>
    </div>
  </div>
</section>
''')

# ---------- how to read + contents ----------
toc = ''.join(
    f'<li data-part="{p}"><span>{t}</span><span class="pg"></span></li>'
    for p, t in [("plan", "The plan in brief: what we build, milestones, cost, risks"), ("ask", "What you decided: ten answers and how each was applied"), ("decisions", "The decisions: thirty-eight rulings in one line each"), ("stories", f"The stories: {n_stories} user stories with acceptance criteria"), ("closing", "Closing: what is deliberately not written, next steps")]
)
parts.append(page(
    head("Start here", "How to read this document", "Forty minutes end to end. The yellow pages show your answers and what changed because of them.")
    + '<p class="lead" style="margin-bottom:5mm">Everything in this copy comes from the planning package on branch <code>feat/calls-webinars</code>. Each decision, story and spike keeps its id, so a comment like "change D-CW-17" or "drop WBN-14" lands exactly. The long engineering documents (backlog and implementation guidelines) are not reproduced here.</p>'
    + '<div class="grid cols-2" style="margin-bottom:6mm">'
    + '<div class="card tinted"><h3>What is already fixed</h3><p>The auth strategy chose Amazon Chime SDK in eu-central-1 behind an adapter, one join entry point with a time window, recording off by default and support diagnostics without content. This plan builds on that and does not reopen it.</p></div>'
    + '<div class="card"><h3>What changed with your answers</h3><p>Every webinar is recorded and attendees never have cameras; the floor is audio given by a host; audiences above 250 move up to M3; the end of a consultation leads to a follow-up with manager approval where the company wants it; the launch is Serbia only. Nothing waits on you: M0 can start.</p></div>'
    + '</div>'
    + '<h3 class="lane-title">Contents</h3><ol class="toc">' + toc + '</ol>'
    + '<div class="legend"><span class="pill success">settled</span> follows from an earlier binding decision or a verified fact &nbsp; <span class="pill soft">ruled</span> taken here with a default you can overturn &nbsp; <span class="pill warning">spike pending</span> binds after a measurement in M0 &nbsp; <span class="pill primary">P0</span> needed for the pilot &nbsp; <span class="pill accent">P1</span> first quarter after &nbsp; <span class="pill soft">P2</span> later</div>'
, "start"))

# ---------- plan page A ----------
parts.append(page(
    head("The plan in brief", "What we build and the loop it closes", "Three formats on one real-time layer. Epic NS-CALLS-01, milestones M0 to M4.")
    + '<p class="small" style="margin-bottom:4mm;font-size:10pt;line-height:1.45">Private one-to-one consultations; webinars where employees watch one or two presenters without seeing each other; small workshops on video. All three share the Chime adapter, the session model, the client, the event ingestion and the diagnostics.</p>'
    + '<div class="grid cols-2" style="margin-bottom:5mm">'
    + '<div class="card"><h3>A consultation</h3><ol class="steps compact"><li><h4>Neutral reminder</h4><p>"Your NestSelf session", 24 h and 1 h before, private calendar entry.</p></li><li><h4>Pre-join check</h4><p>Devices and network, camera off if wanted, blur, permission help.</p></li><li><h4>Private room</h4><p>Only the two participants, 15 min before to 10 min after; not recorded.</p></li><li><h4>Outcome, then follow-up</h4><p>The expert records the outcome and proposes a follow-up; the employee confirms or suggests a time; a manager approves if the company policy says so.</p></li><li><h4>Private feedback</h4><p>Optional, one to five, never visible to the employer.</p></li></ol></div>'
    + '<div class="card"><h3>A webinar</h3><ol class="steps compact"><li><h4>Discover and register</h4><p>Eligible employees register; capacity enforced; "this webinar is recorded" stated up front.</p></li><li><h4>Lobby</h4><p>Title, presenter, countdown; "your camera stays off; write to the hosts or raise your hand".</p></li><li><h4>Live</h4><p>Presenter video and slides; no roster, no attendee cameras; chat to the hosts, published anonymously; polls; the floor (audio) given by a host.</p></li><li><h4>Replay</h4><p>Presenter-only recording of every webinar, reviewed as content before anyone sees it.</p></li></ol></div>'
    + '</div>'
    + '<div class="grid cols-2">'
    + '<div class="card"><h3>In this epic</h3><ul class="small"><li>A minimal appointment spine; the Chime adapter with a local fake</li><li>Pre-join and in-call client; screens in both web apps</li><li>Follow-up after a call, with manager approval by company policy</li><li>Webinars: registration, reminders, chat, polls, the floor, moderation</li><li>Presenter-only recording of every webinar, handoff to the CMS</li><li>Diagnostics, audit, neutral emails, tests, infrastructure</li><li>M3: audiences up to 1,000, certificates; M4: mobile, workshops, captions</li></ul></div>'
    + '<div class="card"><h3>Deliberately not in it</h3><ul class="small"><li>Availability, booking, funding, rescheduling rules (a booking epic)</li><li>Review and publication of replays (the CMS epic)</li><li>Recording of consultations (not for now); attendee cameras (never)</li><li>Extending a running session (replaced by the follow-up)</li><li>Live captions; phone dial-in; SMS and push; professional notes</li><li>Native mobile call modules, screen share from phones</li><li>A Hungarian launch (the locale stays for Vojvodina)</li></ul></div>'
    + '</div>'
, "plan"))

# ---------- plan page B ----------
parts.append(page(
    head("The plan in brief", "Milestones, effort and cost", "Effort is a planning range for engineers who already know the repository; prices are AWS list prices in October 2026.")
    + '<table class="data" style="margin-bottom:5mm"><thead><tr><th style="width:14mm">Milestone</th><th>Outcome</th><th>What a demo shows</th><th class="num" style="width:26mm">Person-days</th></tr></thead><tbody>'
    + '<tr><td class="key">M0</td><td>Foundation and spikes</td><td>The adapter with its fake, the dev video stack deployed, contracts, the appointment spine, sample data, eight spike results written down</td><td class="num">8 to 14.5</td></tr>'
    + '<tr><td class="key">M1</td><td>Consultations end to end, with the follow-up</td><td>An expert in the admin app and an employee in the workspace app meet in a private room; afterwards the expert proposes a follow-up, the employee confirms, and a manager approves it where the company policy requires</td><td class="num">27.5 to 42.5</td></tr>'
    + '<tr><td class="key">M2</td><td>Webinars live up to 250, always recorded</td><td>An operator publishes an occurrence, employees register, the recording starts with the webinar, the chat runs through the hosts, a host gives an attendee the floor, the replay lands in content review</td><td class="num">22 to 33.5</td></tr>'
    + '<tr><td class="key">M3</td><td>Scale, certificates, load test</td><td>An occurrence with 600 registrations runs on a replicated meeting; opt-in certificates with a neutral title; a load test before the first large webinar</td><td class="num">6 to 9.5</td></tr>'
    + '<tr><td class="key">M4</td><td>Mobile, workshops, captions</td><td>Joining from the phone app, a 25-person workshop, Serbian replay captions</td><td class="num">7 to 10</td></tr>'
    + '<tr><td class="key">Total</td><td colspan="2">71 to 110 person-days bottom-up; plan 90 to 135 with a buffer for reviews, spike outcomes and rebases against the parallel auth work</td><td class="num">71 to 110</td></tr>'
    + '</tbody></table>'
    + '<div class="grid cols-3" style="margin-bottom:5mm">'
    + '<div class="tile"><div class="value">0.0017</div><div class="label">US dollars per attendee-minute, the only price that matters at pilot scale; a 45-minute consultation costs about 15 cents</div></div>'
    + '<div class="tile"><div class="value">87 to 114</div><div class="label">US dollars per month at 500 consultations and one monthly webinar of 100 to 300 attendees with a replay</div></div>'
    + '<div class="tile"><div class="value">385 to 394</div><div class="label">US dollars per month at 2,000 consultations and a 1,000-attendee webinar; volume pricing is worth a conversation after 1,000 consultations a month</div></div>'
    + '</div>'
    + '<h3 class="lane-title">How a webinar is delivered, by audience size</h3>'
    + '<table class="data compact"><thead><tr><th style="width:30mm">Audience</th><th>Model</th><th>Why</th><th style="width:30mm">When</th></tr></thead><tbody>'
    + '<tr><td class="key">Up to 25</td><td>One meeting, everyone on video (workshop)</td><td>Fits the 25 concurrent video senders a meeting allows</td><td>M4</td></tr>'
    + '<tr><td class="key">26 to 250</td><td>One meeting, receive-only audience</td><td>Attendees cannot send audio or video, so they cannot see or hear each other; simplest and cheapest</td><td>M2</td></tr>'
    + '<tr><td class="key">251 to 1,000</td><td>One presenter meeting replicated into up to four audience meetings</td><td>Replica attendees receive only the presenters; adds about one cent per audience-meeting-minute</td><td>M3</td></tr>'
    + '<tr><td class="key">Above 1,000</td><td>Presenter meeting streamed to Amazon IVS</td><td>Unlimited viewers at three to five seconds of delay; questions over our own channel</td><td>Documented only</td></tr>'
    + '</tbody></table>'
, "plan"))

# ---------- plan page C: risks + legal ----------
legal_items = ''.join(f'<li><p>{inline(l.split(". ")[0].rstrip(".") + ".")}</p></li>' for l in legal)
parts.append(page(
    head("The plan in brief", "Risks, and the legal checklist", "Serbian law only. Checklist items are launch conditions for the production account and never block development.")
    + '<div class="grid cols-2" style="margin-bottom:5mm">'
    + '<div class="card"><h3>Risks we accept knowingly</h3><ul class="small"><li><strong>No maintained React Native module.</strong> Mobile uses the web client inside the app; screen share from phones is not possible.</li><li><strong>Serbian and Hungarian live captions.</strong> Not supported by Chime transcription; replays are captioned later with review.</li><li><strong>Recording pipeline quota.</strong> Ten concurrent pipelines by default in Frankfurt; a quota request before the first busy month.</li><li><strong>Corporate networks.</strong> Blocked UDP falls back to TCP 443 with lower quality; client companies get a one-page network note.</li></ul></div>'
    + '<div class="card"><h3>Risks we watch</h3><ul class="small"><li><strong>Parallel auth work.</strong> Both efforts edit the action and template catalogue; those tasks go last and rebase first.</li><li><strong>Undocumented idempotency.</strong> Chime does not document what a repeated create request returns; the Redis lock is the real protection, measured in spike 1.</li><li><strong>The floor in replicated meetings.</strong> A reported audio dropout after 40 minutes; measured at the start of M3 before replication is built.</li><li><strong>Approval policy without an approver.</strong> A company that requires approval but names no approver for a unit: the proposal fails visibly and tells the employee to ask HR.</li><li><strong>Recorded voices.</strong> An attendee given the floor is on the recording; the notice before unmuting is logged, since Serbian law on recording is explicit about consent.</li></ul></div>'
    + '</div>'
    + '<div class="card"><h3>Before the first real consultation in production</h3><ol class="steps compact">' + legal_items + '</ol></div>'
, "plan"))

# ---------- plan page D: spikes + next ----------
spike_rows = ''.join(f'<tr><td class="key">{inline(r[0])}</td><td>{inline(r[1])}</td><td>{inline(r[2])}</td><td>{inline(r[3])}</td></tr>' for r in spikes)
parts.append(page(
    head("The plan in brief", "The measurements that come first, and what happens next", "Eight spikes run in M0 against the dev account before the lifecycle decisions bind.")
    + '<table class="data compact spikes" style="margin-bottom:5mm"><thead><tr><th style="width:27mm">Spike</th><th style="width:72mm">Question</th><th>Method</th><th style="width:24mm">Binds</th></tr></thead><tbody>' + spike_rows + '</tbody></table>'
    + '<div class="card tinted"><h3>What happens next</h3><ol class="steps compact"><li><p>Your answers are applied; nothing waits on you.</p></li><li><p>M0 starts: catalog additions and one install, the adapter with its fake, the dev video stack, the appointment spine, the eight spikes.</p></li><li><p>Spike results are written to the package; any decision marked spike pending binds or changes.</p></li><li><p>M1 delivers the first real consultation between the two web apps, then M2 the first webinar.</p></li><li><p>The DPIA and the legal checklist run before production.</p></li></ol></div>'
, "plan"))

# ---------- ask: founder questions (flow) ----------
ask_cards = []
for r in founder:
    fid, q, default, change = r[0], r[1], r[2], r[3]
    ask_cards.append(
        f'<div class="ask"><div class="ask-id">{fid}</div><div class="ask-body"><h3>{inline(q)}</h3>'
        f'<dl class="rows"><dt>Your answer</dt><dd>{inline(default)}</dd><dt>Applied as</dt><dd>{inline(change)}</dd></dl></div></div>'
    )
ask_cards.append('<div class="ask"><div class="ask-id">Launch</div><div class="ask-body"><h3>Where does NestSelf launch?</h3><dl class="rows"><dt>Your answer</dt><dd>Serbia only. Hungarian is the language of the minority in Vojvodina.</dd><dt>Applied as</dt><dd>D-CW-38: Serbian law in the checklist, Serbian hotlines in the crisis block, Serbian captions first, all four locales kept.</dd></dl></div></div>')
parts.append(
    f'<div class="flow-source" data-part="ask" data-eyebrow="What you decided" data-title="Ten answers, and how each was applied" data-meta="Answered on 24 October 2026. Each answer changed the decisions, the stories and the backlog; the ids on the right lead to the detail." data-layout="stack" data-page-class="ask-page">'
    + ''.join(ask_cards) + '</div>\n'
)

# ---------- decisions (flow, two columns) ----------
dec_cards = []
for did, status, title, why in DECISIONS:
    pill_cls, pill_txt = STATUS_PILL[status]
    dec_cards.append(f'<div class="decision"><div class="id">{did}</div><div><div class="title">{inline(title)} <span class="pill {pill_cls}">{pill_txt}</span></div><div class="why">{inline(why)}</div></div></div>')
parts.append(
    '<div class="flow-source" data-part="decisions" data-eyebrow="The decisions" data-title="Thirty-eight rulings, one line each" data-meta="The full record has the alternatives, the evidence ids and the canonical names. D-CW-34 to D-CW-38 come from your answers." data-layout="decisions">'
    + ''.join(dec_cards) + '</div>\n'
)

# ---------- stories (flow, table) ----------
PRIO_PILL = {"P0": "primary", "P1": "accent", "P2": "soft"}
story_items = []
for title, rows in story_groups:
    story_items.append(f'<tr class="group"><td colspan="5">{inline(title)} <span class="count">{len(rows)} stories</span></td></tr>')
    for r in rows:
        sid, prio, ms, story, acc = r[0], r[1], r[2], r[3], r[4]
        p = PRIO_PILL.get(prio.split("-")[0], "soft")
        story_items.append(f'<tr><td class="key">{sid}</td><td><span class="pill {p}">{inline(prio)}</span></td><td>{inline(ms)}</td><td>{inline(story)}</td><td>{inline(acc)}</td></tr>')
parts.append(
    f'<div class="flow-source" data-part="stories" data-eyebrow="The stories" data-title="{n_stories} user stories with acceptance criteria" data-meta="Ids are stable: CALL consultations, WBN webinars, WKS workshops, PLT platform and support. P0 is needed for the pilot. The grounding column (decision and evidence ids) is in the markdown." data-layout="table" data-thead="&lt;th style=&quot;width:15mm&quot;&gt;Id&lt;/th&gt;&lt;th style=&quot;width:9mm&quot;&gt;Pri&lt;/th&gt;&lt;th style=&quot;width:8mm&quot;&gt;M&lt;/th&gt;&lt;th style=&quot;width:46mm&quot;&gt;Story&lt;/th&gt;&lt;th&gt;Acceptance criteria&lt;/th&gt;">'
    + '<table><tbody>' + ''.join(story_items) + '</tbody></table></div>\n'
)

# ---------- closing ----------
nw = ''.join(f'<li>{inline(x)}</li>' for x in not_written) or '<li>See the story catalog.</li>'
parts.append(page(
    head("Closing", "Deliberately not written, and how to answer", "Each item waits on one of your questions or on another epic.")
    + '<div class="grid cols-2">'
    + '<div class="card"><h3>Stories left out on purpose</h3><ul class="small">' + nw + '</ul></div>'
    + '<div class="stack"><div class="card tinted"><h3>How to change anything</h3><p>Reply with the ids: "D-CW-27 add chat to consultations", "CALL-37 drop", "WBN-30 allow 400". Anything without an id is treated as a comment on the plan as a whole. The package, including this copy, is regenerated from the markdown, so a change lands in every document at once.</p></div>'
    + '<div class="card"><h3>Where the detail lives</h3><ul class="small"><li><code>02-decisions.md</code>: the full decision record with alternatives and canonical names</li><li><code>03-epic.md</code>: the charter with architecture and provenance</li><li><code>04-user-stories.md</code>: the stories with their grounding column</li><li><code>05-tasks.md</code>: 27 tasks with files, steps, tests and gates</li><li><code>06-implementation-guidelines.md</code>: 120 engineering requirements</li><li><code>research/</code>: 227 dated, sourced facts and the codebase survey</li></ul></div><div class="card"><h3>Numbers in this copy</h3><p class="small">Effort ranges are planning assumptions. Prices are AWS list prices read on 24 October 2026 and carry their source ids in the research files. Thresholds (15 and 10 minute window, 250 attendees, 24 and 1 hour reminders, group of five) are decisions, not measurements, and can be changed by id.</p></div></div>'
    + '</div>'
, "closing"))

EXTRA_CSS = """
.lane-title { font-size: 9pt; font-weight: 600; letter-spacing: 0.04em; text-transform: none; color: var(--color-text-secondary); margin: 0 0 2.5mm; }
.legend { margin-top: 6mm; font-size: 8.5pt; color: var(--color-text-secondary); line-height: 2; }
.decisions.two { grid-template-columns: 1fr 1fr; align-content: start; }
.flow-body { flex: 1 1 auto; min-height: 0; }
.steps.compact > li { padding-bottom: 2.4mm; }
.steps.compact p { font-size: 9pt; color: var(--color-text); }
.ask { display: grid; grid-template-columns: 16mm 1fr; gap: 4mm; background: var(--color-surface); border: 1px solid var(--color-warning); border-left: 3px solid var(--color-warning); border-radius: var(--radius-card); padding: 4mm 5mm; margin-bottom: 3.2mm; }
.ask-id { font-weight: 600; color: var(--color-warning); font-size: 9.5pt; font-variant-numeric: tabular-nums; }
.ask h3 { font-size: 11pt; font-weight: 600; line-height: 1.3; margin-bottom: 2mm; }
.ask .rows { display: grid; grid-template-columns: 34mm 1fr; gap: 1mm 4mm; font-size: 9.2pt; line-height: 1.42; margin: 0; }
.ask .rows dt { color: var(--color-text-secondary); font-weight: 600; }
.ask .rows dd { margin: 0; }
.ask .check { margin-top: 2.5mm; font-size: 9pt; color: var(--color-text-secondary); display: flex; align-items: center; gap: 1.5mm; }
.ask .box { display: inline-block; width: 4mm; height: 4mm; border: 1.2px solid var(--color-border-control); border-radius: 1mm; background: #fff; }
.ask .line { display: inline-block; flex: 1 1 auto; border-bottom: 1px solid var(--color-border-control); height: 3.5mm; margin-left: 1mm; }
table.data tr.group td { background: var(--color-tint); font-weight: 600; font-size: 9pt; color: var(--color-text); padding: 2.2mm 2.4mm; }
table.data tr.group .count { font-weight: 400; color: var(--color-text-secondary); margin-left: 2mm; font-size: 8pt; }
table.data.stories td { font-size: 8pt; line-height: 1.38; vertical-align: top; }
table.data.stories td.key { white-space: nowrap; font-variant-numeric: tabular-nums; }
.page-head h2 { max-width: 38ch; }
.decision { grid-template-columns: 15mm 1fr; }
.decision .id, table.data.spikes td.key, table.data.stories td.key { white-space: nowrap; }
table.data.spikes td { font-size: 8.2pt; }
"""

PAGINATOR = r"""
<script>
(async function () {
  await document.fonts.ready;
  const FOOT = %(foot)s;
  function makePage(src, cont) {
    const sec = document.createElement('section');
    sec.className = 'page ' + (src.dataset.pageClass || '');
    sec.dataset.part = src.dataset.part;
    const title = src.dataset.title + (cont ? ' (continued)' : '');
    const meta = cont ? 'Continued from the previous page.' : src.dataset.meta;
    sec.innerHTML = '<div class="page-head"><div><span class="eyebrow">' + src.dataset.eyebrow + '</span><h2>' + title + '</h2></div><div class="meta">' + meta + '</div></div><div class="flow-body"></div><div class="page-footer"><span>' + FOOT + '</span><span class="num"></span></div>';
    src.parentNode.insertBefore(sec, src);
    const body = sec.querySelector('.flow-body');
    let holder = body;
    if (src.dataset.layout === 'table') {
      const t = document.createElement('table');
      t.className = 'data compact stories';
      t.innerHTML = '<thead><tr>' + src.dataset.thead + '</tr></thead><tbody></tbody>';
      body.appendChild(t);
      holder = t.querySelector('tbody');
    } else if (src.dataset.layout === 'decisions') {
      const d = document.createElement('div');
      d.className = 'decisions two';
      body.appendChild(d);
      holder = d;
    }
    return { sec, holder };
  }
  const fits = (sec, holder) => {
    if (sec.scrollWidth > sec.clientWidth + 1) return false;
    const limit = sec.getBoundingClientRect().top + sec.clientHeight - parseFloat(getComputedStyle(sec).paddingBottom) - 2;
    const last = holder.lastElementChild;
    return !last || last.getBoundingClientRect().bottom <= limit;
  };
  for (const src of Array.from(document.querySelectorAll('.flow-source'))) {
    const items = Array.from(src.dataset.layout === 'table' ? src.querySelector('tbody').children : src.children);
    let cur = makePage(src, false);
    let prevGroup = null;
    for (const item of items) {
      cur.holder.appendChild(item);
      if (!fits(cur.sec, cur.holder)) {
        cur.holder.removeChild(item);
        const carry = [];
        if (prevGroup && prevGroup.parentNode === cur.holder && prevGroup === cur.holder.lastElementChild) { cur.holder.removeChild(prevGroup); carry.push(prevGroup); }
        if (cur.holder.children.length === 0 && carry.length === 0) { cur.holder.appendChild(item); continue; }
        cur = makePage(src, true);
        for (const c of carry) cur.holder.appendChild(c);
        cur.holder.appendChild(item);
      }
      prevGroup = item.classList && item.classList.contains('group') ? item : null;
    }
    src.remove();
  }
  const pages = Array.from(document.querySelectorAll('.page'));
  pages.forEach((p, i) => { const n = p.querySelector('.page-footer .num'); if (n) n.textContent = String(i + 1); });
  document.querySelectorAll('.toc li[data-part]').forEach((li) => {
    const idx = pages.findIndex((p) => p.dataset.part === li.dataset.part);
    li.querySelector('.pg').textContent = idx >= 0 ? String(idx + 1) : '';
  });
  window.__paginated = true;
})();
</script>
"""

doc = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>NestSelf consultations and webinars, review copy</title>'
       '<link rel="stylesheet" href="styles.css"><style>' + EXTRA_CSS + '</style></head><body>\n'
       + ''.join(parts) + PAGINATOR % {"foot": repr(FOOT)} + '</body></html>\n')
OUT.write_text(doc, encoding="utf-8")
print(f"wrote {OUT}: {len(founder)} founder questions, {len(spikes)} spikes, {len(legal)} legal items, {len(DECISIONS)} decisions, {n_stories} stories in {len(story_groups)} groups, {len(not_written)} not-written items")
