# Content Editor (T-C1.12)

Notion-style rich text editor for the NestSelf CMS, built on Tiptap 3.32.0.

## Architecture

```
packages/content/src/editor/
  ContentEditor.tsx    — Main editor component (canvas, labels, layout)
  editor-extensions.ts — Full Tiptap extension set (schema, shortcuts, plugins)
  node-views.tsx       — React node views for interactive blocks (Phase B)
  BlockDialogs.tsx     — Call-to-action and related-resource dialogs, resource picker
  node-view-labels.ts  — Translated labels and host handlers (upload, search) for node views
  SlashMenu.tsx        — "/" command palette with Floating UI positioning
  EditorBubbleMenu.tsx — Selection toolbar: Bold, Link, Turn Into
  BlockHandle.tsx      — Block handle: "+" (block picker), grip (drag, block menu), drop line
  BlockPicker.tsx      — The grouped, filterable block list shared by "/" and "+"
  block-pick.ts        — Applies a picker choice to the hovered block (re-type in place or insert below)
  Toolbar.tsx          — Legacy permanent toolbar (kept for backward compat)
  converters.ts        — ContentDocument ↔ Tiptap JSON (strips extraneous attrs)
  paste-handler.ts     — Paste normalization (FMT-R-12)
  index.ts             — Public exports
```

### Extension list

| Extension | Source | Purpose |
|---|---|---|
| StarterKit | `@tiptap/starter-kit` 3.32.0 | Bold, lists, hardBreak, history (heading/code/blockquote/link/underline/strike disabled) |
| SectionHeading | custom | h2/h3 with `data-type` round-trip |
| Quote | custom | Blockquote with optional attribution |
| Image | custom | Atom node with `mediaAssetId`, `alt`, `caption` |
| ProfessionalNote | custom | Callout (tip/warning/info) |
| PracticalStep | custom | Numbered step with editable title |
| Checklist / ChecklistItem | custom | Real checkbox items |
| ApprovedMedia / Transcript | custom | Audio/video/PDF with transcript |
| RelatedResource | custom | Atom node linking to another content resource |
| Cta | custom | Call-to-action with kind/target/label |
| Link | custom | Mark with `href` only (replaces StarterKit link) |
| DisableItalicInput | custom | Swallows Mod-I; italic mark kept in schema for storage compat |
| BlockKeyboardShortcuts | custom | Alt+Shift+Arrow up/down for block reordering |
| Placeholder | `@tiptap/extensions` | Per-node-type placeholders ("Type '/' for blocks", "Heading") |
| TrailingNode | `@tiptap/extensions` | Always a paragraph at the end |
| Dropcursor | `@tiptap/extensions` | Visual drag indicator |
| DragHandle | `@tiptap/extension-drag-handle` | Block-level drag & drop |
| SlashMenu | custom (wraps `@tiptap/suggestion`) | "/" command palette |

### React node views (`node-views.tsx`)

Seven custom blocks have interactive React node views, registered via
`ReactNodeViewRenderer` from `@tiptap/react`:

| Node view | Type | Behaviour |
|---|---|---|
| `ProfessionalNoteView` | content | Callout with the renderer's icon and colours; "Note type" is the `@nestself/ui` Select (Tip, Warning, Disclaimer) |
| `PracticalStepView` | content | Numbered badge, "Step title" input, editable body |
| `ChecklistView` | content | `<ul>` wrapper |
| `ChecklistItemView` | content | `<li>` with a real checkbox that toggles `[x]` prefix in the `label` attr |
| `CtaView` | atom | Button preview; a click opens the call-to-action dialog for this node |
| `RelatedResourceView` | atom | Card with the picked resource's title (never the id); a click opens the picker |
| `ImageView` | atom | Uploading / Processing states, the rendition as an `<img>`, "Alt text" and "Caption"; a failed upload is a visible alert |

### Call-to-action and related-resource dialogs (`BlockDialogs.tsx`)

Both blocks carry a target the schema requires, so they are never inserted half-configured. The slash command and a click on an existing block dispatch `nestself:block-dialog` on `editor.view.dom`; `BlockDialogs` (mounted by `ContentEditor`) opens a `Dialog` from `@nestself/ui` and inserts or updates the node only on confirm. Cancel or Escape leaves the document unchanged.

- **Call to action:** "Action" (Select: Suggest topic, Open content, Open collection, Open service), then the target: a resource picker for content or collections (collections only list resources of type `collection`), a Select of the content capabilities for a service. "Button label" is optional, at most 100 characters. "Done" is refused with a visible field error while a needed target is missing.
- **Related resource:** a resource picker; choosing a result confirms.
- **Resource picker:** an ARIA combobox (`aria-activedescendant`, arrow keys, Enter, Escape closes the list only) over the host's `ResourceSearchHandler`. The admin app passes `GET /api/ops/cms/resources?q=`, a title search with LIKE wildcards escaped. Searching, no results and a failed search are shown in the list. The listbox animates through the popover preset.

All node views switch between editable and read-only modes based on
`editor.isEditable`. They use semantic token classes (`text-text`,
`bg-surface`, `border-border-control`, etc.) and no hex literals.

### How documents map to the strict schema

The editor's internal JSON is `{type:'doc', content:[...]}`. `toContentDocument()` wraps it in a `ContentDocument` envelope with `schemaVersion` and strips extraneous attributes (e.g. `orderedList.type`, link mark's `target`/`rel`). `fromContentDocument()` strips `schemaVersion` for `setContent()`. The Zod schema in `packages/content/src/schema/` validates the document on save.

## Admin integration (Phase A)

The variant editor route
(`apps/admin/src/routes/_authenticated/cms/resources/$resourceId/variants/$locale.tsx`)
connects the `ContentEditor` to the CMS API:

- **API mode**: `createCmsApi(api)` factory from `@nestself/api-client` for
  `getResource`, `saveRevision` (If-Match ETag), `submitRevision`,
  `approveRevision`, `publishNow`, `createNewRevision`.
- **Autosave**: 1-second debounce (`AUTOSAVE_DELAY_MS`), one-in-flight with trailing save
  (`inflightRef`, `trailingRef`), `lockVersionRef` updated on each 200.
- **Conflict handling**: 409 shows an alert with "Reload server version",
  which loads the server's copy into the editor.
- **Navigation blocking**: `useBlocker` from TanStack Router with
  `shouldBlockFn` + `enableBeforeUnload`; flush save on unmount.
- **Title and canvas**: a large borderless title (`type-display`) and a borderless
  writing canvas; the "Body" heading is visually hidden. Empty nodes show translated
  placeholders ("Type “/” for blocks", "Heading").
- **Collapsible properties panel**: `Accordion` from `@nestself/ui`
  containing summary, outcome, duration (minutes), sources, proposedAudience.
  Starts collapsed (`defaultValue={[]}`); the author expands to fill.
- **Locale tabs**: All four locales (sr-Latn, hu, en, sr-Cyrl) with
  revision state badges.
- **Preview panel**: Toggle with disclosure motion preset, 390/1440/320px
  width switcher, `ContentRenderer` rendering the current document.
- **Workflow actions**: Submit (draft/changes_requested), Approve
  (in_review), Publish now (approved), New revision (approved/superseded).

## How to add a block

1. **Schema**: Add a Zod schema to `packages/content/src/schema/blocks.ts`, add it to `BlockNodeSchema`.
2. **Extension**: Create the Tiptap `Node` in `editor-extensions.ts` with `parseHTML`/`renderHTML` using `data-*` attributes.
3. **Node view** (optional): For interactive blocks, use `ReactNodeViewRenderer`.
4. **Renderer**: Add the block to `packages/content/src/render/ContentBody.tsx`.
5. **Slash item**: Add an entry in `createSlashMenuItems()` in `SlashMenu.tsx`.
6. **Converter**: If the node has attrs that need cleanup, add a case in `cleanNode()` in `converters.ts`.
7. **Tests**: Add the block to the round-trip test in `ContentEditor.test.tsx` and write a renderer test.
8. **i18n**: Add labels to `packages/i18n/locales/{en,hu,sr-Latn}/cms.json` (sr-Cyrl is generated).

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `/` | Open slash command menu |
| `Mod-B` | Toggle bold |
| `Mod-K` | Open the link popover for the selection (dispatches `nestself:toggle-link`) |
| `Mod-/` | Toggle block menu (dispatches `nestself:toggle-block-menu` custom event) |
| `Mod-Alt-2` | Toggle heading 2 |
| `Mod-Alt-3` | Toggle heading 3 |
| `Alt-Shift-ArrowUp` | Move current block up |
| `Alt-Shift-ArrowDown` | Move current block down |
| `## ` | Markdown shortcut: heading 2 |
| `### ` | Markdown shortcut: heading 3 |
| `- ` | Markdown shortcut: bullet list |
| `1. ` | Markdown shortcut: ordered list |
| `> ` | Markdown shortcut: blockquote |
| `[] ` | Markdown shortcut: checklist |

Note: `Mod-I` (italic) is intentionally swallowed. The italic mark exists in storage for backward compatibility but cannot be created by users.

### Custom event communication

Tiptap extensions cannot directly control React component state in the
Toolbar or BlockHandle. Two keyboard shortcuts dispatch custom events on
`editor.view.dom`:

- **`nestself:toggle-link`** — Fired by `Mod-K` on the Link mark extension.
  `EditorBubbleMenu` opens the link popover when text is selected (the legacy
  `Toolbar` listens too).
- **`nestself:toggle-block-menu`** — Fired by `Mod-/` on the
  `BlockKeyboardShortcuts` extension. The `BlockHandle` component listens
  for it, resolves the current block position, and opens the block menu at
  that block. The menu renders in a portal: Tiptap hides the hover handle on
  keydown, so a menu inside it could open invisible.
- **`nestself:block-dialog`** — Fired by the slash menu and the CTA and
  related-resource node views; `BlockDialogs` opens the matching dialog.

## Block handle

`@tiptap/extension-drag-handle-react` positions the handle (`left-start` of the hovered top-level block) and reports the block through `onNodeChange`; the pair is visible while the plugin shows it and fades on the fast token (the plugin's `visibility: hidden` is cleared before paint so the exit plays; its `pointer-events: none` keeps the fading pair inert).

- **"+"** opens `BlockPicker` in standalone mode (own filter input) anchored to the button. `applyBlockPick(editor, pos, item)` runs the item's slash command with a collapsed range: a text type (paragraph, heading, list, quote) re-types a text block in place; an insertable (`item.insert`: image, note, step, call to action, related resource) replaces an empty paragraph and otherwise lands in a fresh paragraph after the block. Text types after an atom (image, CTA, related) also start a new block below.
- **Grip:** `mousedown` starts a synthetic drag (works with CDP mouse events, unlike HTML5 drag and drop). Past 5 px the handle locks, the block is marked through the `DraggingBlock` decoration and `dropLineAt()` places a 2 px `bg-primary` line above or below the block under the pointer (pointer clamped into the editor, so the gutter works). `mouseup` calls `moveBlock(editor, from, insertPos)`. A click without travel opens the block menu.
- The writing sheet in the admin editor (`data-testid="writing-sheet"`) is a white card with a 4 rem left gutter for the handle; Storybook's `EditorWrapper` has the same gutter.

## Accessibility

- Editor body: `role="textbox"`, `aria-multiline`, named by `labels.editorLabel` ("Content editor").
- Slash menu: `role="listbox"` named "Filter blocks…", one `role="group"` per group, `aria-activedescendant`, arrows, Enter, Escape (keeps the typed text).
- Formatting bar: `role="toolbar"` named "Format" with Bold, Link and Turn into; no italic. Escape closes its popovers from anywhere and returns to the selection.
- Block handle: "Add block" opens the block picker, a `combobox` input (named "Filter blocks…", focused on open) controlling the same `listbox` as the slash menu; "Drag or open menu" opens the `role="menu"` block menu, which takes focus on open. The pair fades in beside the hovered block and out when the pointer leaves (`data-block-handle[data-visible]`).
- Dialogs: `Dialog` from `@nestself/ui` (focus trap, Escape, labelled close button); fields are `Field`-labelled.
- Every label is translated: the admin app passes `labels.nodeView`, `labels.bubbleMenu.format` and the placeholders from `cms.json`.
- Motion: menus, popovers and the picker list animate in and out through the popover preset; the drop line fades through the backdrop preset and the dragged block dims through a node decoration (`data-dragging`, `DraggingBlock` extension); the formatting bar fades by a token transition on the visibility Tiptap sets; dialogs use the dialog and backdrop presets. `e2e/motion/popouts.motion.ts` covers the slash menu, the "+" block picker, the block menu and the resource picker (stories in `ContentEditor.stories.tsx` and `BlockDialogs.stories.tsx`).

## Test coverage

### Unit tests (Vitest)

| File | Covers |
|---|---|
| `ContentEditor.test.tsx` | Round-trip (insert every block, export, reimport), slash menu insertion, bubble menu bold toggle, keyboard shortcuts (Mod-I swallowed, Mod-K link event, Mod-/ block menu event, Alt-Shift-Arrow block move), markdown shortcut input rules (shipped extension verification), converter cleanup, paste normalization, extension factory configuration |
| `node-views.test.tsx` | Node views: rendering, `updateAttributes`, editable vs read-only, dialog requests from CTA and related cards, labelled image inputs |
| `BlockDialogs.test.tsx` | Done blocked without a target, confirmed attrs per action, services, cancel, related confirm, picker error / empty / type filter / keyboard |
| `-locale.test.tsx` (admin) | Sample mode: loading, locale tabs, properties, preview, workflow buttons, derived locale |
| `-locale.api.test.tsx` (admin) | API mode: load failure, not found, submit failure, return and publish errors inside their dialogs, publish sends the stored audience |

### Storybook stories

`ContentEditor.stories.tsx`: Empty, WithContent, ReadOnly, CustomLabels,
AllBlocks (every custom block type), AllBlocksReadOnly.
`BlockDialogs.stories.tsx`: ResourcePickerStates, CallToAction.
Storybook (`packages/ui/.storybook/main.ts`) includes the editor stories.

### E2E (Playwright)

`e2e/content/editor.spec.ts` (`@editor` tag, 19 serial steps) drives the UI only and reads the stored revision back after each step (`readRevision` in `editor-helpers.ts`): create, canvas, slash menu and node views, markdown shortcuts, formatting bar and links (including Mod-K), block handle (hover, "+" picker, menu, keyboard, drag with the drop line), image upload, call to action and related resource, properties, reload, conflict, preview widths, other locales, submit, return, resubmit, approve, publish, and the employee's view in English and Serbian. It writes the manual's screenshots at 2x to `docs/cms-ee/manual/screenshots/`, cropped around the detail with `shoot(page, role, name, { around })`. Run with `pnpm e2e:content -g "@editor"`.

## Tiptap documentation URLs

- Suggestion utility: https://tiptap.dev/docs/editor/api/utilities/suggestion
- Drag handle React: https://tiptap.dev/docs/editor/extensions/functionality/drag-handle-react
- Bubble menu: https://tiptap.dev/docs/editor/extensions/functionality/bubble-menu
- Placeholder: https://tiptap.dev/docs/editor/extensions/functionality/placeholder
- TrailingNode: https://tiptap.dev/docs/editor/extensions/functionality/trailing-node
- `useEditorState`: https://tiptap.dev/docs/editor/getting-started/install/react
- Node views with React: https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react
