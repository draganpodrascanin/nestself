#!/usr/bin/env python3
"""Build the user manual HTML for docs/tasks/calls-webinars (epic NS-CALLS-01).

Usage:
  python3 docs/tasks/calls-webinars/manual/make-manual-html.py [docs/tasks/calls-webinars]

Writes manual/user-manual.html next to this script. The page reuses ../pdf/styles.css
(tokens, Onest) and adds the manual's own rules inline, on the same tokens. An in-page
paginator packs the blocks of each chapter into fixed A4 sheets; ../pdf/build-pdf.mjs
renders it and refuses to write when a sheet overflows.

Every on-screen word quoted in the manual is read from the English catalog
(packages/i18n/locales/en/calls.json and common.json) by key, so a renamed button or
message fails the build instead of going stale. The screenshots and their facts come
from manual/screenshots/INDEX.md; a screen the prose does not place is added to a
closing "More screens" chapter, and a planned screen without files shows as pending.
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

FOOT = "NestSelf · Consultations and webinars · User manual"


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


def figure(num: str, role: str, caption: str, size: str = "") -> str:
    USED.add(num)
    desktop, mobile = files_for(num)
    alt = html.escape(f"{role}: {re.sub('<[^>]+>', '', caption)}", quote=True)
    imgs = []
    if desktop:
        imgs.append(f'<img class="d" src="screenshots/{desktop}" width="1280" height="800" alt="{alt} (desktop)">')
        SHOTS_USED.append(desktop)
    if mobile:
        imgs.append(f'<img class="m" src="screenshots/{mobile}" width="390" height="844" alt="{alt} (mobile)">')
        SHOTS_USED.append(mobile)
    if not imgs:
        PENDING.append(num)
        imgs.append(f'<div class="pending"><strong>Screenshot pending</strong>Screen {num} is planned and not captured yet. The step is described in the text above.</div>')
    which = "desktop and mobile" if desktop and mobile else ("desktop" if desktop else ("mobile" if mobile else "pending"))
    return (
        f'<figure class="shot {size}"><div class="imgs">{"".join(imgs)}</div>'
        f'<figcaption><span class="pill soft">{role}</span><span class="cap">{caption}</span>'
        f'<span class="ref">Screen {num}, {which}</span></figcaption></figure>'
    )


# ---------- blocks ----------
def blk(inner: str, cls: str = "") -> str:
    return f'<div class="blk {cls}">{inner}</div>'


def sub(number: str, title: str, intro: str = "") -> str:
    """A section heading inside a chapter; it never ends a page on its own."""
    extra = f'<p class="sub-intro">{intro}</p>' if intro else ""
    return blk(f'<span class="eyebrow">{number}</span><h2 class="sub-title">{title}</h2>{extra}', "sub kwn")


def step(title: str, body: str, num: str, role: str, caption: str, size: str = "") -> str:
    return blk(f"<h3>{title}</h3>{body}{figure(num, role, caption, size)}", "step")


def side(title: str, body: str, num: str, role: str, caption: str) -> str:
    """A step with one phone screen beside the text (a mobile-only screen)."""
    USED.add(num)
    desktop, mobile = files_for(num)
    if desktop:  # both exist after all: use the normal layout
        return step(title, body, num, role, caption)
    return blk(f'<div class="side"><div><h3>{title}</h3>{body}</div>{figure(num, role, caption, "single")}</div>', "step")


def prose(inner: str, cls: str = "") -> str:
    return blk(inner, f"prose {cls}")


def cards(*items: str, cols: int = 2) -> str:
    return blk(f'<div class="grid cols-{cols}">{"".join(items)}</div>', "cards")


def card(title: str, body: str, cls: str = "") -> str:
    return f'<div class="card {cls}"><h3>{title}</h3>{body}</div>'


def ul(*items: str) -> str:
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def p(text: str) -> str:
    return f"<p>{text}</p>"


CHAPTERS = []


def chapter(part: str, number: int, title: str, lead: str, meta: str, blocks: list, run: str = "") -> None:
    CHAPTERS.append((part, number, title))
    attrs = (
        f'data-part="{part}" data-number="{number}" data-title="{html.escape(title, quote=True)}" '
        f'data-meta="{html.escape(meta, quote=True)}" data-run="{html.escape(run or title, quote=True)}"'
    )
    lead_html = blk(f'<p class="lead">{lead}</p>', "lead-blk") if lead else ""
    PARTS.append(f'<div class="flow-source" {attrs}>{lead_html}{"".join(blocks)}</div>\n')


PARTS = []

# Roles as they appear in captions.
EMP = "Employee · workspace app"
EXP = "Expert · admin app"
HR = "HR and approver · workspace app"
OPS = "Operations, moderator · admin app"
PRES = "Expert as presenter · admin app"

T_HHMM = "HH:MM"
T_DATE = "DATE"

# ---------- cover ----------
PARTS.append(f'''<section class="page cover" data-part="cover">
  <div class="cover-art-wrap"><svg class="cover-art" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="0.5" aria-hidden="true"><circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="38"/><circle cx="50" cy="50" r="28"/><circle cx="50" cy="50" r="18"/><circle cx="50" cy="50" r="8"/></svg></div>
  <div class="cover-inner">
    <div class="wordmark">nestself</div>
    <h1>Consultations and webinars</h1>
    <p class="subtitle">User manual. Private video sessions with a NestSelf expert, follow-ups and their approval, and webinars for employees of client companies, screen by screen.</p>
    <div class="cover-meta">
      <div><strong>Epic NS-CALLS-01</strong>Edition of 30 October 2026</div>
      <div><strong>Readers</strong>Employees, experts, HR and approvers, NestSelf operations</div>
      <div><strong>Screens</strong>From the sample environment, fictional people</div>
    </div>
    <p class="cover-note">This edition is in English. The product ships in Serbian (Latin), Serbian (Cyrillic) and Hungarian as well as English; a Serbian edition is the same build with the sr-Latn locale.</p>
  </div>
</section>
''')

# ---------- 1. How to use this manual ----------
chapter("start", 1, "How to use this manual",
    "This manual explains the video consultations and webinars of NestSelf as each person meets them: what you see, what each button does, and what NestSelf keeps private. Read the chapter for your role; the last three chapters are for everyone.",
    "Four audiences, two web apps. Screens from the sample environment.",
    [
        cards(
            card("Employees", p("You use the <strong>workspace app</strong>. Chapter 2 follows a consultation from the appointment list to the follow-up; chapter 5 covers webinars."), "tinted"),
            card("Experts", p("You use the <strong>admin app</strong>. Chapter 3 covers your consultations, the outcome and the follow-up; chapter 6 covers presenting a webinar."), "tinted"),
            card("HR and approvers", p("You use the <strong>workspace app</strong>, in the employer space. Chapter 4 covers the follow-up approval policy and deciding requests."), "tinted"),
            card("NestSelf operations and support", p("You use the <strong>admin app</strong>. Chapter 6 covers creating and moderating webinars; chapter 7 covers booking consultations and call diagnostics."), "tinted"),
        ),
        cards(
            card("About the screenshots", p("Every screenshot comes from the sample environment: both web apps ran against the NestSelf API with a test database of fictional sample people, and a stand-in replaced the video service. The other person's video is a drawing labelled “Sample video”, and the camera preview is the browser's test pattern. The people are fictional: Jovan Petrović (employee), Milica Ristić (expert), Ivana Jovanović (HR and approver) and Nikola Đorđević (operations and webinar moderator). No real personal data appears.")
                 + p("Each screen is shown on a computer (1280 by 800, left) and on a phone (390 by 844, right). The screen numbers match the files in <code>manual/screenshots/</code>. Lists in the screenshots may hold several similar entries that the test runs created.")),
            card("How the text is written", p("Buttons, fields and menu entries are in bold green, for example " + ui("join.button") + ". Messages the app shows are in quotes, for example " + q("consultation.fiveMinutesRemaining") + " Both are copied from the app's English wording.")
                 + p("Times are always shown in the time zone of the appointment or webinar, Europe/Belgrade in the screenshots. Where a message contains a time or a date, this manual writes HH:MM or DATE.")
                 + p("The product ships in Serbian (Latin), Serbian (Cyrillic) and Hungarian as well as English, and every screen works the same in each language. A Serbian edition of this manual is the same build with the sr-Latn locale.")),
        ),
        blk('<h3 class="toc-title">Contents</h3><ol class="toc">' + "".join(
            f'<li data-part="{p_}"><span>{t_}</span><span class="pg"></span></li>' for p_, t_ in [
                ("start", "How to use this manual"),
                ("employees", "Employees: your consultations"),
                ("experts", "Experts: running a consultation"),
                ("approvers", "HR and approvers: follow-up approval"),
                ("webinars", "Webinars for employees"),
                ("hosts", "Presenters and moderators"),
                ("operations", "Operations and support"),
                ("privacy", "Privacy and recording in one page"),
                ("limits", "Known limitations and what comes next"),
            ]) + "</ol>", "toc-blk"),
    ])

# ---------- 2. Employees ----------
emp = []
emp.append(sub("2.1", "Your appointments"))
emp.append(step("The appointment list",
    p(f"Open {nav('appointments')} in the menu. {ui('appointments.upcoming')} lists the sessions to come, the earliest first; {ui('appointments.past')} lists the ones that are over. Each row shows the date and time, the service and your expert's first name. A badge shows the status: {ui('appointments.status.confirmed')}, {ui('appointments.status.awaiting_approval')}, {ui('appointments.status.completed')}, {ui('appointments.status.canceled')}, {ui('appointments.status.declined')}, {ui('appointments.status.no_show')}, or {ui('followUp.proposed')} when your expert proposed another session. Select a row to open it.")
    + p(f"Before each session you receive an email 24 hours and 1 hour ahead. Its subject is always {q('email.reminderSubject')} and its calendar entry is private, so nothing on a lock screen says what the session is about. If you are in the app at that moment, a short notice says {q('reminder.toast', time=T_HHMM)}"),
    "01", EMP, "Upcoming and past appointments with their status badges."))

emp.append(sub("2.2", "Before the session: the join window",
    "Joining opens 15 minutes before the start. The first join is possible until 10 minutes after the start; if you already joined and dropped out, you can rejoin until the room closes, 15 minutes after the scheduled end."))
emp.append(step("Before the window opens",
    p(f"The appointment page shows your expert, the date, the time, the service and the status. Until the window opens, the button reads {ui('join.comeBackAt', time=T_HHMM)} and cannot be selected, with the hint {q('join.opensHint', minutes=15)}")
    + p(f"You can cancel here. {ui('cancel.button')} asks {q('cancel.title')} first, and a canceled appointment cannot be restored."),
    "02", EMP, f"Appointment detail before the join window: {ui('join.comeBackAt', time='16:45')} is disabled."))
emp.append(step("When the window is open",
    p(f"From 15 minutes before the start, {ui('join.button')} is active. Select it to check your devices. If you open the page after the start, it says {q('join.lateJoin', time=T_HHMM)} The timer then counts only the time that remains.")
    + p(f"If you already joined and lost the call, the page offers {ui('join.rejoin')} and says {q('join.rejoinHint', time=T_HHMM)}"),
    "03", EMP, f"Appointment detail inside the join window: {ui('join.button')} is enabled."))
emp.append(step("When the window has closed",
    p(f"If you come too late for the first join, the page says {q('join.windowClosed')} and shows a link to technical support instead of the button. You also receive an email asking whether a technical problem kept you away, with a link to report it."),
    "28", EMP, "Join window closed: the message and the technical support link.", "s"))
emp.append(step("If the server refuses the join",
    p(f"The server checks the window again when you select {ui('prejoin.joinNow')}. If it has closed in the meantime, the device check shows {q('errors.joinWindowClosed')}"),
    "29", EMP, "The join was refused because the window had closed.", "s"))

emp.append(sub("2.3", "Checking your devices",
    "Every call starts with a short device check. You join only when your microphone works."))
emp.append(step("The device check",
    p(f"The page {q('prejoin.title')} checks your {ui('prejoin.camera')}, {ui('prejoin.microphone')}, {ui('prejoin.speaker')} and {ui('prejoin.network')}. Each shows {ui('prejoin.status.passed')}, {ui('prejoin.status.denied')} or {ui('prejoin.status.failed')}. Speak and watch the microphone bar move; select {ui('prejoin.speakerTest')} and answer {q('prejoin.speakerQuestion')} Choose another camera, microphone or speaker from the three lists if needed. The connection reads {ui('prejoin.networkStatus.good')}, {ui('prejoin.networkStatus.degraded')}, {ui('prejoin.networkStatus.poor')} or {ui('prejoin.networkStatus.offline')}.")
    + p(f"If the browser blocks the camera or microphone, a box titled {q('prejoin.permissionDeniedTitle')} explains what to do in your browser; then select {ui('prejoin.checkAgain')}. {ui('prejoin.joinNow')} stays disabled until the microphone is allowed.")
    + p(f"For a psychological consultation the page first offers an optional field, {ui('location.label')}: {q('location.prompt')} {q('location.hint')} It sits above the check, outside the screenshot."),
    "04", EMP, "Device check passed: preview, microphone level, speaker test, connection Good."))
emp.append(step("Camera off and background blur",
    p(f"Switch on {ui('prejoin.cameraOff')} to join without video; the preview shows {q('prejoin.previewOff')} and the hint {q('prejoin.cameraOffHint')} Switch on {ui('prejoin.blur')} to blur the room behind you: {q('prejoin.blurHint')} Both choices are optional and are remembered on this device for your next session. Some browsers cannot blur: {q('prejoin.blurUnavailable')}"),
    "05", EMP, f"{ui('prejoin.cameraOff')} switched on; the blur switch beside it."))

emp.append(sub("2.4", "Waiting for your expert"))
emp.append(step("The waiting card",
    p(f"After {ui('prejoin.joinNow')} you are in the call. If your expert has not joined yet, the stage says {q('consultation.waiting')} and a card shows {q('waiting.expertSoonNamed', name='Milica')}, the scheduled time and three tips under {q('waiting.tipsTitle')}.")
    + p(f"If your expert is running late, the card says so: {q('waiting.runningLateEta_other', count=5)} or {q('waiting.runningLate')} You do not need to do anything; the call starts when the expert joins."),
    "06", EMP, "In the call before the expert arrives: the waiting card with tips."))

emp.append(sub("2.5", "During the call"))
emp.append(step("The call screen",
    p(f"Your expert fills the screen and your own video sits in a corner. Move it with {q('stage.moveSelfView')} or hide it; hidden, it says {q('stage.selfViewHidden')} At the top: the timer with time elapsed and time left, the connection badge, and {ui('crisis.open')}.")
    + p(f"The control bar: {ui('controls.mute')}, {ui('controls.cameraOff')}, {ui('controls.blurOn')}, {ui('controls.devices')}, {ui('controls.fullscreen')}, {ui('controls.cannotHear')}, {ui('controls.cannotSee')} and {ui('consultation.leave')}. Every control works with the keyboard. A consultation has no chat and is never recorded, so no recording control or sign appears."),
    "07", EMP, "In the call with the expert present: timer, connection badge, crisis resources, controls."))
emp.append(side("On a phone, and the quick signals",
    p(f"On a phone the video fills the screen and the bar keeps the main controls. {ui('controls.more')} opens the rest: blur, full screen, {ui('controls.cannotHear')} and {ui('controls.cannotSee')}.")
    + p(f"{ui('controls.cannotHear')} sends a short notice instead of a chat message. The other person sees {q('signals.cannotHear')} The notice is not kept after the session. {ui('controls.cannotSee')} works the same way."),
    "08", EMP, f"At phone width the secondary controls sit under {ui('controls.more')}."))

emp.append(sub("2.6", "Your connection",
    f"The badge shows {ui('connection.good')}, {ui('connection.degraded')} or {ui('connection.poor')}, measured every 30 seconds. On a weak connection the app protects the sound: it lowers your video first, then pauses it."))
emp.append(step("An unstable connection",
    p(f"When the connection weakens, the badge turns yellow and a banner says {q('connection.degradedBanner')} If it gets worse: {q('connection.poorBanner')} You can keep talking."),
    "10", EMP, f"{ui('connection.degraded')}: the yellow badge and its banner."))
emp.append(step("Video paused, audio continues",
    p(f"After two poor measurements your outgoing video pauses and the banner says {q('connection.videoPaused')} When the connection recovers, your video comes back by itself and the banner disappears."),
    "11", EMP, "Degraded mode: the red badge, outgoing video paused."))
emp.append(step("Connection lost",
    p(f"If the connection drops, the app shows {q('connection.reconnecting')} and tries for up to two minutes. If that fails, it shows {q('stage.reconnectFailedTitle')} and {q('stage.reconnectFailedBody')} with {ui('stage.rejoin')} and {ui('stage.contactSupport')}. Rejoining puts you back into the same session while the room is open."),
    "09", EMP, "Connection lost: the reconnecting notice under the badge."))

emp.append(sub("2.7", "Crisis resources"))
emp.append(step("Help is one tap away",
    p(f"{ui('crisis.open')} stays at the top of the screen for the whole call. It opens {q('crisis.title')} with {q('crisis.body')} The list is for Serbia: {s('crisis.lines.emergency')} 112, {s('crisis.lines.ambulance')} 194, and {s('crisis.lines.centarSrce')} 0800 300 303. On a phone, each number can be called directly. The panel ends with {q('crisis.disclaimer')}")
    + p("Opening the panel does not leave or mute the call. Close it with the cross."),
    "12", EMP, "Crisis resources open over the running call."))

emp.append(sub("2.8", "Time remaining and leaving"))
emp.append(step("The five-minute cue",
    p(f"The timer shows the time elapsed and the time left. Five minutes before the end, {q('consultation.fiveMinutesRemaining')} appears; dismiss it with the cross. At the scheduled end the timer says {q('timer.timeEnded')} Ten minutes later: {q('timer.roomClosing_other', count=5)} The room closes 15 minutes after the scheduled end and the call stops for both of you."),
    "13", EMP, f"The {q('consultation.fiveMinutesRemaining')} cue beside the timer."))
emp.append(step("When the session ends",
    p(f"When your expert ends the session, the stage says {q('consultation.sessionEnded')} for five seconds, then the post-call screen opens. You can leave at any time with {ui('consultation.leave')}; this does not end the session for your expert, and your screen then says {q('postCall.left')}."),
    "18", EMP, "The expert ended the session: the notice before the post-call screen."))

emp.append(sub("2.9", "After the call"))
emp.append(step("Private feedback",
    p(f"The post-call screen asks {q('feedback.title')} Choose a rating from 1 to 5 and add a comment if you like. The screen says {q('feedback.privacy')} Select {ui('feedback.submit')}, or {ui('feedback.skip')} to send nothing. NestSelf reads feedback only in aggregate."),
    "19", EMP, "Post-call screen: rating, optional comment, Skip."))
emp.append(step("Reporting a technical problem",
    p(f"If something went wrong, select {ui('report.open')}. Choose what went wrong ({ui('report.categories.audio')}, {ui('report.categories.video')}, {ui('report.categories.connection')} or {ui('report.categories.other')}). Under {q('report.attached')} the dialog lists exactly what is sent: call length, reconnections, connection quality, browser and operating system. {q('report.body')}")
    + p(f"After {ui('report.send')}: {q('report.sent')}"),
    "20", EMP, "The report dialog lists the details that are sent."))

emp.append(sub("2.10", "Follow-up proposals",
    f"After the call your expert can propose another session. It reaches you on the post-call screen, in an email titled {q('email.followUpProposedSubject')} and on the appointment page and list, so you do not miss it if you already left. You decide."))
emp.append(step("A proposal arrives",
    p(f"The card {q('followUp.employeeTitle')} shows the date, the time and the length, and says {q('followUp.employeeNote')} Choose {ui('followUp.confirm')}, {ui('followUp.suggestTimes')} or {ui('followUp.decline')}."),
    "23", EMP, "The proposal on the post-call screen."))
emp.append(step("Suggesting other times",
    p(f"{ui('followUp.suggestTimes')} opens {q('followUp.suggestTitle')}. Fill in a date with a start and an end ({ui('followUp.from')} and {ui('followUp.to')}); {ui('followUp.addWindow')} adds a second and a third option. Times are in the appointment's time zone. Select {ui('followUp.sendSuggestions')}. A time in the past is refused with {q('followUp.errors.past')}"),
    "24", EMP, "Up to three time windows in the appointment's time zone."))
emp.append(step("After you suggested times",
    p(f"The card says {q('followUp.timesSuggested')} The status stays {ui('followUp.proposed')} until the expert picks one; the session then starts at the beginning of the time chosen and keeps its length. After that it is booked, or it waits for approval, as below."),
    "26", EMP, "Other times sent from the appointment page."))
emp.append(step("Confirming",
    p(f"What {ui('followUp.confirm')} does depends on your organisation. If follow-ups need no approval, the session is booked at once: {q('followUp.confirmedBody', date=T_DATE, time=T_HHMM)} Reminders follow as for any appointment. If your organisation approves follow-ups first, the card shows {q('followUp.awaitingApproval')} and {q('followUp.awaitingApprovalBody')}"),
    "25", EMP, "Confirmed under an approval policy: waiting for approval."))
emp.append(prose(
    "<h3>What “Waiting for approval” means</h3>"
    + p("Some organisations ask an approver to agree before a follow-up is booked. The approver sees only your name, that it is a follow-up session with a NestSelf expert, the date and the length. They never see the service, the topic, your expert or anything said in the session.")
    + ul(
        f"If nobody is assigned to approve for your team, confirming fails with {q('errors.approverMissing')}",
        f"If the approver does not decide in time, the request lapses: {q('followUp.approvalExpired')}",
        f"If the proposed time passes before you answer: {q('followUp.expired')}",
    )))
emp.append(step("Waiting for the decision",
    p(f"The appointment page shows the status {ui('appointments.status.awaiting_approval')} and the same sentence. You and your expert are both told when the approver decides."),
    "81", EMP, "The follow-up waits for the approver's decision."))
emp.append(step("Approved",
    p(f"An approved follow-up is an ordinary {ui('appointments.status.confirmed')} appointment: you join it like the first one, from 15 minutes before the start."),
    "84", EMP, "The approved follow-up is confirmed."))
emp.append(step("Declined by the approver",
    p(f"If the approver declines, the page shows their short reason: {q('followUp.approvalRejected', reason='Please book it after the team planning week.')} Only you see the reason. Talk to your expert or HR if you still need the session."),
    "85", EMP, "Declined by the approver, with the reason only the employee sees."))
emp.append(step("Declining yourself",
    p(f"{ui('followUp.decline')} ends the proposal; the card says {q('followUp.declinedByYou')} Your expert is told and can propose another time."),
    "27", EMP, "The employee declined the proposal.", "s"))

emp.append(sub("2.11", "What your employer can and cannot see"))
emp.append(cards(
    card("Your employer cannot see", ul(
        "that you booked, joined or missed a consultation;",
        "its service or topic, its outcome or its length;",
        "your feedback, your technical reports or the location you shared;",
        "which webinars you registered for or attended, or what you wrote in them.",
    ) + p("This applies to every employer account: owners, HR, managers and reporting users. The server refuses these records to them on every route; hiding a button is not what protects you."), "tinted"),
    card("What your employer can see", ul(
        "If your organisation requires approval, the approver sees your name, “Follow-up session with a NestSelf expert”, the date and the length, and nothing else.",
        "Any number about calls or webinars shown to an employer in the future must count at least five people. No such number exists yet.",
        f"Emails and calendar entries are neutral: {q('email.reminderSubject')} or {q('email.registrationSubject')}, with a private calendar entry.",
    )),
))
chapter("employees", 2, "Employees: your consultations",
    "You meet a NestSelf expert in a private video session in the workspace app. Only the two of you are in the room, and the session is not recorded. This chapter follows one consultation from the appointment list to the follow-up.",
    "Workspace app. Signed in as the sample employee, Jovan Petrović.", emp, "Employees: your consultations")

# ---------- 3. Experts ----------
ex = []
ex.append(step("Your consultations",
    p(f"Open {ui('consultations.nav')}. {ui('consultations.upcoming')} comes first, then {ui('consultations.past')}; you see only the consultations you are assigned to. The columns are {ui('consultations.columns.employee')} (first name only), {ui('consultations.columns.service')}, {ui('consultations.columns.time')} in each appointment's time zone, {ui('consultations.columns.status')} and {ui('consultations.columns.outcome')}: {ui('consultations.outcomeColumn.notYet')}, {ui('consultations.outcomeColumn.toRecord')}, {ui('consultations.outcomeColumn.completed')}, {ui('consultations.outcomeColumn.no_show')} or {ui('consultations.outcomeColumn.canceled')}. Select the employee's name to open a consultation."),
    "14", EXP, "The expert's consultations, upcoming first."))
ex.append(step("Before you join: running late",
    p(f"The consultation page lists the participants, the date, the time, the outcome and the status. Inside the join window it offers {ui('join.button')} and, if you are delayed, {ui('consultations.runningLateEta')} with {ui('consultations.runningLate')}. The employee sees the delay in the waiting card, and you see {q('consultations.runningLateSent')}")
    + p(f"{ui('join.button')} opens the same device check as the employee's: camera, microphone, speaker and connection, with camera off and blur. Joining is possible from 15 minutes before the start."),
    "15", EXP, "Consultation detail inside the join window: Join and the running-late signal."))
ex.append(step("Your call screen",
    p(f"Your call has the employee's controls plus two of your own: {ui('controls.shareScreen')} and {ui('controls.endForEveryone')}. While you share, you see {q('controls.sharingIndicator')} and the employee sees your screen in the main view; {ui('controls.stopSharing')} ends it. Only you can share.")
    + p(f"If the employee shared a location, the card {q('consultations.location.title')} shows it, with {q('consultations.location.hint')} Otherwise it says {q('consultations.location.none')} Your {ui('crisis.open')} adds {q('crisis.expertTitle')}: stay in the call, ask where they are, and call 112 from another phone. Your five-minute cue adds {q('timer.followUpHint')}"),
    "16", EXP, "The expert's call: shared location, screen sharing, End for everyone."))
ex.append(step("Ending for everyone",
    p(f"{ui('controls.endForEveryone')} asks {q('controls.endConfirmTitle')} {q('controls.endConfirmBody')} Choose {ui('controls.keepTalking')} or {ui('consultation.end')}. The call closes for both of you, and the outcome form opens."),
    "17", EXP, "The confirmation before the call closes for both."))
ex.append(step("Recording the outcome",
    p(f"{q('outcome.title')} asks for one choice: {ui('outcome.status.completed')}, {ui('outcome.status.no_show_employee')}, {ui('outcome.status.no_show_expert')}, {ui('outcome.status.technical_failure')} or {ui('outcome.status.canceled')}. Select {ui('outcome.submit')}. If you closed the form, {ui('consultations.recordOutcome')} on the page opens it again.")
    + p(f"There is no notes field, by design: {q('outcome.description')} NestSelf does not store professional notes, and the server refuses a note if one is sent. Only the delivery status and the connection data are kept."),
    "21", EXP, "The outcome dialog: five statuses, no notes."))
ex.append(step("Proposing a follow-up",
    p(f"Once the outcome is {ui('outcome.status.completed')}, the card {q('followUp.expertTitle')} appears. Pick the {ui('followUp.date')}, the {ui('followUp.time')} and the {ui('followUp.duration')} (the same as this session unless you change it); times are in the appointment's time zone. The card says {q('followUp.expertNote')} There is no free text. Select {ui('followUp.send')}.")
    + p(f"The card then shows {q('followUp.waitingForEmployee')} If the organisation approves follow-ups, you see {q('followUp.awaitingApprovalExpert')} If the employee declines, a notice says {q('followUp.declinedToast')} and the card offers a new proposal."),
    "22", EXP, "The follow-up card after a completed outcome."))
ex.append(prose(
    "<h3>Picking a time the employee suggested</h3>"
    + p(f"If the employee suggests other times, open the follow-up with {ui('followUp.openFollowUp')}. The page says {q('followUp.pickTitle')} and {q('followUp.pickBody')} Choose one under {ui('followUp.pickLabel')} and select {ui('followUp.schedule')}; the page then says {q('followUp.scheduledFor', date=T_DATE, time=T_HHMM)} From there the follow-up is booked or goes to approval, as when the employee confirms. This edition has no screenshot of this screen.")
    + p(f"A follow-up is refused when the session was not completed, another follow-up is already open or the time has passed: {q('errors.followUpNotAllowed')}")))
chapter("experts", 3, "Experts: running a consultation",
    "You run consultations from the NestSelf admin app: you see your list, tell the employee if you are late, join, share your screen, end the session, record what happened and propose a follow-up. You see only the consultations you are assigned to.",
    "Admin app. Signed in as the sample expert, Milica Ristić.", ex)

# ---------- 4. HR and approvers ----------
ap = []
ap.append(step("The follow-up approval policy",
    p(f"HR administrators open {nav('followUpPolicy')} in the employer space. {q('approval.policy.intro')} Two choices:")
    + ul(f"{ui('approval.policy.automaticTitle')}: {q('approval.policy.automaticBody')} This is the default.",
         f"{ui('approval.policy.managerTitle')}: {q('approval.policy.managerBody')}")
    + p(f"Select {ui('approval.policy.save')}; the app confirms {q('approval.policy.saved')}"),
    "80", HR, "The policy with “An approver decides first” selected."))
ap.append(step("The approvals list",
    p(f"Approvers open {nav('approvals')}. {q('approval.intro')} Under {ui('approval.pendingTitle')} each request shows four facts: the employee's name, {q('approval.followUpLabel')}, the date and time with the time zone, and the length. Select {ui('approval.approve')} or {ui('approval.reject')}. An approval tells both sides: {q('approval.approvedToast', name='Jovan Petrović')}")
    + p(f"Earlier requests move to {ui('approval.decidedTitle')} with {ui('approval.approved')}, {ui('approval.rejected')} or {ui('approval.expired')}."),
    "82", HR, "Two requests waiting for a decision."))
ap.append(step("Declining with a reason",
    p(f"{ui('approval.reject')} opens {q('approval.rejectTitle')} with {q('approval.rejectDescription', name='Jovan Petrović')} The {ui('approval.reasonLabel')} is required: {q('approval.reasonHint')} An empty reason shows {q('approval.reasonRequired')} After {ui('approval.reject')}: {q('approval.rejectedToast', name='Jovan Petrović')}"),
    "83", HR, "The decline dialog asks for a short reason."))
ap.append(cards(
    card("What an approver sees, and never sees", ul(
        "Sees: the employee's name, “Follow-up session with a NestSelf expert”, the date and time, the length.",
        "Never sees: the service or topic, the expert's name or specialty, the outcome, feedback or anything said in a session.",
        f"Nobody decides their own follow-up: {q('approval.errors.selfApprovalDenied')}",
        "The alternate approver receives the same emails and can decide too.",
    )),
    card("When nobody decides: lapse rules", ul(
        "The request email goes to the approver and the alternate.",
        "After 5 working days without a decision, both receive a reminder. Working days are Monday to Friday in Belgrade time; public holidays are not taken into account.",
        "The request lapses at the earlier of the proposed start and 10 working days after the request. It becomes Expired, the follow-up is declined, and the employee is told.",
        f"A decision after the lapse is refused: {q('errors.approvalNotPending')}",
        "No reminder is sent when it would arrive after the lapse.",
    ), "tinted"),
))
chapter("approvers", 4, "HR and approvers: follow-up approval",
    "An organisation can ask for approval before a follow-up session is booked. HR sets the policy once; the approver for the employee's team then decides each request, seeing four facts and nothing about the content.",
    "Workspace app, employer space. Signed in as the sample HR administrator and approver, Ivana Jovanović.", ap)

# ---------- 5. Webinars for employees ----------
wb = []
wb.append(sub("5.1", "Finding and registering"))
wb.append(step("Webinars open to you",
    p(f"Open {ui('webinar.nav')}: {q('webinar.discovery.intro')} You see only the webinars your organisation's audience includes. Each shows the title, the date and time with the time zone, the presenters, {ui('webinar.status.published')}, the places left, and beside {ui('webinar.register')} the notice {q('webinar.recordingNotice')}"),
    "60", EMP, "Webinar discovery with places left and the recording notice."))
wb.append(step("The webinar page",
    p(f"The page repeats the recording notice and adds {q('webinar.captionsStatement')} Under {ui('webinar.detail.registrationTitle')} it says {q('webinar.detail.notRegistered')} Select {ui('webinar.register')}. A full webinar says {q('errors.webinarFull')}")
    + p(f"You receive a confirmation email titled {q('email.registrationSubject')}; it repeats that the webinar is recorded and only the presenters are on the recording, and adds a private calendar entry. Reminders follow 24 hours and 1 hour before."),
    "61", EMP, "Webinar detail before registering."))
wb.append(step("Registered",
    p(f"The page says {q('webinar.registeredSuccess')} {ui('webinar.unregister')} gives your place back until the webinar starts. Under {ui('webinar.detail.lobbyTitle')}: {q('webinar.lobby')}, a countdown, and {ui('webinar.join')}, which opens 15 minutes before the start ({q('webinar.detail.joinOpensAt', time=T_HHMM)})."),
    "62", EMP, "Registered: the countdown and Join webinar."))

wb.append(step("If a webinar is canceled",
    p(f"Registered employees receive a cancellation email, and the webinar page says {q('webinar.detail.canceled')} There is nothing to join, and the webinar cannot be registered for again."),
    "87", EMP, "A canceled webinar as the employee sees it.", "s"))
wb.append(sub("5.2", "The lobby and the live webinar"))
wb.append(step("The lobby",
    p(f"{ui('webinar.join')} first asks you to {q('webinar.liveView.prejoinTitle')}: {q('webinar.liveView.prejoinBody')} Then the lobby says {q('webinar.liveView.waitingForStart')} The card shows the title, the presenters, the start and a countdown, the recording notice, {q('webinar.lobby')} and {q('webinar.lobbyFloorRecording')}")
    + p("Nobody sees who else is waiting, and you can already write to the hosts."),
    "63", EMP, "The lobby before the hosts start."))
wb.append(step("The live stage",
    p(f"You see the presenter's video and any shared screen, with {ui('webinar.live')} and {ui('webinar.recIndicator')}. Your controls: {ui('webinar.muteSound')}, {ui('webinar.hand.raise')}, {ui('controls.fullscreen')} and {ui('consultation.leave')}. There is no camera button and no list of who else is there. When you leave, nobody else is told."),
    "64", EMP, "The attendee's live view: no camera, no list of attendees."))
wb.append(step("Chat and questions",
    p(f"In {ui('webinar.chat.title')}, choose {ui('webinar.chat.kindMessage')} or {ui('webinar.chat.kindQuestion')} under {q('webinar.chat.kindLabel')}, write under {ui('webinar.chat.attendeeLabel')} (up to 1,000 characters) and select {ui('webinar.chat.send')}. {q('webinar.messageSubmitted')}")
    + p(f"Your message is anonymous to the audience by default. Tick {ui('webinar.chat.showFirstName')} to add your first name: {q('webinar.chat.anonymousHint')} The moderator always sees your registered name. Published messages show as {ui('webinar.chat.participant')} or your first name; hosts' messages as {ui('webinar.chat.host')}; answers under {q('webinar.chat.answerLabel')}."),
    "66", EMP, "The chat with a published message and an answered question."))
wb.append(step("Polls",
    p(f"When the moderator opens a poll, the {ui('webinar.poll.title')} panel shows the question and the options. Choose one and select {ui('webinar.poll.vote')}: {q('webinar.poll.voted')} {q('webinar.poll.anonymous')} When the poll closes, the results appear as percentages."),
    "67", EMP, "An open poll; votes are counted without names."))

wb.append(sub("5.3", "Asking for the floor"))
wb.append(step("Raising your hand",
    p(f"{ui('webinar.hand.raise')} tells the hosts you would like to speak: {q('webinar.hand.raised')} {ui('webinar.hand.lower')} takes it back. The moderator sees your name; the presenter sees only {q('webinar.handRaisedPresenter')}."),
    "65", EMP, "The hand is raised; the button now reads Lower hand."))
wb.append(step("Being given the floor",
    p(f"If a host gives you the floor, a dialog opens: {q('webinar.floorDialog.title')}, {q('webinar.youCanSpeakNow')} and {q('webinar.recordingNoticeFloor')} Your microphone stays off until you choose {ui('webinar.floorDialog.unmute')}; {ui('webinar.floorDialog.later')} keeps it off. Others see {q('webinar.participantSpeaking')}. Your camera never turns on."),
    "68", EMP, "The floor dialog with the recording sentence."))
wb.append(step("Muted by a host, and asked to unmute",
    p(f"While you have the floor, a host can mute you: {q('webinar.mutedByHost')} A host can then ask you to speak again. The question {q('webinar.unmuteRequest.title')} offers {ui('webinar.unmuteRequest.unmute')} and {ui('webinar.unmuteRequest.stayMuted')}; nobody can unmute you but you. When the host takes the floor back: {q('webinar.floorTaken')}"),
    "78", EMP, "The host muted the attendee, then asked: Unmute or Stay muted.", "s"))
wb.append(step("The floor in a large webinar",
    p("Above 250 attendees, the audience is spread over linked meetings that receive only the presenters. When a host gives the floor to an attendee in one of them, the app joins that attendee's microphone to the presenters' meeting for the turn, sound only, and takes it out again when a host mutes them or takes the floor back. The dialog and the controls are the same as above. Whether the sound stays stable in long turns is not measured yet (chapter 9)."),
    "88", EMP, "The floor given to an attendee of a linked audience meeting.", "s"))
wb.append(step("After the webinar",
    p(f"When the hosts end the webinar you see {q('webinar.liveView.thanksTitle')}, {q('webinar.ended')} and {q('webinar.liveView.replayLater')} The recording goes to NestSelf's content team for review before anyone can watch it."),
    "69", EMP, "The end screen after the moderator ended the webinar.", "s"))
chapter("webinars", 5, "Webinars for employees",
    "Webinars are live talks by NestSelf experts for employees of client companies. You watch and listen and are never on camera. Every webinar is recorded, and only the presenters are on the recording; your voice is recorded only if a host gives you the floor and you unmute.",
    "Workspace app. Signed in as the sample employee, Jovan Petrović.", wb)

# ---------- 6. Presenters and moderators ----------
ho = []
ho.append(sub("6.1", "Creating and publishing a webinar",
    "Operations create and publish webinars. Presenters are NestSelf experts; the moderator, from NestSelf operations, runs the room."))
ho.append(step("The webinar list",
    p(f"Open {ui('webinar.admin.title')}: {q('webinar.admin.intro')} The list shows {ui('webinar.admin.columns.title')}, {ui('webinar.admin.columns.when')}, {ui('webinar.admin.columns.status')} ({ui('webinar.status.draft')}, {ui('webinar.status.published')}, {ui('webinar.status.live')}, {ui('webinar.status.ended')} or {ui('webinar.status.canceled')}) and {ui('webinar.admin.columns.capacity')}. Select {ui('webinar.admin.new')} to create one."),
    "70", OPS, "The admin webinar list with New webinar."))
ho.append(step("A new webinar",
    p(f"Fill in the {ui('webinar.form.titleLegend')} in at least one language, an optional {ui('webinar.form.descriptionLegend')}, and the {ui('webinar.form.audience')}: {ui('webinar.admin.audienceAll')}, {ui('webinar.form.audienceOrganizations')} or {ui('webinar.form.audienceUnits')}. {ui('webinar.form.capacity')} takes {q('webinar.form.capacityHint', limit='1,000')} Tick the {ui('webinar.form.presenters')} and choose the {ui('webinar.form.moderator')}: {q('webinar.form.moderatorHint')} Set the date, start and end in Europe/Belgrade time.")
    + p(f"There is no recording switch: the form states that the webinar is recorded. Select {ui('webinar.form.submit')}: {q('webinar.admin.created')}"),
    "71", OPS, "The new-webinar form, with the recording notice and no switch."))
ho.append(prose(
    "<h3>How many people can attend</h3>"
    + p("Up to 250 attendees share one meeting. For a larger audience, up to 1,000, the platform adds linked audience meetings that receive only the presenters; attendees see no difference, and the chat, polls and attendance work across them. Each attendee's place is reserved when they register.")))
ho.append(step("Publishing, editing and canceling",
    p(f"The draft page lists the facts. {ui('webinar.admin.publish')} asks {q('webinar.admin.publishTitle')} {q('webinar.admin.publishBody')} Publishing needs: {q('webinar.admin.publishNeeds')}")
    + p(f"Publishing makes the webinar visible to the eligible employees of its audience, who can then register: {q('webinar.admin.published')}"),
    "72", OPS, "The saved draft with Publish and Cancel webinar."))
ho.append(step("Canceling a webinar",
    p(f"{ui('webinar.admin.cancel')} asks {q('webinar.admin.cancelTitle')} {q('webinar.admin.cancelBody')} Choose {ui('webinar.admin.keep')} to go back, or confirm: {q('webinar.admin.canceled')} Reminders stop, and registering is no longer possible."),
    "86", OPS, "The confirmation before a webinar is canceled.", "s"))
ho.append(step("Editing a webinar",
    p(f"{ui('webinar.admin.edit')} opens {q('webinar.form.editTitle')}, the same form filled in, while the webinar is a draft or upcoming. {q('webinar.form.audienceLocked')} Select {ui('webinar.form.save')}; the page confirms {q('webinar.admin.saved')} A webinar that is live, ended or canceled cannot be changed: {q('webinar.errors.notEditable')}"),
    "76", OPS, "Editing the draft: the same form with Save changes.", "s"))

ho.append(sub("6.2", "Running the webinar"))
ho.append(step("The presenter view",
    p(f"Hosts open {ui('webinar.admin.openLive')} up to 30 minutes before the start. {q('webinar.console.prejoinTitle')} runs the device check with an optional {ui('prejoin.screenShare.test')} and shows {q('webinar.console.registered', count='N')}, a number and never names. In the lobby, {ui('webinar.start')} starts the webinar: {q('webinar.startHint')}")
    + p(f"The presenter sees {ui('webinar.attendance', count='N')}, {ui('webinar.handCount', count='N')} and {ui('webinar.publishedCount', count='N')}, shares the screen with {ui('controls.shareScreen')}, and writes {ui('webinar.chat.hostLabel')} with {ui('webinar.chat.sendHost')}; host messages appear at once. A presenter sees only published messages and, for raised hands, {q('webinar.handRaisedPresenter')} with a count."),
    "73", PRES, "The presenter's lobby with Start webinar."))
ho.append(step("The moderator console",
    p(f"The {ui('webinar.moderation.title')} panel shows the attendance count, the recording badge and {ui('webinar.moderation.stopRecording')}. Under {ui('webinar.moderation.handsTitle')} each hand shows the registered name, the time it was raised and {ui('webinar.moderation.giveFloor')}.")
    + p(f"{ui('webinar.moderation.pendingTitle')} lists each message with its author and {q('webinar.chat.anonymousToAudience')} or {q('webinar.chat.showsFirstName')}: {ui('webinar.moderation.publish')}, {ui('webinar.moderation.edit')} (then {ui('webinar.moderation.publishEdited')}), {ui('webinar.moderation.answer')} (then {ui('webinar.moderation.sendAnswer')}) or {ui('webinar.moderation.dismiss')}. A dismissed message never reaches the audience."),
    "74", OPS, "The moderator console while live: a raised hand and a message to review."))
ho.append(step("When an attendee has the floor",
    p(f"The attendee appears under {ui('webinar.moderation.speakingTitle')}. You can {ui('webinar.moderation.mute')} them; a muted speaker shows {ui('webinar.moderation.muted')} and {ui('webinar.moderation.askUnmute')}, which sends the request and then reads {ui('webinar.moderation.unmuteAsked')}. Only the attendee can unmute. {ui('webinar.moderation.takeFloor')} ends their turn and turns their microphone off."),
    "77", OPS, "Speaking now: Mute, Ask to unmute and Take the floor back.", "s"))
ho.append(prose(
    "<h3>Polls and ending the webinar</h3>"
    + p(f"Under {ui('webinar.console.pollTitle')}, write a question and two to six options and select {ui('webinar.console.pollCreate')}: {q('webinar.console.pollCreated')} {ui('webinar.poll.open')} shows it to everyone; {ui('webinar.poll.close')} publishes the results without names.")
    + p(f"{ui('webinar.endForEveryone')} asks {q('webinar.endConfirmTitle')} {q('webinar.endConfirmBody')} Choose {ui('webinar.keepGoing')} or end it. Presenters and the moderator can both end the webinar; otherwise the room closes 15 minutes after the scheduled end.")))
ho.append(step("Stopping the recording early",
    p(f"The recording starts by itself with the webinar, shows {ui('webinar.recIndicator')} to everyone and stops when the webinar ends. Only the moderator can stop it earlier: {q('webinar.moderation.stopRecordingTitle')} {q('webinar.moderation.stopRecordingBody')} Choose {ui('webinar.moderation.keepRecording')} or {ui('webinar.moderation.stopRecording')}. If the recording fails, everyone sees {q('webinar.recordingFailed')}"),
    "75", OPS, "The confirmation before the recording stops for good."))
ho.append(step("Attendance after the webinar",
    p(f"Once the webinar ran, its page shows {ui('webinar.admin.attendanceTitle')}: {ui('webinar.admin.registeredCount', count='N')}, {ui('webinar.admin.joinedCount', count='N')} and {ui('webinar.admin.peakCount', count='N')}, then a table titled {q('webinar.admin.attendanceCaption')}: one row per registration ({ui('webinar.admin.attendanceRow', number='N')}) with {ui('webinar.admin.attendanceColumns.joined')}, {ui('webinar.admin.attendanceColumns.left')}, {ui('webinar.admin.attendanceColumns.minutes')} and {ui('webinar.admin.attendanceColumns.completed')}. Only moderators and NestSelf operations can open it, every view is recorded, and employers never receive it. The page also shows the {ui('webinar.admin.recordingTitle')} state."),
    "79", OPS, "Attendance per registration, without names.", "s"))
ho.append(cards(
    card("Recording states on the webinar page", ul(
        f"{ui('webinar.admin.recordingStatus.scheduled')}: before the start.",
        f"{ui('webinar.admin.recordingStatus.recording')}: while live.",
        f"{ui('webinar.admin.recordingStatus.processing')}: the pieces are joined into one video file.",
        f"{ui('webinar.admin.recordingStatus.ready')}: the file exists, in Frankfurt, encrypted at rest.",
        f"{ui('webinar.admin.recordingStatus.handed_off')}: passed to the content team for review.",
        f"{ui('webinar.admin.recordingStatus.failed')}: no recording; the webinar went on without one.",
    )),
    card("What “handed off” means", p("The replay is never published straight from the meeting. The content team reviews it first and decides whether and when attendees can watch it. Today the hand-off is noted as pending: the content system's media interface does not exist yet, so the content team collects the file from its folder (see chapter 9).")
         + p("Only presenters are on the recording: the video, the sound and the shared screen of the presenters, and the voice of an attendee who was given the floor and unmuted."), "tinted"),
))
chapter("hosts", 6, "Presenters and moderators",
    "Webinars are created, published and run in the admin app. Operations prepare the occurrence; the presenters speak; the moderator reviews messages, gives the floor, runs polls and can stop the recording.",
    "Admin app. Signed in as the sample moderator, Nikola Đorđević, and the sample expert as presenter.", ho)

# ---------- 7. Operations and support ----------
op = []
op.append(cards(
    card("Booking a consultation", p(f"Client operations open {ui('consultations.nav')} and select {ui('consultations.newConsultation')}: {q('create.intro')} Choose the {ui('create.organisation')}, the {ui('create.employee')}, the {ui('create.category')} and the {ui('create.expert')}, then the date, {ui('create.start')} and {ui('create.end')}. Times are in Europe/Belgrade. Select {ui('create.submit')}: {q('create.created', date=T_DATE, time=T_HHMM)}")
         + p(f"The form refuses an expert who is not approved for the service ({q('create.errors.expertCategory')}) and an employee from another organisation ({q('create.errors.notMember')}). Reminders are scheduled at once.")),
    card("The operations list", p(f"{ui('consultations.nav')} lists every consultation of the organisations you coordinate, with {ui('consultations.columns.expert')} and {ui('consultations.columns.organisation')} columns. {ui('consultations.filters.title')}: {ui('consultations.filters.organisation')}, {ui('consultations.filters.status')}, {ui('consultations.filters.from')} and {ui('consultations.filters.to')}, with {ui('consultations.filters.apply')} and {ui('consultations.filters.clear')}. {ui('consultations.view')} opens a read-only page: {q('consultations.readOnly')}")),
))
op.append(cards(
    card("Canceling a consultation", p(f"{ui('cancel.button')} asks {q('cancel.title')} and {q('cancel.body', date=T_DATE, time=T_HHMM)} Choose {ui('cancel.keep')} or {ui('cancel.confirm')}. Only a confirmed appointment can be canceled. Both participants receive an email, and a call that is already running closes. The employee can cancel their own appointment; the expert cannot cancel.")),
    card("Call support", p(f"Support operators open {ui('supportCalls.nav')}: {q('supportCalls.intro')} Enter the {ui('supportCalls.sessionId')} and select {ui('supportCalls.lookup')}. The page shows the session's status, provider, start, end and meeting id, and for each participant the role, join and leave times, reconnections, connection quality, error codes, browser and operating system. It never shows names, content or device names.")
         + p(f"{ui('supportCalls.reportsTitle')} lists the reports employees and experts sent, with {ui('supportCalls.reportColumns.category')} and the connection summary; {ui('supportCalls.openDiagnostics')} opens the session. Listing every report needs platform-wide access; otherwise: {q('supportCalls.reportsUnavailable')}")),
))
op.append(cards(
    card("Sample mode", p(f"When an app runs on sample data, every screen shows the banner {q('sample.banner', COMMON)} and no action sends or saves anything. The call and webinar screens can be tried with {ui('join.sampleDemo')}, which says {q('call.sampleNotice')}")
         + p(f"Approvals in sample mode show fictional requests and say {q('approval.sampleItemsNote')} or, with nothing to show, {q('approval.sampleNote')} The policy screen says {q('approval.policy.sampleNote')}")),
    card("Who can do what today", ul(
        "Book and cancel consultations: client operations, for the organisations they coordinate.",
        "Create, publish, edit and cancel webinars: holders of webinar management (operations, content publishers).",
        "Moderate webinars: client operations and the platform owner.",
        "Look up call diagnostics: support operators.",
        "Service coordinators cannot yet moderate, book or cancel (chapter 9).",
    ), "tinted"),
))
chapter("operations", 7, "Operations and support",
    "NestSelf operations book consultations for client companies and keep an overview; support operators look into technical problems from connection data, never from content. This edition has no screenshots of these screens.",
    "Admin app. Operations, booking coordinators and support operators.", op)

# ---------- 8. Privacy and recording ----------
pv = []
pv.append(cards(
    card("What is recorded", ul(
        "Webinars: always, from start to end, unless the moderator stops it early.",
        "Consultations: never. There is no recording control.",
        "On a webinar recording: the presenters' video, sound and shared screen, and the voice of an attendee given the floor after they unmute. Attendees cannot send video, so no attendee is ever seen.",
        "The notice is shown at registration, in the email, in the lobby and before an attendee unmutes.",
    )),
    card("What is never stored", ul(
        "Professional notes: the outcome form has no notes field.",
        "The content of a consultation: no recording, no chat.",
        "Join tokens: never written to the database or to logs.",
        "Quick signals such as “I cannot hear you”: gone when the session ends.",
        "Who voted for what in a poll.",
        "Names or device names in technical reports.",
    )),
    card("How long data is kept", ul(
        "Appointments, sessions, outcomes and approval requests: 7 years.",
        "Connection diagnostics and technical reports: 90 days.",
        "Webinar messages and questions, polls: 12 months; then the link to the author is removed from messages.",
        "Feedback and webinar registrations: 24 months.",
        "Raw recording pieces: 30 days. The finished replay follows the content team's rules.",
        "A shared location: deleted when the session ends.",
    ) + p("These are defaults until the data protection assessment confirms them.", ) , "tinted"),
    card("Where it lives, and help in a crisis", p("Calls run on Amazon Chime SDK in the Frankfurt region (eu-central-1); recordings are stored there, encrypted at rest. The video service receives random ids, never names or email addresses.")
         + p("The crisis block lists Serbian numbers only, because NestSelf launches in Serbia: emergency 112, ambulance 194, Centar Srce 0800 300 303. Hungarian numbers come with a Hungarian launch.")),
))
chapter("privacy", 8, "Privacy and recording in one page",
    "What is recorded, who is on it, how long things are kept and what is never stored. The employer's view is in section 2.11.",
    "For everyone.", pv)

# ---------- 9. Known limitations ----------
lm = []
limits = [
    ("No measurement against AWS yet", "The eight spikes have scripts and result templates but have not run in the dev account. Until they do, some behaviour rests on written assumptions: that the recording takes one meeting seat, that the recording shows the presenters only, and that a speaker in a large webinar keeps stable sound."),
    ("Certificates and the load test", "Certificates of attendance and the load test before the first large webinar are not started. They belong to the first quarter after the pilot."),
    ("Phones and workshops", "The mobile app does not open calls yet; on a phone, the employee uses the workspace app in the browser, without screen sharing. Small group workshops and replay captions come later. There are no live captions: the service does not support Serbian or Hungarian."),
    ("Service coordinators", "Service coordinators cannot moderate webinars, book or cancel consultations until the founder decides how their access is scoped. Moderators today are client operations and the platform owner."),
    ("Replay hand-off", "After a webinar, the hand-off to the content team is a pending note with the file's folder; the content system connects when its media interface exists. The email that tells presenters they were recorded is written but not sent. A presenter who joins after the recording started may be missing from it."),
    ("Expert photo and credentials", "The waiting card shows the expert's first name and initial only; there is no source for the photo and credentials yet."),
    ("Webinar audience", "There is no plan model yet, so “Every eligible organisation” reaches every active member of every active client organisation."),
    ("Hungarian hotlines", "The crisis block lists Serbian numbers only."),
    ("Working days and holidays", "Approval reminders and lapses count Monday to Friday in Belgrade time and do not know public holidays."),
    ("Support contact", "The technical support address is a placeholder on a reserved domain until it is set for launch."),
]
for i in range(0, len(limits), 2):  # one block per row, so the rows flow across pages
    lm.append(blk('<div class="limits">' + "".join(f'<div class="limit"><h3>{t}</h3><p>{b}</p></div>' for t, b in limits[i:i + 2]) + "</div>", "limits-blk"))
lm.append(cards(
    card("What comes next", "<ol class=\"steps compact\">"
         "<li><p>The founder runs the spikes in the dev account and records the results; any decision that waits on a spike then binds or changes.</p></li>"
         "<li><p>Engineering takes the remaining tasks: certificates and the load test, then the mobile ticket route, workshops and replay captions, and the follow-ups listed in the implementation notes.</p></li>"
         "<li><p>The data protection assessment and the legal checklist run alongside development and gate only the production launch.</p></li></ol>"),
    card("Where the detail lives", ul(
        "<code>02-decisions.md</code> section 11: the known limitations.",
        "<code>07-implementation-notes.md</code>: what was built, how to run it, the follow-ups.",
        "<code>04-user-stories.md</code>: every story with its acceptance criteria.",
        "<code>manual/screenshots/INDEX.md</code>: every screen with its route and state.",
    ), "tinted"),
))
chapter("limits", 9, "Known limitations and what comes next",
    "The consultations and webinars described here are built and tested in the browser against the NestSelf API with a stand-in video service. These are the gaps that are known and accepted for now.",
    "From the decision record, section 11, and the implementation notes, 25 October 2026.", lm)

# ---------- screens the prose did not place ----------
extra = [n for n in sorted(SCREENS) if n not in USED and any(files_for(n))]
if extra:
    more = []
    for n in extra:
        sc = SCREENS[n]
        more.append(step(f"Screen {n}", p(html.escape(sc["state"])), n, html.escape(sc["who"].split("(")[0].strip() or "Screen"), html.escape(sc["step"] or sc["state"])))
    chapter("more", 10, "More screens", "Screens captured after this manual's text was written, with the description from the screenshot index.", "From manual/screenshots/INDEX.md.", more)

EXTRA_CSS = """
.page { padding-bottom: 18mm; }
.flow-body { flex: 1 1 auto; min-height: 0; }
.flow-body > .blk + .blk { margin-top: 6.5mm; }
.flow-body > .blk.limits-blk + .blk.limits-blk { margin-top: 4mm; }
.flow-body > .blk.sub + .blk { margin-top: 3.5mm; }
.flow-body > .blk.lead-blk + .blk { margin-top: 5mm; }
.run-head { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; font-size: 8pt; color: var(--color-text-secondary); padding-bottom: 2.4mm; margin-bottom: 6mm; border-bottom: 1px solid var(--color-border-subtle); }
.run-head .ch { color: var(--color-primary); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.page-head h2 { max-width: 34ch; }
.page-head .meta { max-width: 56mm; }
.lead { max-width: 70ch; }
.blk h3 { font-size: 12pt; font-weight: 600; line-height: 1.3; margin-bottom: 1.4mm; }
.blk p, .blk li { font-size: 9.5pt; line-height: 1.5; }
.blk p + p, .blk p + ul, .blk ul + p { margin-top: 1.6mm; }
.blk ul { margin-top: 1mm; }
.blk li + li { margin-top: 0.8mm; }
.blk.sub { padding-top: 1mm; }
.blk.sub .eyebrow { margin-bottom: 0.8mm; }
.sub-title { font-size: 16pt; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; }
.sub-intro { margin-top: 1.4mm; color: var(--color-text-secondary); max-width: 80ch; }
.ui { font-weight: 600; color: var(--color-primary); }
.card .ui { color: var(--color-primary); }
.q { color: var(--color-text); }
.shot { width: fit-content; max-width: 100%; margin: 3mm auto 0; --shot-h: 68mm; }
.shot.s { --shot-h: 58mm; }
.shot.single { --shot-h: 96mm; margin: 0; }
.shot .imgs { display: flex; gap: 5mm; justify-content: center; align-items: flex-start; }
.shot img { display: block; height: var(--shot-h); width: auto; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-surface); }
.shot figcaption { display: flex; align-items: baseline; gap: 2.2mm; margin-top: 2.2mm; font-size: 8.3pt; line-height: 1.4; color: var(--color-text-secondary); }
.shot.single figcaption { flex-wrap: wrap; max-width: 46mm; }
.shot figcaption .pill { flex: 0 0 auto; }
.shot figcaption .cap { flex: 1 1 auto; }
.shot figcaption .ref { flex: 0 0 auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.shot figcaption .ui { color: var(--color-text-secondary); }
.side { display: grid; grid-template-columns: 1fr auto; gap: 8mm; align-items: start; }
.pending { width: 120mm; height: var(--shot-h); display: flex; flex-direction: column; justify-content: center; gap: 1.5mm; padding: 6mm; border: 1px dashed var(--color-border-control); border-radius: var(--radius-control); background: var(--color-surface); font-size: 9pt; color: var(--color-text-secondary); }
.pending strong { color: var(--color-warning); }
.prose { background: var(--color-surface); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-card); padding: 4.5mm 5.5mm; }
.cards .card p, .cards .card li { font-size: 9.2pt; line-height: 1.48; }
.cards .card h3 { font-size: 11pt; }
.cards .grid { gap: 5mm; }
.toc-title { font-size: 11pt; margin-bottom: 1mm; }
.toc li { padding: 2.1mm 0; }
.limits { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 6mm; }
.limit { background: var(--color-surface); border: 1px solid var(--color-border-subtle); border-left: 3px solid var(--color-warning); border-radius: 0 var(--radius-control) var(--radius-control) 0; padding: 3mm 4mm; }
.limit h3 { font-size: 10pt; margin-bottom: 0.8mm; }
.limit p { font-size: 9pt; line-height: 1.45; }
.steps.compact > li { padding-bottom: 2.4mm; }
.steps.compact p { font-size: 9.2pt; color: var(--color-text); }
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
    const head = first
      ? '<div class="page-head"><div><span class="eyebrow">Chapter ' + n + '</span><h2>' + src.dataset.title + '</h2></div><div class="meta">' + src.dataset.meta + '</div></div>'
      : '<div class="run-head"><span class="ch">' + n + ' · ' + src.dataset.run + '</span><span>' + src.dataset.meta + '</span></div>';
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

doc = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>NestSelf consultations and webinars, user manual</title>'
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
