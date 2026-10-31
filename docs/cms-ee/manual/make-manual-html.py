#!/usr/bin/env python3
"""Build the content library tutorial (CMS EE, milestone 1) as paginated A4 HTML.

Usage:
  python3 docs/cms-ee/manual/make-manual-html.py
  node docs/tasks/calls-webinars/pdf/build-pdf.mjs docs/cms-ee/manual/user-manual.html docs/cms-ee/user-manual.pdf

Writes manual/user-manual.html next to this script. It reuses the print stylesheet of the
calls manual (docs/tasks/calls-webinars/pdf/styles.css: tokens, Onest) and its in-page
paginator, which packs each chapter's blocks into fixed A4 sheets; build-pdf.mjs refuses
to write the PDF when a sheet overflows.

Every button, field and message quoted here is read from the English catalogs by key, so a
renamed label fails the build instead of going stale. Every screenshot comes from the e2e
journeys (e2e/content/editor.spec.ts and m1.spec.ts); a missing file fails the build.
"""
import html
import json
import re
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SHOTS = HERE / "screenshots"
OUT = HERE / "user-manual.html"

LOCALES = REPO / "packages/i18n/locales/en"
CMS = json.loads((LOCALES / "cms.json").read_text(encoding="utf-8"))
LIB = json.loads((LOCALES / "library.json").read_text(encoding="utf-8"))
WS = json.loads((LOCALES / "workspace.json").read_text(encoding="utf-8"))
COMMON = json.loads((LOCALES / "common.json").read_text(encoding="utf-8"))

FOOT = "NestSelf · Content library · Tutorial"


# ---------- catalog wording ----------
def s(key: str, ns: dict = CMS, **values) -> str:
    node = ns
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"catalog key missing: {key}")
        node = node[part]
    if not isinstance(node, str):
        raise KeyError(f"catalog key is not a string: {key}")
    for name, value in values.items():
        node = node.replace("{{" + name + "}}", str(value))
    if "{{" in node:
        raise ValueError(f"unfilled placeholder in {key}: {node}")
    return node


def ui(key: str, ns: dict = CMS, **values) -> str:
    """A button, field or menu label, as the app shows it (trailing dots dropped)."""
    text = re.sub(r"(\.\.\.|…)$", "", s(key, ns, **values))
    return f'<span class="ui">{html.escape(text, quote=False)}</span>'


def q(key: str, ns: dict = CMS, **values) -> str:
    """A message the app shows, quoted."""
    return f'<span class="q">“{html.escape(s(key, ns, **values), quote=False)}”</span>'


def k(*keys: str) -> str:
    return "+".join(f"<kbd>{html.escape(x)}</kbd>" for x in keys)


# ---------- screenshots ----------
SHOTS_USED = []


def png_size(path: Path):
    with path.open("rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def img(name: str, alt: str) -> str:
    path = SHOTS / f"{name}.png"
    if not path.exists():
        raise SystemExit(f"screenshot missing: {path.relative_to(REPO)}")
    w, h = png_size(path)
    SHOTS_USED.append(f"{name}.png")
    tall = "tall" if h > w else "wide"
    return f'<img class="{tall}" src="screenshots/{name}.png" width="{w}" height="{h}" alt="{html.escape(alt, quote=True)}">'


def fig(names, caption: str, size: str = "") -> str:
    """One screenshot, or several side by side. `size`: '' (full width), 'm' (medium), 'pair', 'duo', 'tall-page'."""
    names = [names] if isinstance(names, str) else names
    plain = re.sub("<[^>]+>", "", caption)
    imgs = "".join(img(n, plain) for n in names)
    return f'<figure class="shot {size}"><div class="imgs">{imgs}</div><figcaption>{caption}</figcaption></figure>'


# ---------- blocks ----------
def blk(inner: str, cls: str = "") -> str:
    return f'<div class="blk {cls}">{inner}</div>'


def step(title: str, body: str, figure: str = "") -> str:
    """A numbered tutorial step; the number comes from the CSS counter of its chapter."""
    return blk(f'<h3><span class="n"></span>{title}</h3>{body}{figure}', "step")


def tip(title: str, body: str, cls: str = "") -> str:
    return blk(f'<div class="callout {cls}"><strong>{title}</strong>{body}</div>', "tip")


def p(text: str) -> str:
    return f"<p>{text}</p>"


def ul(*items: str) -> str:
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


PARTS = []
CHAPTERS = []


def chapter(part: str, number: int, title: str, lead: str, meta: str, blocks: list) -> None:
    CHAPTERS.append((part, title))
    attrs = (
        f'data-part="{part}" data-number="{number}" data-title="{html.escape(title, quote=True)}" '
        f'data-meta="{html.escape(meta, quote=True)}" data-run="{html.escape(title, quote=True)}"'
    )
    lead_html = blk(f'<p class="lead">{lead}</p>', "lead-blk") if lead else ""
    PARTS.append(f'<div class="flow-source" {attrs}>{lead_html}{"".join(blocks)}</div>\n')


# ---------- cover ----------
PARTS.append('''<section class="page cover" data-part="cover">
  <div class="cover-art-wrap"><svg class="cover-art" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="0.5" aria-hidden="true"><circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="38"/><circle cx="50" cy="50" r="28"/><circle cx="50" cy="50" r="18"/><circle cx="50" cy="50" r="8"/></svg></div>
  <div class="cover-inner">
    <div class="wordmark">nestself</div>
    <h1>Writing and publishing articles</h1>
    <p class="subtitle">A tutorial for the content library: write an article, review it, publish it, and read it as an employee.</p>
    <div class="cover-meta">
      <div><strong>Milestone 1</strong>Edition of 30 October 2026</div>
      <div><strong>Readers</strong>Authors, reviewers, publishers, employees</div>
      <div><strong>Screens</strong>From the automated test run, fictional organisations</div>
    </div>
  </div>
</section>
''')

# ---------- 1. Before you start ----------
journey = '''<div class="journey">
  <div class="hop"><div class="who">Author</div><div class="what">Writes the article in the <strong>admin app</strong> in Serbian, Hungarian and English, then submits each language for review.</div></div>
  <div class="hop"><div class="who">Reviewer</div><div class="what">Approves each language, or returns it to the author with a comment.</div></div>
  <div class="hop"><div class="who">Publisher</div><div class="what">Publishes the approved article to its approved audience, in all four languages at once.</div></div>
  <div class="hop"><div class="who">Employee</div><div class="what brand">Reads it in the <strong>workspace app</strong>, in their own language, and saves it for later.</div></div>
</div>'''

chapter("start", 1, "Before you start",
    "An article passes through four people before an employee reads it. Each chapter of this tutorial follows one of them.",
    "Two web apps, four roles.",
    [
        blk(journey, "journey-blk"),
        blk('<div class="grid cols-2">'
            '<div class="card"><h3>Who may do what</h3>'
            + p("Your role comes from a grant (<code>content_author</code>, <code>content_reviewer</code> or <code>content_publisher</code>) for one or more categories. NestSelf staff assign grants in the admin app under Access.")
            + p("Buttons you may not use are hidden, and the server checks every action again on its own.")
            + '</div><div class="card"><h3>About the screenshots</h3>'
            + p("Every screen comes from the automated journey that tests these features (<code>e2e/content/</code>), run against a local API with fictional sample organisations and people. The admin app is shown in English; every screen works the same in Serbian and Hungarian.")
            + p("Buttons and fields are written in bold green, for example " + ui("editor.submit") + ".")
            + "</div></div>", "cards"),
        blk('<h3 class="toc-title">Contents</h3><ol class="toc">' + "".join(
            f'<li data-part="{p_}"><span>{t_}</span><span class="pg"></span></li>' for p_, t_ in [
                ("start", "Before you start"),
                ("author", "Write an article"),
                ("reviewer", "Review it"),
                ("publisher", "Publish it"),
                ("employee", "Read it as an employee"),
                ("reference", "Quick reference"),
            ]) + "</ol>", "toc-blk"),
    ])

# ---------- 2. Author ----------
author = [
    step("Create the article",
         p(f"Open <strong>Content</strong> and select {ui('resources.create')}. Choose the {ui('newResource.category')}, the "
           f"{ui('newResource.reviewDiscipline')} and the {ui('newResource.locale')} you start in, type the {ui('newResource.initialTitle')} "
           f"and select {ui('newResource.submit')}. The editor opens on that language."),
         fig("author/create-resource", "The new article form.", "m")),
    step("Start writing",
         p(f"The title sits at the top and the body is one writing area, with no toolbar. "
           f"{ui('editor.propertiesPanel')} holds the article's details; leave them for later."),
         fig("author/editor-empty", "An empty article. The hint in the body says how to add blocks.")),
    step("Add blocks with “/”",
         p(f"Type <kbd>/</kbd> to open the block menu, keep typing to filter it (<kbd>/num</kbd> finds "
           f"{ui('editor.toolbar.orderedList')}), and press <kbd>Enter</kbd>. <kbd>Esc</kbd> closes it and keeps what you typed.")
         + ul(f"{ui('editor.toolbar.note')}: a callout; pick Tip, Warning or Disclaimer.",
              f"{ui('editor.toolbar.step')}: a numbered card with a {ui('editor.nodeView.stepTitle')}.",
              f"{ui('editor.toolbar.checklist')}: <kbd>Enter</kbd> adds an item, <kbd>Enter</kbd> on an empty item ends the list."),
         fig("author/slash-menu", "The block menu, grouped into Text, Lists, Blocks and Media.")),
    tip("Faster: type the shortcut",
        p(f"At the start of a line, {k('##')} and a space make a heading, {k('###')} a subheading, {k('-')} a bulleted list, "
          f"{k('1.')} a numbered list, {k('>')} a quote and {k('[]')} a checklist.")),
    step("Format a selection",
         p(f"Select text to show the formatting bar: {ui('editor.toolbar.bold')}, {ui('editor.toolbar.link')} and "
           f"{ui('editor.bubble.turnInto')}, which changes the whole block ({k('Ctrl', 'B')} and {k('Ctrl', 'K')} work too; "
           f"{k('Cmd')} on a Mac). A link must be an <code>https://</code> address on the allowed list or another NestSelf article; "
           f"anything else is refused."),
         fig(["author/bubble-menu", "author/link-popover"], "Left: the formatting bar. Right: an <code>http://</code> address is refused.", "pair")),
    step("Move and change blocks",
         p(f"Hover a block: {ui('editor.block.add')} (+) and a grip appear on its left. The + offers the same block types "
           f"as {k('/')}: pick one to turn that line into a heading, list or quote; an image, note or call to action "
           f"replaces an empty line or goes below a filled one. Drag the grip to move the block up or down; a line shows "
           f"where it lands. Click the grip for {ui('editor.bubble.turnInto')}, {ui('editor.block.duplicate')}, "
           f"{ui('editor.block.delete')}, {ui('editor.block.moveUp')} and {ui('editor.block.moveDown')}. From the keyboard: "
           f"{k('Ctrl', '/')} ({k('Cmd', '/')} on a Mac) opens that menu, {k('Alt', 'Shift', '↑')} and {k('Alt', 'Shift', '↓')} move the block."),
         fig(["author/block-picker", "author/block-menu"], "Left: the + offers the block types for that line. Right: the block menu, opened from the grip.", "pair")
         + fig("author/block-drag", "Dragging a block: it dims, and the line shows where it lands.")),
    step("Add an image",
         p(f"Choose {ui('editor.toolbar.image')} in the block menu and pick a file, or drop or paste one. The block shows "
           f"{q('editor.image.uploading')} and {q('editor.image.processing')} until the image is ready. "
           f"{ui('editor.image.altText')} is required: a short description for people who cannot see the image."),
         fig("author/image-upload", "A processed image with its alt text and caption.")),
    step("End with a call to action",
         p(f"{ui('editor.toolbar.cta')} is the one button at the end of an article. Choose what it does "
           f"({ui('editor.nodeView.ctaKindSuggestTopic')}, {ui('editor.nodeView.ctaKindOpenContent')}, "
           f"{ui('editor.nodeView.ctaKindOpenCollection')} or {ui('editor.nodeView.ctaKindOpenService')}), search for its target by "
           f"title, optionally write a button label, and select {ui('editor.nodeView.done')}. The block is added only when its target "
           f"is set. {ui('editor.toolbar.related')} adds a card for another article in the same way."),
         fig("author/cta-popover", "The call to action opens another published article.")),
    step("Fill in the properties",
         p(f"Open {ui('editor.propertiesPanel')}: the {ui('editor.summary')} shown on cards, the {ui('editor.outcome')}, the "
           f"reading time in minutes, the {ui('editor.proposedAudience')} and the {ui('editor.sources')}. The audience is required "
           f"before you submit; in this milestone it is {ui('editor.audienceAll')}."),
         fig("author/properties", "The article's properties.")),
    step("Let it save",
         p(f"The editor saves a moment after you stop typing, and before you leave the page; the status reads "
           f"{q('editor.saved')}. If someone else saved the same draft meanwhile, saving stops and the editor says so: "
           f"<strong>Reload server version</strong> continues from their copy."),
         fig(["author/autosave-saved", "author/conflict"], "Left: saved. Right: someone else changed the draft.", "pair")),
    step("Preview it",
         p(f"{ui('editor.preview')} shows the article as employees will see it, on a phone (390 px), a desktop (1440 px) or a small phone (320 px)."),
         fig(["author/preview-desktop", "author/preview-phone"], "The desktop and the phone preview.", "duo")),
    step("Write the other languages",
         p("An article is published in Serbian (Latin), Hungarian and English together. Open each language tab and create its "
           "variant. Serbian (Cyrillic) is produced from the Latin text and is read-only."),
         fig("author/locale-tabs", "The language tabs. Cyrillic follows Latin on its own.")),
    step("Submit for review",
         p(f"Select {ui('editor.submit')} on each of the three languages. A submitted revision is locked until a reviewer approves or returns it."),
         fig("author/submitted", "The Serbian variant is in review.")),
]
chapter("author", 2, "Write an article", "", "Author · admin app", author)

# ---------- 3. Reviewer ----------
reviewer = [
    step("Return it with a comment",
         p(f"Open the article in <strong>Content</strong> and switch to the language you review. {ui('editor.returnChanges')} "
           f"sends it back to the author and needs a comment. You cannot review a revision you wrote or last edited, or an "
           f"article outside your review discipline."),
         fig("reviewer/return-for-changes", "The reviewer explains what needs to change.")),
    tip("Tell the author directly for now",
        p("In this milestone the comment is recorded with the review but not yet shown to the author. It appears on the article in milestone 2."),
        "warning"),
    step("Approve it",
         p(f"When the author has resubmitted, {ui('editor.approve')} accepts exactly that revision. Approve each of the three languages."),
         fig("reviewer/approve", "The revision is approved.")),
]
chapter("reviewer", 3, "Review it", "", "Reviewer · admin app", reviewer)

# ---------- 4. Publisher ----------
publisher = [
    step("Publish now",
         p(f"When all three languages are approved, {ui('detail.publishNow')} opens a confirmation with the audience the "
           f"reviewers approved. Confirm it to publish."),
         fig("publisher/publish-dialog", "The confirmation shows the approved audience.")),
    step("Check that it is live",
         p("The article is live in all four languages at once. A later approved revision replaces it when you publish again."),
         fig("publisher/published", "The publication is live.")),
]
chapter("publisher", 4, "Publish it", "", "Publisher · admin app", publisher)

# ---------- 5. Employee ----------
employee = [
    step("Find it on Home",
         p(f"{ui('nav.home', LIB)} lists the articles available to your organisation, on a computer or a phone."),
         fig(["employee/home-desktop", "employee/home-mobile"], "Home on a computer and on a phone.", "duo")),
    step("Read it",
         p("The article shows its summary, what you gain, the reading time, who reviewed it and when, and then the body with its "
           "notes, steps, checklists, images, related articles and the call to action at the end."),
         fig("employee/article-detail-sr", "The whole article, in Serbian.", "tall-page")),
    step("Read it in your language",
         p(f"Choose your {ui('settings.language', WS)} under {ui('nav.settings', COMMON)}. "
           "Serbian comes in Latin and in Cyrillic script."),
         fig(["employee/article-detail", "employee/cyrillic-detail"], "Left: the English variant. Right: an article in Serbian Cyrillic.", "pair")),
    step("Save it for later",
         p(f"{ui('detail.save', LIB)} keeps the article under {ui('nav.saved', LIB)}."),
         fig("employee/saved-desktop", "The saved list.")),
    step("Work for two organisations",
         p(f"If you work for two client organisations, switch between them at the top of the page. Each one shows only its own "
           f"articles and saved list; an article of the other shows {q('content.unavailable', LIB)}"),
         fig(["employee/org-b-home", "employee/content-unavailable-org-b"], "Left: Home in the second organisation. Right: an article it cannot see.", "pair")),
]
chapter("employee", 5, "Read it as an employee", "", "Employee · workspace app", employee)

# ---------- 6. Quick reference ----------
keys_table = '''<table class="data">
<thead><tr><th>Keys</th><th>Where</th><th>What it does</th></tr></thead><tbody>
<tr><td><kbd>/</kbd></td><td>Body</td><td>Opens the block menu</td></tr>
<tr><td>+ (on hover)</td><td>Any block</td><td>Offers the block types for that line</td></tr>
<tr><td>Grip (drag)</td><td>Any block</td><td>Moves the block where the line shows</td></tr>
<tr><td><kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd> <kbd>Esc</kbd></td><td>Block menu</td><td>Move, insert, close</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>B</kbd> (<kbd>Cmd</kbd>+<kbd>B</kbd>)</td><td>Selection</td><td>Bold</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>Cmd</kbd>+<kbd>K</kbd>)</td><td>Selection</td><td>Link</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>/</kbd> (<kbd>Cmd</kbd>+<kbd>/</kbd>)</td><td>Any block</td><td>Opens the menu of the current block</td></tr>
<tr><td><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd></td><td>Any block</td><td>Moves the block up or down</td></tr>
<tr><td><kbd>##</kbd> <kbd>###</kbd> <kbd>-</kbd> <kbd>1.</kbd> <kbd>&gt;</kbd> <kbd>[]</kbd> and a space</td><td>Start of a line</td><td>Heading, subheading, bulleted list, numbered list, quote, checklist</td></tr>
</tbody></table>'''

states = ('<dl class="rows">'
          + "".join(f"<dt>{html.escape(s(f'detail.revisionState.{st}'))}</dt><dd>{d}</dd>" for st, d in [
              ("draft", "The author is writing. Saved automatically."),
              ("in_review", "Submitted and locked until a reviewer decides."),
              ("changes_requested", "Returned to the author, who edits and submits again."),
              ("approved", "Ready to publish once all three languages are approved."),
          ]) + "</dl>")

limits = '<div class="limits">' + "".join(
    f'<div class="limit"><h3>{t}</h3><p>{b}</p></div>' for t, b in [
        ("Audiences", "Publishing to chosen organisations or teams, and scheduling, come in milestone 2. Today the editor offers All eligible and keeps a narrower audience already stored on an article."),
        ("Review history", "Return comments on the article, and notifications for authors and reviewers, come in milestones 2 and 3."),
        ("More formats", "Video, audio, practical guides and collections come in milestone 2."),
        ("Discovery", "Search and categories on Home come in milestone 2."),
    ]) + "</div>"

chapter("reference", 6, "Quick reference", "", "Shortcuts, states and what comes next.", [
    blk("<h3>Keyboard</h3>" + keys_table),
    blk("<h3>Revision states</h3>" + states),
    blk("<h3>Not in this milestone yet</h3>" + limits),
])

EXTRA_CSS = """
.page { padding-bottom: 18mm; }
.flow-body { flex: 1 1 auto; min-height: 0; counter-reset: step; }
.flow-body > .blk + .blk { margin-top: 7mm; }
.flow-body > .blk.lead-blk + .blk { margin-top: 5mm; }
.flow-body > .blk.step + .blk.tip, .flow-body > .blk.tip + .blk.step { margin-top: 5mm; }
.run-head { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; font-size: 8pt; color: var(--color-text-secondary); padding-bottom: 2.4mm; margin-bottom: 6mm; border-bottom: 1px solid var(--color-border-subtle); }
.run-head .ch { color: var(--color-primary); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.lead { max-width: 70ch; }
.blk h3 { font-size: 12pt; font-weight: 600; line-height: 1.3; margin-bottom: 1.4mm; display: flex; align-items: center; gap: 2.6mm; }
.blk p, .blk li { font-size: 9.6pt; line-height: 1.5; max-width: 82ch; }
.blk p + p, .blk p + ul, .blk ul + p { margin-top: 1.6mm; }
.blk ul { margin-top: 1mm; }
.blk li + li { margin-top: 0.6mm; }
.step { counter-increment: step; }
.step h3 .n::before { content: counter(step); }
.step h3 .n { flex: 0 0 auto; width: 7mm; height: 7mm; border-radius: 50%; background: var(--color-primary); color: var(--color-on-primary); font-size: 9pt; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
.ui { font-weight: 600; color: var(--color-primary); }
.q { color: var(--color-text); }
kbd { white-space: nowrap; }
.shot { margin: 3.5mm 0 0; }
.shot .imgs { display: flex; gap: 5mm; align-items: flex-start; }
.shot .imgs img { min-width: 0; flex: 0 1 auto; }
.shot img { display: block; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-control); background: var(--color-surface); width: auto; height: auto; max-width: 150mm; max-height: 100mm; }
.shot.m img { max-width: 118mm; max-height: 80mm; }
.shot.pair img { max-width: calc((178mm - 5mm) / 2); max-height: 70mm; }
.shot.duo img.wide { max-width: 128mm; }
.shot.duo img.tall { max-height: 80mm; }
.shot.tall-page img { max-width: 178mm; max-height: 196mm; }
.shot figcaption { margin-top: 2mm; font-size: 8.4pt; line-height: 1.4; color: var(--color-text-secondary); }
.tip .callout p { font-size: 9.4pt; }
.journey .hop { grid-template-columns: 24mm 1fr; }
.journey .what { font-size: 9.6pt; padding: 3mm 4mm; }
.cards .card p { font-size: 9.2pt; line-height: 1.48; }
.cards .card p + p { margin-top: 1.6mm; }
.toc-title { font-size: 11pt; margin-bottom: 1mm; }
.toc li { padding: 2.1mm 0; }
.limits { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 6mm; }
.limit { background: var(--color-surface); border: 1px solid var(--color-border-subtle); border-left: 3px solid var(--color-warning); border-radius: 0 var(--radius-control) var(--radius-control) 0; padding: 3mm 4mm; }
.limit h3 { font-size: 10pt; margin-bottom: 0.8mm; }
.limit p { font-size: 9pt; line-height: 1.45; }
.blk > h3 + table, .blk > h3 + dl, .blk > h3 + .limits { margin-top: 2.4mm; }
table.data td { font-size: 9pt; }
.rows { grid-template-columns: 42mm 1fr; }
.cover h1 { max-width: 15ch; }
.cover .cover-meta { grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 178mm; }
"""

PAGINATOR = r"""
<script>
(async function () {
  if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
  await document.fonts.ready;
  const FOOT = %(foot)s;
  const footer = '<div class="page-footer"><span>' + FOOT + '</span><span class="num"></span></div>';
  function makePage(src, first, startAt) {
    const sec = document.createElement('section');
    sec.className = 'page';
    sec.dataset.part = src.dataset.part;
    const n = src.dataset.number;
    const head = first
      ? '<div class="page-head"><div><span class="eyebrow">Chapter ' + n + '</span><h2>' + src.dataset.title + '</h2></div><div class="meta">' + src.dataset.meta + '</div></div>'
      : '<div class="run-head"><span class="ch">' + n + ' · ' + src.dataset.run + '</span><span>' + src.dataset.meta + '</span></div>';
    sec.innerHTML = head + '<div class="flow-body"></div>' + footer;
    src.parentNode.insertBefore(sec, src);
    const body = sec.querySelector('.flow-body');
    body.style.counterReset = 'step ' + startAt;
    return { sec, body };
  }
  const fits = (sec, body) => {
    if (sec.scrollWidth > sec.clientWidth + 1) return false;
    const limit = sec.getBoundingClientRect().top + sec.clientHeight - parseFloat(getComputedStyle(sec).paddingBottom) - 2;
    const last = body.lastElementChild;
    return !last || last.getBoundingClientRect().bottom <= limit;
  };
  for (const src of Array.from(document.querySelectorAll('.flow-source'))) {
    let steps = 0;
    let cur = makePage(src, true, 0);
    for (const item of Array.from(src.children)) {
      cur.body.appendChild(item);
      if (fits(cur.sec, cur.body) || cur.body.children.length === 1) { if (item.classList.contains('step')) steps++; continue; }
      cur.body.removeChild(item);
      cur = makePage(src, false, steps);
      cur.body.appendChild(item);
      if (item.classList.contains('step')) steps++;
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

doc = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>NestSelf content library, tutorial</title>'
       '<link rel="stylesheet" href="../../tasks/calls-webinars/pdf/styles.css"><style>' + EXTRA_CSS + '</style></head><body>\n'
       + "".join(PARTS) + PAGINATOR % {"foot": json.dumps(FOOT)} + "</body></html>\n")

for bad in ("—", " – "):
    if bad in re.sub(r"<[^>]+>", "", doc):
        raise SystemExit(f"dash {bad!r} found in the manual text")

OUT.write_text(doc, encoding="utf-8")
on_disk = sorted(str(p.relative_to(SHOTS)) for p in SHOTS.rglob("*.png"))
unused = sorted(set(on_disk) - set(SHOTS_USED))
print(f"wrote {OUT.relative_to(REPO)}: {len(CHAPTERS)} chapters, {len(set(SHOTS_USED))} screenshots")
if unused:
    print("screenshots not in the tutorial: " + ", ".join(unused))
