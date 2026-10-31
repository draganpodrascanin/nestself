# CMS editor: writing sheet, block handle and drag

Date: 2026-10-31. Branch `feat/cms-ee`. Follows the M1 editor (`docs/cms-ee/editor.md`).

## Problem

Dragan's review of the merged editor: "colors are off, there's no separation of
objects, I want background white when we write content, there should on the left
'+' and drag buttons that follow the cursor".

Findings:

- The page paints title, properties and body straight onto the pale canvas
  (`--color-canvas`), so nothing separates the writing area from the page chrome,
  and tinted blocks (image frame `bg-tint`, step, related) blend into it.
- `BlockHandle.tsx` fades the "+" and grip in with `group-hover/drag-handle`, but
  no ancestor carries `group/drag-handle`. The buttons stay at opacity 0 until the
  pointer lands on them, so in practice nobody sees them follow the cursor.
- "+" inserts a new paragraph below and types "/". Dragan expects it to offer the
  block types for the hovered line.
- Dragging the grip moves blocks (synthetic drag) but shows no drop indicator and
  no in-flight state.

## Design

### 1. Writing sheet

- Title, properties accordion (or the derived-locale metadata) and the body
  editor sit in one card: `bg-surface`, `border border-border-subtle`,
  `shadow-low`, `rounded-control`, centred, `max-w-[52rem]`.
- Padding: `py-10`, `pr-10`, `pl-16` (a 4 rem left gutter that the handle
  occupies; the handle is positioned at the block's left edge minus its width,
  so it lands inside the sheet).
- The rest of the page (heading, locale tabs, alerts, actions, preview) stays
  on the canvas, unchanged.
- Inside the sheet the image figure loses its tinted frame: the image renders
  bare with `rounded-control`; the alt and caption fields keep their borders but
  use `type-metadata` and `border-border-subtle`. Notes keep their
  info/warning surfaces; steps, related and CTA keep thin borders on
  `bg-surface` (no `bg-tint`).

### 2. "+" and grip follow the cursor

- The handle wrapper is visible whenever Tiptap shows it (the plugin toggles
  `visibility`). The inner pair fades in and out with
  `transition-opacity duration-[var(--motion-fast)] ease-standard` driven by a
  `data-visible` attribute set from the plugin's `onNodeChange` and the wrapper's
  visibility (MutationObserver on `style`), not by a hover class.
- "+" opens the block picker: the same `SlashMenuPopup` list as "/" (groups,
  filter by typing, arrow keys, Enter, Escape), anchored to the handle. The popup
  component moves to `BlockPicker.tsx` and is shared by the slash menu and the
  handle.
- Choosing an item with the hovered block `pos`:
  - text types (paragraph, heading 2/3, bullet, numbered, checklist, quote) turn
    the hovered block into that type, keeping its text;
  - insertables (image, note, step, CTA, related) replace the block when it is an
    empty paragraph, otherwise insert after it.
  - Implementation: place the selection inside the hovered block, then run the
    item's existing `command` with a collapsed `range` at the block's text start
    (text types) or call a new `insertAfter` helper that sets the selection at
    the block end before running the command (insertables). Items gain an
    `insert: boolean` flag so the handle knows which rule applies.
- Labels: "Add block" stays as the accessible name; the picker's listbox keeps
  `aria-label` = slash placeholder ("Filter blocks…").

### 3. Grip = drag, click = menu

- `useSyntheticDrag` stays the move mechanism. During a committed drag:
  - the source block gets `data-dragging="true"` (opacity 0.4 via a class on
    the editor root: `[&_[data-dragging=true]]:opacity-40`, transition on the
    fast token);
  - a fixed-position 2 px `bg-primary` drop line is rendered in the handle's
    portal at the top or bottom edge of the block under the pointer (above when
    the pointer is in the upper half, below otherwise), updated on `mousemove`;
  - the cursor is `grabbing` (class on `document.body` while dragging).
- Drop resolves to the same top-level block logic as today; moving onto the
  source block or its own edge is a no-op.
- A click without 5 px travel still opens the block menu (Turn into, Duplicate,
  Move up, Move down, Delete). Keyboard unchanged: Ctrl/Cmd+/ opens the menu,
  Alt+Shift+↑/↓ moves.

## Out of scope

Nested drag (list items into other lists), multi-block selection, the employee
reader, M2 features.

## Tests and proof

- Unit (`packages/content`): BlockHandle test file — "+" opens the picker and a
  pick converts the hovered paragraph to heading 2; an insertable on a filled
  paragraph inserts after it; on an empty paragraph it replaces it; the drop
  indicator appears during a drag and the block moves on mouseup.
- Motion: existing `editor block menu` and `editor slash menu` cases; add
  `editor handle picker` (opened from "+") to `popouts.motion.ts`.
- E2E gate `e2e/content/editor.spec.ts` step 6: hover shows the handle, "+"
  turns a paragraph into a heading, drag moves a block with the indicator
  visible; new screenshots `block-handle.png` and `block-picker.png`.
- `pnpm --filter @nestself/content lint typecheck test`, admin tests,
  `pnpm check`, `pnpm e2e:content -g "@editor"`, `pnpm e2e:motion`.
- Manual: `docs/cms-ee/editor.md` and the tutorial PDF rebuilt
  (`pnpm docs:cms:pdf`).
