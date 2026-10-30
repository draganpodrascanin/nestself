# Content Editor (T-C1.12)

Notion-style rich text editor for the NestSelf CMS, built on Tiptap 3.32.0.

## Architecture

```
packages/content/src/editor/
  ContentEditor.tsx    — Main editor component (canvas, labels, layout)
  editor-extensions.ts — Full Tiptap extension set (schema, shortcuts, plugins)
  node-views.tsx       — React node views for interactive blocks (Phase B)
  SlashMenu.tsx        — "/" command palette with Floating UI positioning
  EditorBubbleMenu.tsx — Selection toolbar: Bold, Link, Turn Into
  BlockHandle.tsx      — Drag handle: "+", grip, block menu
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
| `ProfessionalNoteView` | content | Aside with note kind picker (tip/warning/disclaimer), border colour from tokens |
| `PracticalStepView` | content | Numbered badge, editable title input, body content |
| `ChecklistView` | content | `<ul>` wrapper |
| `ChecklistItemView` | content | `<li>` with a real checkbox that toggles `[x]` prefix in the `label` attr |
| `CtaView` | atom | Button preview, kind select, optional label input (max 100 chars) |
| `RelatedResourceView` | atom | Resource ID input (text for now; search picker planned) |
| `ImageView` | atom | Upload placeholder / asset reference, required alt text, optional caption |

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
- **Autosave**: 5-second debounce, one-in-flight with trailing save
  (`inflightRef`, `trailingRef`), `lockVersionRef` updated on each 200.
- **Conflict handling**: 409 shows a banner with "Reload server version"
  and "Keep mine" (overwrite with server's lockVersion).
- **Navigation blocking**: `useBlocker` from TanStack Router with
  `shouldBlockFn` + `enableBeforeUnload`; flush save on unmount.
- **Title**: Large borderless heading input styled with `type-section-title`
  (Notion-style; replaces the wrapped `<Field><Input>` from Phase A).
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
| `Mod-K` | Toggle link popover (dispatches `nestself:toggle-link` custom event) |
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
  The `Toolbar` component listens for it and toggles the link popover.
- **`nestself:toggle-block-menu`** — Fired by `Mod-/` on the
  `BlockKeyboardShortcuts` extension. The `BlockHandle` component listens
  for it, resolves the current block position, and opens the block menu.

## Accessibility

- Slash menu: `role="listbox"` with `aria-activedescendant`, arrow key navigation, Enter to select, Escape to close.
- Bubble menu: Buttons with `aria-label` and `aria-pressed`.
- Block handle: Buttons with `aria-label`, block menu with `role="menu"`.
- All menus animated per the Motion rule (popover preset) with reduced-motion support via `useMotionPreset`.

## Test coverage

### Unit tests (Vitest)

| File | Covers |
|---|---|
| `ContentEditor.test.tsx` | Round-trip (insert every block, export, reimport), slash menu insertion, bubble menu bold toggle, keyboard shortcuts (Mod-I swallowed, Mod-K link event, Mod-/ block menu event, Alt-Shift-Arrow block move), markdown shortcut input rules (shipped extension verification), converter cleanup, paste normalization, extension factory configuration |
| `node-views.test.tsx` | All 7 node view components: rendering, attribute updates via `updateAttributes`, editable vs read-only gating, checkbox toggle |
| `$locale.test.tsx` (admin) | Route loading, locale tabs, properties accordion (collapsed by default, expand to verify), preview panel, workflow buttons, useBlocker, conflict state, revision badges, borderless title input |

### Storybook stories

`ContentEditor.stories.tsx`: Empty, WithContent, ReadOnly, CustomLabels,
AllBlocks (every custom block type), AllBlocksReadOnly.

### E2E (Playwright)

`e2e/content/editor.spec.ts` (`@editor` tag): Author creates resource via
API, opens editor, expands properties panel, checks locale tabs, toggles
preview, fills content and submits; reviewer approves; publisher publishes.
Screenshots saved to `docs/cms-ee/manual/screenshots/{author,reviewer,publisher}/`.
Run with `pnpm e2e:content -g "@editor"`.

## Tiptap documentation URLs

- Suggestion utility: https://tiptap.dev/docs/editor/api/utilities/suggestion
- Drag handle React: https://tiptap.dev/docs/editor/extensions/functionality/drag-handle-react
- Bubble menu: https://tiptap.dev/docs/editor/extensions/functionality/bubble-menu
- Placeholder: https://tiptap.dev/docs/editor/extensions/functionality/placeholder
- TrailingNode: https://tiptap.dev/docs/editor/extensions/functionality/trailing-node
- `useEditorState`: https://tiptap.dev/docs/editor/getting-started/install/react
