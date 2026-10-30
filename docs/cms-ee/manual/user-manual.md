# NestSelf content library: user manual (milestone 1)

This manual covers the first milestone of the content library:
- NestSelf staff write an article in Serbian, Hungarian and English, review it and publish it;
- employees of client organisations read it in their language and save it for later.

It follows one article from an empty page to an employee's screen. Every screenshot comes from the automated journey that tests these screens (`e2e/content/editor.spec.ts` and `e2e/content/m1.spec.ts`), run against a local API with the fictional sample organisations.

The developer reference for the editor is `docs/cms-ee/editor.md`. The specification is `docs/tasks/cms-ee/cms-ee-strategy.md`.

## Who does what

| Role | Where | What they can do |
|---|---|---|
| Author | Admin app, Content | Create articles in the categories assigned to them, write and edit drafts, preview, submit for review |
| Reviewer | Admin app, Content | Approve or return a submitted revision in their review discipline. They cannot review a revision they wrote or last edited |
| Publisher | Admin app, Content | Publish an approved article to its approved audience |
| Employee | Workspace | Read articles available to their organisation, in their language, and save them |

Access comes from grants (`content_author`, `content_reviewer` and `content_publisher`, scoped to categories) that NestSelf staff assign in the admin app under Access. A screen that you cannot use is hidden, but the API enforces every rule on its own.

## 1 Writing an article (author)

### Create the article

Open **Content** in the admin app and select **Create resource**. Choose the primary category, the review discipline (who may review it) and the language you start in, then give the article a title. **Create article** opens the editor on that language.

### The writing canvas

The editor is a calm page:
- the title sits at the top as a large heading;
- the article's properties are folded away under **Properties**;
- the body is a single writing area with no toolbar.

The save status sits top right and reads **Saving…**, **Saved**, **Offline, retrying** or **Conflict**.

![The empty editor](screenshots/author/editor-empty.png)
*An empty article. The hint in the body says how to add blocks.*

### Adding blocks with "/"

Type `/` anywhere in the body to open the block menu. It is grouped:
- **Text:** paragraph, heading 2, heading 3;
- **Lists:** bulleted, numbered, checklist;
- **Blocks:** quote, professional note, practical step, call to action, related resource;
- **Media:** image.

Keep typing to filter (for example `/num` for a numbered list). Move with the arrow keys and press Enter to insert, or Esc to close the menu and keep what you typed.

![The slash menu](screenshots/author/slash-menu.png)
*The block menu, grouped by kind.*

A few blocks have their own controls:
- **Professional note:** a callout. Choose its type (Tip, Warning or Disclaimer) in **Note type**.
- **Practical step:** a numbered card with a **Step title** and a description.
- **Checklist:** items with checkboxes. Enter adds an item; Enter on an empty item ends the list.

### Markdown shortcuts

At the start of an empty line:
- `## ` makes a heading;
- `### ` a subheading;
- `- ` a bulleted list;
- `1. ` a numbered list;
- `> ` a quote;
- `[] ` a checklist.

Italic is not used in NestSelf content, so `*text*` stays as typed.

### Formatting a selection

Select text to show the formatting bar:
- **Bold**;
- **Link**;
- **Turn into**, which changes the whole block, for example a paragraph into a heading.

Links accept `https://` addresses on the allowed list and links to other NestSelf content. Anything else is refused with a message under the address field.

![Formatting bar](screenshots/author/bubble-menu.png)
*The formatting bar on a selected word.*

![Link address](screenshots/author/link-popover.png)
*An `http://` address is refused: only https links and internal references are allowed.*

### Moving and changing blocks

Hover a block to show **+**, which adds a block below and opens the "/" menu, and the grip, which you drag to move the block. Selecting the grip opens the block menu:
- **Turn into**
- **Duplicate**
- **Delete**
- **Move up**
- **Move down**

From the keyboard:
- **Ctrl+/** (**Cmd+/** on a Mac) opens the same menu for the block that holds the cursor;
- **Alt+Shift+↑** and **Alt+Shift+↓** move the block.

![Block menu](screenshots/author/block-menu.png)
*The block menu opened from the grip.*

### Images

Insert **Image** from the "/" menu, or drop or paste an image into the body. The image uploads and is checked and processed before it appears, and the block shows each stage. Every image needs **Alt text**, a short description for people who cannot see it. The caption is optional.

![Image block](screenshots/author/image-upload.png)
*A processed image with its alt text and caption.*

### Call to action and related resource

A **Call to action** is the one button at the end of an article. Inserting it opens its settings:
- **Action**: suggest a topic, open another article or collection, or open a service;
- the target for that action;
- an optional **Button label** of up to 100 characters.

A **Related resource** shows a card for another article; search for it by title.

![Call to action settings](screenshots/author/cta-popover.png)
*The call to action points at another published article.*

### Properties

Open **Properties** to fill in:
- the **summary** that appears on cards;
- the **outcome** (what the reader will gain);
- the **reading time** in minutes;
- the **proposed audience**;
- the **sources**.

The proposed audience is required before you submit. In this milestone it is **All eligible**: every client organisation whose employees may read library content.

![Properties](screenshots/author/properties.png)
*Properties of the article.*

### Saving and conflicts

The editor saves on its own a moment after you stop typing, and before you leave the page. If someone else saved the same draft in the meantime, the editor stops saving and says so. **Reload server version** loads their copy so you can continue from it.

![Saved](screenshots/author/autosave-saved.png)
*The status reads Saved.*

![Conflict](screenshots/author/conflict.png)
*Someone else changed the draft; the editor waits for your choice.*

### Preview

**Preview** shows the article exactly as employees will see it, at the width of a phone (390 px), a desktop (1440 px) and a small phone (320 px).

![Phone preview](screenshots/author/preview-phone.png)
*The phone preview.*

![Desktop preview](screenshots/author/preview-desktop.png)
*The desktop preview.*

### Languages

An article is published in Serbian (Latin), Hungarian and English together. Use the language tabs to create and write each variant. Serbian (Cyrillic) is produced automatically from the Latin text: its tab is a read-only preview.

![Language tabs](screenshots/author/locale-tabs.png)
*The four language tabs. Cyrillic is derived from Latin.*

### Submit for review

**Submit for review** sends a variant to the reviewers. Submit each of the three languages. A submitted revision is locked until it is approved or returned.

![Submitted](screenshots/author/submitted.png)
*The Serbian variant is in review.*

## 2 Reviewing (reviewer)

Open the article in **Content** and switch to the language to review. The buttons:
- **Approve** accepts that exact revision.
- **Return for changes** sends it back to the author. A comment is required.

You cannot review a revision you wrote or last edited, or an article outside your review discipline.

![Return for changes](screenshots/reviewer/return-for-changes.png)
*The reviewer explains what needs to change.*

![Approved](screenshots/reviewer/approve.png)
*The revision is approved.*

In this milestone the comment is recorded with the review event but is not yet shown to the author on the article. Tell the author directly until the review history arrives in the next milestone.

## 3 Publishing (publisher)

When all three languages are approved, **Publish now** opens a confirmation. It shows the audience the reviewers approved. Publishing makes the article available to that audience at once in all four languages. A later approved revision replaces the live one when it is published.

![Publish dialog](screenshots/publisher/publish-dialog.png)
*The confirmation shows the approved audience.*

![Published](screenshots/publisher/published.png)
*The article is live.*

## 4 Reading (employee)

### Home and the article

Employees see on **Home** the articles available to their organisation. An article shows:
- its summary, outcome and reading time;
- the reviewer and the review date;
- the body, with notes, steps, checklists, images and the call to action.

![Home](screenshots/employee/home-desktop.png)
*Home on a desktop.*

![Article](screenshots/employee/article-detail.png)
*The article in English.*

![Article in Serbian](screenshots/employee/article-detail-sr.png)
*The same article after switching the language to Serbian.*

![Home on a phone](screenshots/employee/home-mobile.png)
*Home on a phone.*

### Language

Employees read in the language they choose under **Settings**. Serbian is available in Latin and in Cyrillic script.

![Cyrillic](screenshots/employee/cyrillic-detail.png)
*The article in Serbian Cyrillic.*

### Saved

**Save this resource** keeps an article under **Saved**.

![Saved](screenshots/employee/saved-desktop.png)
*The saved list.*

### Several organisations

A person who works for two client organisations switches between them with the context menu at the top. Each organisation sees only its own articles and its own saved list. An article that is not available in the current organisation shows a neutral "not available" page.

![Context switcher](screenshots/employee/context-switcher.png)
*Switching organisation.*

![Not available](screenshots/employee/content-unavailable-mobile.png)
*An article from another organisation is not available.*

## 5 Keyboard reference

| Keys | Where | Action |
|---|---|---|
| `/` | Body | Open the block menu |
| ↑ ↓, Enter, Esc | Block menu | Move, insert, close |
| Ctrl/Cmd+B | Selection | Bold |
| Ctrl/Cmd+/ | Any block | Open the block menu for this block |
| Alt+Shift+↑ / ↓ | Any block | Move the block up or down |
| `## `, `### `, `- `, `1. `, `> `, `[] ` | Start of a line | Heading, subheading, bulleted list, numbered list, quote, checklist |

## 6 What is not in this milestone yet

- **Audiences.** Publishing to specific organisations or teams, and scheduling publications, come with milestone 2. Today the editor offers "All eligible" and keeps any narrower audience already stored on an article.
- **Review history.** Return comments shown to the author, and in-app notifications for authors and reviewers, come with milestones 2 and 3.
- **Other formats and discovery.** Video, audio, practical guides, collections, search and categories on Home come with milestone 2.
