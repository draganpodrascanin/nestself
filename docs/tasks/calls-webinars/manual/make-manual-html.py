#!/usr/bin/env python3
"""Build the user manual HTML for docs/tasks/calls-webinars (epic NS-CALLS-01).

Usage:
  python3 docs/tasks/calls-webinars/manual/make-manual-html.py [docs/tasks/calls-webinars]

Writes manual/user-manual.html next to this script. The manual is a tutorial: one user
path per chapter, numbered steps, one or two sentences and a screenshot (computer and
phone) per step. The page reuses ../pdf/styles.css (tokens, Onest) and adds its own rules
inline, on the same tokens. An in-page paginator packs the steps of each chapter into
fixed A4 sheets; ../pdf/build-pdf.mjs renders it and refuses to write when a sheet
overflows.

Every on-screen word quoted in the manual is read from the English catalog
(packages/i18n/locales/en/calls.json and common.json) by key, so a renamed button or
message fails the build instead of going stale. The screenshots and their facts come
from manual/screenshots/INDEX.md; a screen the steps do not place is added to a closing
"More screens" chapter, and a planned screen without files shows as pending.
"""
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent
REPO = PKG.parents[2]
SHOTS = HERE / "screenshots"
OUT = HERE / "user-manual.html"

CALLS = json.loads((REPO / "packages/i18n/locales/en/calls.json").read_text(encoding="utf-8"))
COMMON = json.loads((REPO / "packages/i18n/locales/en/common.json").read_text(encoding="utf-8"))

FOOT = "NestSelf · Consultations and webinars · Step-by-step guide"
EDITION = "30 October 2026"


# ---------- catalog wording ----------
def _lookup(tree: dict, key: str) -> str:
    node = tree
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"catalog key missing: {key}")
        node = node[part]
    if not isinstance(node, str):
        raise KeyError(f"catalog key is not a string: {key}")
    return node


def s(key: str, ns: dict = CALLS, **values) -> str:
    """The catalog text for a key, with {{placeholders}} filled in."""
    text = _lookup(ns, key)
    for name, value in values.items():
        text = text.replace("{{" + name + "}}", str(value))
    if "{{" in text:
        raise ValueError(f"unfilled placeholder in {key}: {text}")
    return text


def ui(key: str, ns: dict = CALLS, **values) -> str:
    """A button, field or menu label, as the app shows it."""
    return f'<span class="ui">{html.escape(s(key, ns, **values), quote=False)}</span>'


def nav(key: str) -> str:
    return ui(f"nav.{key}", COMMON)


def q(key: str, ns: dict = CALLS, **values) -> str:
    """A message the app shows, quoted."""
    return f'<span class="q">“{html.escape(s(key, ns, **values), quote=False)}”</span>'


# ---------- screenshots ----------
def read_index():
    text = (SHOTS / "INDEX.md").read_text(encoding="utf-8")
    screens = {}
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 6 or not re.fullmatch(r"\d+", cells[0]):
            continue
        num = f"{int(cells[0]):02d}"
        files = re.findall(r"\[([^\]]+\.png)\]", cells[1])
        screens[num] = {"files": files, "route": cells[2], "who": cells[3], "state": cells[4], "step": cells[5]}
    not_captured = []
    m = re.search(r"## Not captured\s*\n(.*?)(?=\n## |\Z)", text, re.S)
    if m:
        not_captured = [l[2:].strip() for l in m.group(1).splitlines() if l.startswith("- ")]
    return screens, not_captured


SCREENS, NOT_CAPTURED = read_index()
# A screen the last run did not capture shows as pending even when an older file is still on disk.
NOT_CAPTURED_NUMS = {f"{int(m.group(1)):02d}" for m in (re.match(r"(\d+)\.", line) for line in NOT_CAPTURED) if m}
ON_DISK = sorted(p.name for p in SHOTS.glob("*.png"))
for name in ON_DISK:  # files the index does not list yet still belong in the manual
    num = name[:2]
    SCREENS.setdefault(num, {"files": [], "route": "", "who": "", "state": "", "step": ""})
    if name not in SCREENS[num]["files"]:
        SCREENS[num]["files"].append(name)

USED = set()
PENDING = []
SHOTS_USED = []


def files_for(num: str):
    if num in NOT_CAPTURED_NUMS:
        return None, None
    present = set(ON_DISK)
    files = [f for f in SCREENS.get(num, {}).get("files", []) if f in present]
    desktop = next((f for f in files if f.endswith("-desktop.png")), None)
    mobile = next((f for f in files if f.endswith("-mobile.png")), None)
    return desktop, mobile


def have(num: str) -> bool:
    return any(files_for(num))


def figure(num: str, alt: str, size: str = "") -> str:
    USED.add(num)
    desktop, mobile = files_for(num)
    alt_attr = html.escape(re.sub("<[^>]+>", "", alt), quote=True)
    imgs = []
    if desktop:
        imgs.append(f'<img class="d" src="screenshots/{desktop}" width="1280" height="800" alt="{alt_attr} (computer)">')
        SHOTS_USED.append(desktop)
    if mobile:
        imgs.append(f'<img class="m" src="screenshots/{mobile}" width="390" height="844" alt="{alt_attr} (phone)">')
        SHOTS_USED.append(mobile)
    if not imgs:
        PENDING.append(num)
        imgs.append(f'<div class="pending"><strong>Screenshot pending</strong>Screen {num} is planned and not captured yet.</div>')
    which = "computer and phone" if desktop and mobile else ("computer" if desktop else ("phone" if mobile else "pending"))
    return f'<figure class="shot {size}"><div class="imgs">{"".join(imgs)}</div><figcaption>Screen {num} · {which}</figcaption></figure>'


# ---------- blocks ----------
def blk(inner: str, cls: str = "") -> str:
    return f'<div class="blk {cls}">{inner}</div>'


def p(text: str) -> str:
    return f"<p>{text}</p>"


def ul(*items: str) -> str:
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


STEP_NO = 0


def begin() -> list:
    """Starts a tutorial: resets the step counter and returns its block list."""
    global STEP_NO
    STEP_NO = 0
    return []


def step(title: str, body: str, num: str, size: str = "", who: str = "") -> str:
    """One numbered step: title, one or two sentences, the screen on computer and phone."""
    global STEP_NO
    STEP_NO += 1
    pill = f'<span class="pill soft who">{who}</span>' if who else ""
    desktop, mobile = files_for(num)
    if mobile and not desktop:  # a phone-only screen sits beside its text
        return blk(
            f'<div class="side"><div class="step-head"><span class="step-no">{STEP_NO}</span>'
            f'<div><h3>{title}{pill}</h3>{body}</div></div>{figure(num, title, "single")}</div>', "step")
    return blk(f'<div class="step-head"><span class="step-no">{STEP_NO}</span><div><h3>{title}{pill}</h3>{body}</div></div>{figure(num, title, size)}', "step")


def tip(title: str, body: str, cls: str = "info") -> str:
    """A short aside between steps: a rule the reader should know."""
    return blk(f'<div class="callout {cls}"><strong>{title}</strong>{body}</div>', "tip")


def sub(title: str) -> str:
    """A heading inside a tutorial; it never ends a page on its own."""
    return blk(f'<h2 class="sub-title">{title}</h2>', "sub kwn")


def cards(*items: str, cols: int = 2) -> str:
    return blk(f'<div class="grid cols-{cols}">{"".join(items)}</div>', "cards")


def card(title: str, body: str, cls: str = "") -> str:
    return f'<div class="card {cls}"><h3>{title}</h3>{body}</div>'


CHAPTERS = []
PARTS = []


def chapter(part: str, number: int, title: str, lead: str, meta: str, blocks: list, kind: str = "Tutorial") -> None:
    CHAPTERS.append((part, number, title, kind))
    attrs = (
        f'data-part="{part}" data-number="{number}" data-kind="{kind}" data-title="{html.escape(title, quote=True)}" '
        f'data-meta="{html.escape(meta, quote=True)}"'
    )
    lead_html = blk(f'<p class="lead">{lead}</p>', "lead-blk") if lead else ""
    PARTS.append(f'<div class="flow-source" {attrs}>{lead_html}{"".join(blocks)}</div>\n')


T_HHMM = "HH:MM"
T_DATE = "DATE"

# ---------- cover ----------
PARTS.append(f'''<section class="page cover" data-part="cover">
  <div class="cover-art-wrap"><svg class="cover-art" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="0.5" aria-hidden="true"><circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="38"/><circle cx="50" cy="50" r="28"/><circle cx="50" cy="50" r="18"/><circle cx="50" cy="50" r="8"/></svg></div>
  <div class="cover-inner">
    <div class="wordmark">nestself</div>
    <h1>Consultations and webinars</h1>
    <p class="subtitle">Step-by-step guide. Each chapter follows one person through one task, screen by screen: joining a consultation, answering a follow-up, approving one, attending or running a webinar.</p>
    <div class="cover-meta">
      <div><strong>Epic NS-CALLS-01</strong>Edition of {EDITION}</div>
      <div><strong>For</strong>Employees, experts, HR and approvers, NestSelf operations</div>
      <div><strong>Screens</strong>Sample environment, fictional people</div>
    </div>
    <p class="cover-note">English edition. The product also ships in Serbian (Latin and Cyrillic) and Hungarian; every screen works the same in each language.</p>
  </div>
</section>
''')

# ---------- Before you start ----------
chapter("start", 0, "Before you start",
    "",
    "Two web apps, four kinds of people.",
    [
        cards(
            card("Who uses which app", ul(
                "<strong>Employees</strong> and <strong>HR</strong> use the workspace app.",
                "<strong>Experts</strong> and <strong>NestSelf operations</strong> use the admin app.",
                "Pick the tutorial for your task from the list below. Each one stands alone.",
            ), "tinted"),
            card("How to read a step", ul(
                f"Buttons and fields are in bold green, like {ui('join.button')}. Messages the app shows are in quotes, like {q('consultation.fiveMinutesRemaining')}",
                "Each step shows the screen on a computer (left) and on a phone (right). Times are HH:MM and dates DATE where the app fills them in.",
                "The people are fictional sample people: Jovan Petrović (employee), Milica Ristić (expert), Ivana Jovanović (HR), Nikola Đorđević (operations). Video is a drawn placeholder.",
            )),
        ),
        "__TOC__",  # filled in once every chapter is known, so the list names only chapters that exist
    ], kind="Start")

# ---------- 1. Join your consultation ----------
t = begin()
t.append(step("Open your appointments",
    p(f"In the workspace app, open {nav('appointments')}. {ui('appointments.upcoming')} lists the sessions to come; each row shows the date, the service, your expert's first name and a status badge."),
    "01"))
t.append(step("Open the appointment",
    p(f"Until 15 minutes before the start the button reads {ui('join.comeBackAt', time=T_HHMM)} and cannot be selected. You can still {ui('cancel.button')} from here."),
    "02"))
t.append(step("Join from 15 minutes before",
    p(f"When the window opens, {ui('join.button')} becomes active. Select it."),
    "03"))
t.append(tip("The join window", p("Joining opens 15 minutes before the start. A first join is possible until 10 minutes after the start; once you have joined, you can rejoin until the room closes, 15 minutes after the scheduled end.")))
t.append(step("Check your devices",
    p(f"{q('prejoin.title')} tests your camera, microphone, speaker and connection. Speak and watch the bar move, select {ui('prejoin.speakerTest')}, change a device if needed, then {ui('prejoin.joinNow')}. The microphone must work; the camera is optional."),
    "04"))
t.append(step("Optional: camera off or blurred background",
    p(f"Switch on {ui('prejoin.cameraOff')} to join without video, or {ui('prejoin.blur')} to hide the room behind you. Both are remembered on this device."),
    "05"))
t.append(step("Wait for your expert",
    p(f"If you are first, the stage says {q('consultation.waiting')} with the scheduled time and a few tips. If your expert is running late, the card tells you. The call starts when they join."),
    "06"))
t.append(step("Talk",
    p(f"Your expert fills the screen; your own video sits in a corner. The bar has {ui('controls.mute')}, {ui('controls.cameraOff')}, {ui('controls.blurOn')}, {ui('controls.devices')}, {ui('controls.fullscreen')}, the quick signals {ui('controls.cannotHear')} and {ui('controls.cannotSee')}, and {ui('consultation.leave')}. A consultation is never recorded."),
    "07"))
t.append(step("On a phone",
    p(f"The main controls stay in the bar; {ui('controls.more')} holds blur, full screen and the two quick signals."),
    "08"))
t.append(step("Need help right now?",
    p(f"{ui('crisis.open')} is always at the top. It opens the Serbian crisis numbers (112, 194, Centar Srce 0800 300 303) over the running call; on a phone, tap a number to call it. Close it with the cross."),
    "12"))
t.append(step("Five minutes left",
    p(f"The timer shows the time elapsed and left. Five minutes before the end, {q('consultation.fiveMinutesRemaining')} appears. The room closes 15 minutes after the scheduled end."),
    "13"))
t.append(step("The session ends",
    p(f"When your expert ends the session, the stage says {q('consultation.sessionEnded')} for five seconds, then the post-call screen opens. {ui('consultation.leave')} at any time leaves only you."),
    "18"))
t.append(step("Leave private feedback",
    p(f"Rate the session from 1 to 5 and add a comment if you like, then {ui('feedback.submit')}, or {ui('feedback.skip')}. {q('feedback.privacy')}"),
    "19"))
t.append(step("Report a technical problem",
    p(f"If something went wrong, {ui('report.open')}. Pick what failed; the dialog lists exactly what is sent (call length, reconnections, connection quality, browser, operating system) and nothing else. {ui('report.send')}."),
    "20"))
chapter("join", 1, "Join your consultation",
    "An employee meets a NestSelf expert in a private video session. Only the two of you are in the room, and nothing is recorded.",
    "Employee · workspace app", t)

# ---------- 2. Trouble ----------
t = begin()
t.append(step("A weak connection",
    p(f"The badge turns yellow and a banner says {q('connection.degradedBanner')} Keep talking; the app lowers your video quality first."),
    "10"))
t.append(step("Video paused, sound continues",
    p(f"After two poor measurements your outgoing video pauses: {q('connection.videoPaused')} It comes back by itself when the connection recovers."),
    "11"))
t.append(step("Connection lost",
    p(f"The app shows {q('connection.reconnecting')} and tries for up to two minutes. If that fails, choose {ui('stage.rejoin')} or {ui('stage.contactSupport')}. Rejoining puts you back into the same session while the room is open."),
    "09"))
t.append(step("You are too late",
    p(f"More than 10 minutes after the start, a first join is no longer possible: the page says {q('join.windowClosed')} and offers technical support. You also receive an email asking whether a technical problem kept you away."),
    "28", "s"))
t.append(step("The join is refused at the last moment",
    p(f"The server checks the window again when you select {ui('prejoin.joinNow')}. If it closed in the meantime, the device check shows {q('errors.joinWindowClosed')}"),
    "29", "s"))
chapter("trouble", 2, "If the connection is weak or you are late",
    "What the app does on a bad connection, and what you see when the join window has closed.",
    "Employee · workspace app", t)

# ---------- 3. Follow-up ----------
t = begin()
t.append(step("A proposal arrives",
    p(f"After the call your expert can propose another session. It appears on the post-call screen, on the appointment page and in an email titled {q('email.followUpProposedSubject')} Choose {ui('followUp.confirm')}, {ui('followUp.suggestTimes')} or {ui('followUp.decline')}."),
    "23"))
t.append(step("Confirm",
    p(f"If your organisation books follow-ups without approval, the session is booked at once. If an approver decides first, the card says {q('followUp.awaitingApproval')}"),
    "25"))
t.append(step("Or suggest other times",
    p(f"Give up to three windows in the appointment's time zone ({ui('followUp.addWindow')} adds one), then {ui('followUp.sendSuggestions')}."),
    "24"))
t.append(step("Your expert picks one",
    p(f"The card says {q('followUp.timesSuggested')} The status stays {ui('followUp.proposed')} until the expert chooses; then it is booked, or waits for approval."),
    "26"))
t.append(step("Or decline",
    p(f"{ui('followUp.decline')} ends the proposal: {q('followUp.declinedByYou')} Your expert is told and can propose another time."),
    "27", "s"))
t.append(sub("If your organisation approves follow-ups first"))
t.append(step("Waiting for the decision",
    p(f"The appointment shows {ui('appointments.status.awaiting_approval')}. The approver sees only your name, {q('approval.followUpLabel')}, the date and the length. You and your expert are told when they decide."),
    "81"))
t.append(step("Approved",
    p(f"The follow-up becomes an ordinary {ui('appointments.status.confirmed')} appointment. Join it like the first one, from 15 minutes before the start."),
    "84"))
t.append(step("Declined",
    p("The page shows the approver's short reason. Only you see it. Talk to your expert or HR if you still need the session."),
    "85"))
t.append(tip("If nothing happens", ul(
    f"Nobody is assigned to approve for your team: confirming fails with {q('errors.approverMissing')}",
    f"The approver does not decide in time: {q('followUp.approvalExpired')}",
    f"The proposed time passes first: {q('followUp.expired')}",
)))
chapter("followup", 3, "Answer a follow-up proposal",
    "Your expert proposes a date and time; you confirm, suggest other times or decline. Some organisations ask an approver first.",
    "Employee · workspace app", t)

# ---------- 4. Expert ----------
t = begin()
t.append(step("Open your consultations",
    p(f"In the admin app, open {ui('consultations.nav')}. You see only the consultations assigned to you: employee first name, service, time in the appointment's zone, status and outcome."),
    "14"))
t.append(step("Open the consultation, tell the employee if you are late",
    p(f"Inside the join window the page offers {ui('join.button')}. If you are delayed, set the {ui('consultations.runningLateEta')} and {ui('consultations.runningLate')}; the employee sees it in the waiting card. Join runs the same device check as the employee's."),
    "15"))
t.append(step("Your call screen",
    p(f"You have the employee's controls plus {ui('controls.shareScreen')} and {ui('controls.endForEveryone')}. If the employee shared a location, the card {q('consultations.location.title')} shows it. Your crisis panel adds guidance for experts."),
    "16"))
t.append(step("End for everyone",
    p(f"{ui('controls.endForEveryone')} asks {q('controls.endConfirmTitle')} Confirm with {ui('consultation.end')}. The call closes for both of you and the outcome form opens."),
    "17"))
t.append(step("Record the outcome",
    p(f"Choose one: {ui('outcome.status.completed')}, {ui('outcome.status.no_show_employee')}, {ui('outcome.status.no_show_expert')}, {ui('outcome.status.technical_failure')} or {ui('outcome.status.canceled')}, then {ui('outcome.submit')}. There is no notes field: NestSelf stores no professional notes."),
    "21"))
t.append(step("Propose a follow-up",
    p(f"After a completed outcome, pick the {ui('followUp.date')}, {ui('followUp.time')} and {ui('followUp.duration')} and {ui('followUp.send')}. No free text. The card then says {q('followUp.waitingForEmployee')}"),
    "22"))
t.append(tip("If the employee suggests other times",
    p(f"Open the follow-up with {ui('followUp.openFollowUp')}, choose one of their windows under {ui('followUp.pickLabel')} and {ui('followUp.schedule')}. From there it is booked or goes to approval, as when the employee confirms.")))
chapter("expert", 4, "Run a consultation",
    "An expert joins, shares a screen if needed, ends the session, records what happened and proposes a follow-up.",
    "Expert · admin app", t)

# ---------- 5. Approve ----------
t = begin()
t.append(step("Set the policy once",
    p(f"HR opens {nav('followUpPolicy')} in the employer space. Choose {ui('approval.policy.automaticTitle')} (the default) or {ui('approval.policy.managerTitle')}, then {ui('approval.policy.save')}."),
    "80"))
t.append(step("Decide a request",
    p(f"Approvers open {nav('approvals')}. Each request shows the employee's name, {q('approval.followUpLabel')}, the date and time, and the length. Nothing else. Select {ui('approval.approve')} or {ui('approval.reject')}."),
    "82"))
t.append(step("Declining needs a reason",
    p(f"A short {ui('approval.reasonLabel')} is required. Only the employee sees it."),
    "83"))
t.append(tip("Deadlines", ul(
    "The request email goes to the approver and the alternate approver; both can decide. Nobody decides their own follow-up.",
    "After 5 working days without a decision, both receive a reminder.",
    "The request lapses at the earlier of the proposed start and 10 working days. It becomes Expired, and the employee is told.",
)))
chapter("approve", 5, "Approve follow-ups",
    "An organisation can ask an approver to agree before a follow-up is booked. HR sets the policy; the approver for the employee's team decides each request from four facts.",
    "HR and approver · workspace app", t)

# ---------- 6. Attend ----------
t = begin()
t.append(step("Find a webinar",
    p(f"Open {ui('webinar.nav')}. You see the webinars your organisation's audience includes, with the date, the presenters, the places left and the notice {q('webinar.recordingNotice')}"),
    "60"))
t.append(step("Register",
    p(f"Open the webinar and select {ui('webinar.register')}. A confirmation email follows with a private calendar entry; reminders come 24 hours and 1 hour before."),
    "61"))
t.append(step("Come back when it starts",
    p(f"The page shows a countdown and {ui('webinar.join')}, which opens 15 minutes before the start. {ui('webinar.unregister')} gives your place back until then."),
    "62"))
t.append(step("The lobby",
    p(f"{ui('webinar.join')} first asks you to {q('webinar.liveView.prejoinTitle')} (no camera is needed). Then you wait: {q('webinar.liveView.waitingForStart')} You join automatically when the hosts start."),
    "63"))
t.append(step("Watch and listen",
    p(f"You see the presenters and any shared screen, with {ui('webinar.recIndicator')}. Your controls: {ui('webinar.muteSound')}, {ui('webinar.hand.raise')}, {ui('controls.fullscreen')} and {ui('consultation.leave')}. There is no camera button and no list of attendees."),
    "64"))
t.append(step("Write to the hosts",
    p(f"In {ui('webinar.chat.title')}, choose {ui('webinar.chat.kindMessage')} or {ui('webinar.chat.kindQuestion')}, write, and {ui('webinar.chat.send')}. A moderator reviews it before anyone else sees it. Tick {ui('webinar.chat.showFirstName')} to sign it; otherwise it is published as {ui('webinar.chat.participant')}."),
    "66"))
t.append(step("Vote in a poll",
    p(f"When the moderator opens a poll, pick an option and {ui('webinar.poll.vote')}. {q('webinar.poll.anonymous')} Results appear as percentages when the poll closes."),
    "67"))
t.append(sub("Speaking"))
t.append(step("Raise your hand",
    p(f"{ui('webinar.hand.raise')} tells the hosts you would like to speak; {ui('webinar.hand.lower')} takes it back. The moderator sees your name; the presenters only see that a hand is up."),
    "65"))
t.append(step("You have the floor",
    p(f"A dialog says {q('webinar.youCanSpeakNow')} and reminds you that your voice is recorded. Your microphone stays off until you choose {ui('webinar.floorDialog.unmute')}; {ui('webinar.floorDialog.later')} keeps it off. Your camera never turns on."),
    "68"))
t.append(step("Muted by a host, then asked to unmute",
    p(f"A host can mute you while you speak. If they ask you to speak again, you decide: {ui('webinar.unmuteRequest.unmute')} or {ui('webinar.unmuteRequest.stayMuted')}. Nobody can unmute you but you."),
    "78", "s"))
t.append(step("In a large webinar",
    p("Above 250 attendees the audience is spread over linked rooms. When you are given the floor, your microphone is joined to the presenters' room for your turn, sound only. The dialog and controls are the same."),
    "88", "s"))
t.append(step("The end",
    p(f"When the hosts end the webinar you see {q('webinar.liveView.thanksTitle')} and {q('webinar.liveView.replayLater')} The recording goes to NestSelf's content team for review first."),
    "69", "s"))
t.append(step("If a webinar is canceled",
    p(f"You receive an email, and the page says {q('webinar.detail.canceled')} There is nothing to join."),
    "87", "s"))
chapter("attend", 6, "Attend a webinar",
    "A live talk by NestSelf experts. You watch and listen and are never on camera; every webinar is recorded, and only the presenters are on the recording unless you take the floor.",
    "Employee · workspace app", t)

# ---------- 7. Create ----------
t = begin()
t.append(step("Open the webinar list",
    p(f"In the admin app, open {ui('webinar.admin.title')}. Each webinar shows its date, status ({ui('webinar.status.draft')}, {ui('webinar.status.published')}, {ui('webinar.status.live')}, {ui('webinar.status.ended')}, {ui('webinar.status.canceled')}) and capacity. Select {ui('webinar.admin.new')}."),
    "70"))
t.append(step("Fill in the form",
    p(f"Title in at least one language, audience ({ui('webinar.admin.audienceAll')}, {ui('webinar.form.audienceOrganizations')} or {ui('webinar.form.audienceUnits')}), capacity up to 1,000, the presenters, the moderator and the schedule. There is no recording switch: every webinar is recorded. {ui('webinar.form.submit')}."),
    "71"))
t.append(step("Publish",
    p(f"The draft page lists the facts. {ui('webinar.admin.publish')} makes the webinar visible to the eligible employees, who can then register. Publishing needs: {q('webinar.admin.publishNeeds')}"),
    "72"))
t.append(step("Edit a draft or an upcoming webinar",
    p(f"{ui('webinar.admin.edit')} opens the same form. {q('webinar.form.audienceLocked')} {ui('webinar.form.save')}. A live, ended or canceled webinar cannot be changed."),
    "76", "s"))
t.append(step("Cancel",
    p(f"{ui('webinar.admin.cancel')} asks {q('webinar.admin.cancelTitle')} Registered employees are emailed, reminders stop, and it cannot be undone."),
    "86", "s"))
t.append(tip("Capacity", p("Up to 250 attendees share one room. For a larger audience, up to 1,000, the platform adds linked rooms that receive only the presenters; attendees see no difference, and chat, polls and attendance work across them.")))
chapter("create", 7, "Create and publish a webinar",
    "Operations prepare the webinar: title, audience, capacity, presenters, moderator and schedule. Publishing opens registration.",
    "Operations · admin app", t)

# ---------- 8. Live ----------
t = begin()
t.append(step("Presenters open the live view",
    p(f"From the webinar page, {ui('webinar.admin.openLive')} up to 30 minutes before the start. After the device check (with an optional {ui('prejoin.screenShare.test')}), the lobby shows the registered count and {ui('webinar.start')}. Starting also starts the recording."),
    "73", who="Presenter"))
t.append(step("The moderator console",
    p(f"The {ui('webinar.moderation.title')} panel shows attendance, {ui('webinar.recIndicator')} and {ui('webinar.moderation.stopRecording')}. Each raised hand has {ui('webinar.moderation.giveFloor')}. Each message waiting for review can be {ui('webinar.moderation.publish')}ed, edited, answered with {ui('webinar.moderation.answer')}, or {ui('webinar.moderation.dismiss')}ed."),
    "74", who="Moderator"))
t.append(step("While an attendee speaks",
    p(f"The speaker appears under {ui('webinar.moderation.speakingTitle')} with {ui('webinar.moderation.mute')}, {ui('webinar.moderation.askUnmute')} and {ui('webinar.moderation.takeFloor')}. Only the attendee can unmute themselves."),
    "77", "s", who="Moderator"))
t.append(tip("Polls and ending", p(f"Under {ui('webinar.console.pollTitle')}, write a question and two to six options, {ui('webinar.console.pollCreate')}, then {ui('webinar.poll.open')}; {ui('webinar.poll.close')} publishes the results without names. {ui('webinar.endForEveryone')} ends the webinar and the recording; otherwise the room closes 15 minutes after the scheduled end.")))
t.append(step("Stop the recording early",
    p(f"Only the moderator can. {ui('webinar.moderation.stopRecording')} asks {q('webinar.moderation.stopRecordingTitle')} The rest is not recorded and recording cannot be restarted."),
    "75", who="Moderator"))
t.append(step("Afterwards: attendance",
    p(f"The webinar page shows {ui('webinar.admin.attendanceTitle')}: registered, joined and peak counts, then one row per registration without names, and the recording state ({ui('webinar.admin.recordingStatus.processing')}, {ui('webinar.admin.recordingStatus.ready')}, {ui('webinar.admin.recordingStatus.handed_off')} or {ui('webinar.admin.recordingStatus.failed')})."),
    "79", "s", who="Operations"))
chapter("live", 8, "Run a webinar live",
    "Presenters speak and share their screen. The moderator reviews messages, gives the floor, runs polls and can stop the recording.",
    "Presenter and moderator · admin app", t)

# ---------- 9. Operations: book a consultation, look up a call ----------
if have("90") or have("91") or have("93"):
    t = begin()
    if have("90"):
        t.append(step("The operations list",
            p(f"Client operations open {ui('consultations.nav')}: every consultation of the organisations you coordinate, with {ui('consultations.columns.expert')} and {ui('consultations.columns.organisation')} columns and {ui('consultations.filters.title')} by organisation, status and dates."),
            "90"))
    if have("91"):
        t.append(step("Book a consultation",
            p(f"Select {ui('consultations.newConsultation')}. Choose the {ui('create.organisation')}, the {ui('create.employee')}, the {ui('create.category')} and the {ui('create.expert')}, then the {ui('create.date')}, {ui('create.start')} and {ui('create.end')} in Europe/Belgrade. {ui('create.submit')}. Reminders are scheduled at once."),
            "91"))
    if have("92"):
        t.append(step("Cancel a consultation",
            p(f"On the consultation page, {ui('cancel.button')} asks {q('cancel.title')} Both participants receive an email, and a call that is already running closes."),
            "92"))
    if have("93"):
        t.append(step("Look up a call for support",
            p(f"Support operators open {ui('supportCalls.nav')}, enter the {ui('supportCalls.sessionId')} and {ui('supportCalls.lookup')}. The page shows the session's status and times and, per participant, join and leave times, reconnections, quality, error codes, browser and operating system. Never names or content. {ui('supportCalls.reportsTitle')} lists the technical reports people sent."),
            "93"))
    chapter("ops", 9, "Book a consultation and look up a call",
        "NestSelf operations book consultations for client companies; support operators look into technical problems from connection data, never from content.",
        "Operations and support · admin app", t)

# ---------- 10. Good to know ----------
chapter("know", 10, "Good to know",
    "",
    "For everyone.",
    [
        cards(
            card("Recording", ul(
                "Webinars: always, from start to end, unless the moderator stops it early. Attendees are told at registration, in the email, in the lobby and before they unmute.",
                "On the recording: the presenters' video, sound and shared screen, and the voice of an attendee who took the floor. No attendee is ever seen.",
                "Consultations: never. There is no recording control.",
            )),
            card("Never stored", ul(
                "Professional notes: the outcome form has no notes field.",
                "What was said in a consultation: no recording, no chat.",
                "Who voted for what in a poll; names or device names in technical reports.",
                "Quick signals such as “I cannot hear you”: gone when the session ends.",
            )),
            card("What your employer sees", ul(
                "Nothing about your consultations: not that you booked, joined or missed one, not its topic, outcome, feedback or length.",
                "Nothing about which webinars you attended or what you wrote in them.",
                "If your organisation approves follow-ups: your name, “Follow-up session with a NestSelf expert”, the date and the length. That is all.",
            ), "tinted"),
            card("How long data is kept", ul(
                "Appointments, sessions, outcomes and approval requests: 7 years.",
                "Connection diagnostics and technical reports: 90 days.",
                "Webinar messages and polls: 12 months. Feedback and registrations: 24 months.",
                "Raw recording pieces: 30 days. A shared location: deleted when the session ends.",
            ) + p("Defaults until the data protection assessment confirms them. Calls run in the Frankfurt region; the video service receives random ids, never names.")),
        ),
    ], kind="Reference")

# ---------- screens the steps did not place ----------
extra = [n for n in sorted(SCREENS) if n not in USED and have(n)]
if extra:
    more = begin()
    for n in extra:
        sc = SCREENS[n]
        more.append(step(f"Screen {n}", p(html.escape(sc["state"] or sc["step"])), n))
    chapter("more", 11, "More screens", "Screens captured after this guide's text was written, with the description from the screenshot index.", "From manual/screenshots/INDEX.md.", more, kind="Appendix")

EXTRA_CSS = """
.page { padding-bottom: 18mm; }
.flow-body { flex: 1 1 auto; min-height: 0; }
.flow-body > .blk + .blk { margin-top: 6mm; }
.flow-body > .blk.sub + .blk { margin-top: 3mm; }
.flow-body > .blk.lead-blk + .blk { margin-top: 5mm; }
.flow-body > .blk.tip + .blk, .flow-body > .blk + .blk.tip { margin-top: 5mm; }
.run-head { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; font-size: 8pt; color: var(--color-text-secondary); padding-bottom: 2.4mm; margin-bottom: 6mm; border-bottom: 1px solid var(--color-border-subtle); }
.run-head .ch { color: var(--color-primary); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.page-head h2 { max-width: 34ch; }
.page-head .meta { max-width: 56mm; }
.lead { max-width: 76ch; }
.blk p, .blk li { font-size: 9.5pt; line-height: 1.5; }
.blk p + p, .blk p + ul, .blk ul + p { margin-top: 1.4mm; }
.blk ul { margin-top: 0.8mm; }
.blk li + li { margin-top: 0.7mm; }
.step-head { display: grid; grid-template-columns: 8mm 1fr; gap: 3.5mm; align-items: start; }
.step-no { display: inline-flex; align-items: center; justify-content: center; width: 8mm; height: 8mm; border-radius: 999px; background: var(--color-primary); color: var(--color-on-primary, #fff); font-size: 10.5pt; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 0.3mm; }
.step-head h3 { font-size: 12.5pt; font-weight: 600; line-height: 1.3; margin-bottom: 1.2mm; display: flex; align-items: baseline; gap: 2.5mm; flex-wrap: wrap; }
.step-head h3 .who { font-size: 7.5pt; font-weight: 600; }
.step-head p { max-width: 150mm; }
.sub-title { font-size: 14pt; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; color: var(--color-text-secondary); }
.ui { font-weight: 600; color: var(--color-primary); }
.q { color: var(--color-text); }
.shot { width: fit-content; max-width: 100%; margin: 3mm 0 0 11.5mm; --shot-h: 66mm; }
.shot.s { --shot-h: 56mm; }
.shot.single { --shot-h: 92mm; margin: 0; }
.shot .imgs { display: flex; gap: 5mm; justify-content: flex-start; align-items: flex-start; }
.shot img { display: block; height: var(--shot-h); width: auto; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-surface); }
.shot figcaption { margin-top: 1.6mm; font-size: 7.8pt; line-height: 1.3; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.side { display: grid; grid-template-columns: 1fr auto; gap: 8mm; align-items: start; }
.pending { width: 120mm; height: var(--shot-h); display: flex; flex-direction: column; justify-content: center; gap: 1.5mm; padding: 6mm; border: 1px dashed var(--color-border-control); border-radius: var(--radius-control); background: var(--color-surface); font-size: 9pt; color: var(--color-text-secondary); }
.pending strong { color: var(--color-warning); }
.tip .callout { margin-left: 11.5mm; max-width: 160mm; }
.tip .callout strong { display: block; margin-bottom: 0.8mm; }
.tip .callout p, .tip .callout li { font-size: 9pt; line-height: 1.45; }
.cards .card p, .cards .card li { font-size: 9.2pt; line-height: 1.48; }
.cards .card h3 { font-size: 11pt; }
.cards .grid { gap: 5mm; }
.toc-title { font-size: 11pt; margin-bottom: 1mm; }
.toc li { padding: 2.1mm 0; }
.cover .cover-note { margin-top: 10mm; font-size: 9pt; line-height: 1.45; color: rgb(255 255 255 / 82%); max-width: 120mm; }
.cover .cover-meta { grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 178mm; }
"""

PAGINATOR = r"""
<script>
(async function () {
  if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
  await document.fonts.ready;
  const FOOT = %(foot)s;
  const footer = '<div class="page-footer"><span>' + FOOT + '</span><span class="num"></span></div>';
  function makePage(src, first) {
    const sec = document.createElement('section');
    sec.className = 'page';
    sec.dataset.part = src.dataset.part;
    const n = src.dataset.number;
    const kind = src.dataset.kind;
    const label = kind === 'Tutorial' ? kind + ' ' + n : kind;
    const head = first
      ? '<div class="page-head"><div><span class="eyebrow">' + label + '</span><h2>' + src.dataset.title + '</h2></div><div class="meta">' + src.dataset.meta + '</div></div>'
      : '<div class="run-head"><span class="ch">' + label + ' · ' + src.dataset.title + '</span><span>' + src.dataset.meta + '</span></div>';
    sec.innerHTML = head + '<div class="flow-body"></div>' + footer;
    src.parentNode.insertBefore(sec, src);
    return { sec, body: sec.querySelector('.flow-body') };
  }
  const fits = (sec, body) => {
    if (sec.scrollWidth > sec.clientWidth + 1) return false;
    const limit = sec.getBoundingClientRect().top + sec.clientHeight - parseFloat(getComputedStyle(sec).paddingBottom) - 2;
    const last = body.lastElementChild;
    return !last || last.getBoundingClientRect().bottom <= limit;
  };
  for (const src of Array.from(document.querySelectorAll('.flow-source'))) {
    let cur = makePage(src, true);
    for (const item of Array.from(src.children)) {
      cur.body.appendChild(item);
      if (fits(cur.sec, cur.body)) continue;
      cur.body.removeChild(item);
      const carry = [];
      while (cur.body.lastElementChild && cur.body.lastElementChild.classList.contains('kwn')) carry.unshift(cur.body.removeChild(cur.body.lastElementChild));
      if (cur.body.children.length === 0 && carry.length === 0) { cur.body.appendChild(item); continue; }
      if (cur.body.children.length === 0) { for (const c of carry) cur.body.appendChild(c); cur.body.appendChild(item); continue; }
      cur = makePage(src, false);
      for (const c of carry) cur.body.appendChild(c);
      cur.body.appendChild(item);
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

toc_html = blk('<h3 class="toc-title">Tutorials</h3><ol class="toc">' + "".join(
    f'<li data-part="{part}"><span>{html.escape(title)}</span><span class="pg"></span></li>'
    for part, _n, title, kind in CHAPTERS if kind != "Start") + "</ol>", "toc-blk")
PARTS = [part.replace("__TOC__", toc_html) for part in PARTS]

doc = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>NestSelf consultations and webinars, step-by-step guide</title>'
       '<link rel="stylesheet" href="../pdf/styles.css"><style>' + EXTRA_CSS + '</style></head><body>\n'
       + "".join(PARTS) + PAGINATOR % {"foot": repr(FOOT)} + "</body></html>\n")

for bad in ("—", " – "):
    if bad in re.sub(r"<[^>]+>", "", doc):
        raise SystemExit(f"dash {bad!r} found in the manual text")

OUT.write_text(doc, encoding="utf-8")
unused_files = sorted(set(ON_DISK) - set(SHOTS_USED))
print(f"wrote {OUT.relative_to(REPO)}: {len(CHAPTERS)} chapters, {len(set(SHOTS_USED))} screenshot files of {len(ON_DISK)} on disk, {len(USED)} screens placed")
if PENDING:
    print("pending screens (no files): " + ", ".join(sorted(set(PENDING))))
if NOT_CAPTURED:
    print("INDEX lists as not captured: " + " | ".join(NOT_CAPTURED))
if unused_files:
    print("WARNING screenshot files not in the manual: " + ", ".join(unused_files))
