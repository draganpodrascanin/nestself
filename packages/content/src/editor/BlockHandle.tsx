/**
 * Block handle — the "+" and drag grip that follow the pointer along the left
 * edge of whichever block it is over.
 *
 * `@tiptap/extension-drag-handle-react` positions the handle and tells us the
 * hovered block (`onNodeChange`); the pair fades in and out on the fast token.
 * - "+" opens the block picker (the slash menu's list) for that block: a text
 *   type re-types it in place, an insertable replaces an empty line or lands
 *   below a filled one (`block-pick.ts`).
 * - The grip drags the block up or down: the block dims while in flight and a
 *   drop line shows where it lands. A plain click opens the block menu
 *   (turn into, duplicate, move up/down, delete).
 *
 * Keyboard alternative: Alt+Shift+Up/Down for move, Ctrl/Cmd+/ for the menu.
 * Animated per the Motion rule. Colour: semantic tokens only.
 */
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import {
  m,
  AnimatePresence,
  MotionFeatures,
  useMotionPreset,
} from '@nestself/ui';
import { BlockPicker } from './BlockPicker.tsx';
import type { SlashMenuItem, SlashMenuLabels } from './SlashMenu.tsx';
import { applyBlockPick } from './block-pick.ts';
import { draggingBlockKey } from './editor-extensions.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockHandleLabels {
  addBlock: string;
  dragBlock: string;
  turnInto: string;
  duplicate: string;
  delete: string;
  moveUp: string;
  moveDown: string;
  paragraph: string;
  heading2: string;
  heading3: string;
  quote: string;
}

export interface BlockHandleProps {
  editor: Editor;
  labels: BlockHandleLabels;
  /** Block types the "+" offers: the slash menu's items. */
  items: SlashMenuItem[];
  pickerLabels: SlashMenuLabels;
}

interface BlockTarget {
  node: PmNode;
  pos: number;
}

interface DropLine {
  /** Viewport geometry of the line. */
  x: number;
  y: number;
  width: number;
  /** Document position the dragged block is inserted at. */
  insertPos: number;
}

// Estimated popup sizes used to keep menus inside the viewport before they
// render (the picker is w-72 / max-h-80, the menu w-48).
const PICKER_WIDTH = 288;
const PICKER_HEIGHT = 360;
const MENU_WIDTH = 192;
const MENU_HEIGHT = 240;
const VIEWPORT_MARGIN = 8;

function clampToViewport(x: number, y: number, width: number, height: number) {
  if (typeof window === 'undefined') return { x, y };
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN)),
  };
}

// ---------------------------------------------------------------------------
// Icons (Phosphor regular, 16px)
// ---------------------------------------------------------------------------

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" />
    </svg>
  );
}

function IconDragGrip() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M104,60A12,12,0,1,1,92,48,12,12,0,0,1,104,60Zm60-12a12,12,0,1,0,12,12A12,12,0,0,0,164,48ZM92,116a12,12,0,1,0,12,12A12,12,0,0,0,92,116Zm72,0a12,12,0,1,0,12,12A12,12,0,0,0,164,116ZM92,184a12,12,0,1,0,12,12A12,12,0,0,0,92,184Zm72,0a12,12,0,1,0,12,12A12,12,0,0,0,164,184Z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z" />
    </svg>
  );
}

function IconArrowUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,205.66,117.66Z" />
    </svg>
  );
}

function IconArrowDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M205.66,149.66l-80,80a8,8,0,0,1-11.32,0l-80-80a8,8,0,0,1,11.32-11.32L120,212.69V40a8,8,0,0,1,16,0V212.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Block menu (opens from the drag grip or Ctrl/Cmd+/)
// ---------------------------------------------------------------------------

interface BlockMenuProps {
  editor: Editor;
  target: BlockTarget;
  labels: BlockHandleLabels;
  /** Viewport position of the top-left corner. */
  fixedAt: { x: number; y: number };
  onClose: () => void;
}

function BlockMenu({ editor, target, labels, fixedAt, onClose }: BlockMenuProps) {
  const { node, pos } = target;
  const menuRef = useRef<HTMLDivElement>(null);
  const popoverMotion = useMotionPreset('popover');
  const [showTurnInto, setShowTurnInto] = useState(false);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Focus the first item as the menu mounts (not a frame later, which would
  // take focus back from an item the user already moved to).
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  const handleTurnInto = useCallback(
    (nodeType: string, attrs?: Record<string, unknown>) => {
      try {
        // For wrapper node types like quote, use wrapIn
        if (nodeType === 'quote') {
          // First, if the node is already inside a quote, lift it out
          if (node.type.name === 'quote') {
            editor.chain().focus().setNodeSelection(pos).lift('quote').run();
          } else {
            // Set cursor inside the node, then wrap
            editor.chain().focus().setTextSelection(pos + 1).wrapIn(nodeType, attrs).run();
          }
        } else if (node.type.name === 'quote') {
          // Turning a quote into something else: lift content and set node type
          editor.chain().focus().setTextSelection(pos + 1).lift('quote').setNode(nodeType, attrs).run();
        } else {
          editor.chain().focus().setNodeSelection(pos).setNode(nodeType, attrs).run();
        }
      } catch {
        // Fallback: try setNode on text selection
        try {
          editor.chain().focus().setTextSelection(pos + 1).setNode(nodeType, attrs).run();
        } catch {
          // Incompatible conversion
        }
      }
      onClose();
    },
    [editor, pos, node, onClose],
  );

  const handleDuplicate = useCallback(() => {
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, node.toJSON())
      .run();
    onClose();
  }, [editor, pos, node, onClose]);

  const handleDelete = useCallback(() => {
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
    onClose();
  }, [editor, pos, node, onClose]);

  const handleMoveUp = useCallback(() => {
    if (pos <= 0) return;
    try {
      const $pos = editor.state.doc.resolve(pos);
      const depth = $pos.depth;
      const parentDepth = depth >= 1 ? depth : 0;
      if ($pos.index(parentDepth) <= 0) return;
      const prevStart = $pos.posAtIndex($pos.index(parentDepth) - 1, parentDepth);
      const { tr } = editor.state;
      const nodeSlice = editor.state.doc.slice(pos, pos + node.nodeSize);
      tr.delete(pos, pos + node.nodeSize);
      tr.insert(prevStart, nodeSlice.content);
      tr.setSelection(TextSelection.near(tr.doc.resolve(prevStart + 1)));
      editor.view.dispatch(tr);
    } catch {
      // At boundary; ignore
    }
    onClose();
  }, [editor, pos, node, onClose]);

  const handleMoveDown = useCallback(() => {
    const end = pos + node.nodeSize;
    if (end >= editor.state.doc.content.size) return;
    const nextNode = editor.state.doc.nodeAt(end);
    if (!nextNode) return;
    const { tr } = editor.state;
    const nodeSlice = editor.state.doc.slice(pos, end);
    tr.delete(pos, end);
    const insertPos = pos + nextNode.nodeSize;
    tr.insert(insertPos, nodeSlice.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
    editor.view.dispatch(tr);
    onClose();
  }, [editor, pos, node, onClose]);

  const turnIntoOptions = [
    { label: labels.paragraph, command: () => handleTurnInto('paragraph') },
    { label: labels.heading2, command: () => handleTurnInto('sectionHeading', { level: 2 }) },
    { label: labels.heading3, command: () => handleTurnInto('sectionHeading', { level: 3 }) },
    { label: labels.quote, command: () => handleTurnInto('quote') },
  ];

  const itemClass =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left type-body text-text hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard';

  return (
    <m.div
      ref={menuRef}
      {...popoverMotion}
      className="fixed z-[var(--z-dropdown)] w-48 rounded-control border border-border-subtle bg-surface py-1 shadow-menu"
      style={{ left: fixedAt.x, top: fixedAt.y }}
      role="menu"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
          if (buttons.length === 0) return;
          const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            e.key === 'ArrowDown'
              ? idx < buttons.length - 1 ? idx + 1 : 0
              : idx > 0 ? idx - 1 : buttons.length - 1;
          buttons[next]?.focus();
        }
      }}
    >
      {/* Turn into submenu */}
      <div className="relative">
        <button type="button" role="menuitem" className={itemClass} onClick={() => setShowTurnInto((v) => !v)}>
          <span className="flex-1">{labels.turnInto}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 256 256"
            fill="currentColor"
            aria-hidden="true"
            className={showTurnInto ? 'rotate-90' : ''}
          >
            <path d="M181.66,133.66l-80,80A8,8,0,0,1,88,208V48a8,8,0,0,1,13.66-5.66l80,80A8,8,0,0,1,181.66,133.66Z" />
          </svg>
        </button>
        <AnimatePresence>
          {showTurnInto ? (
            <m.div {...popoverMotion} className="border-t border-border-subtle">
              {turnIntoOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center px-6 py-1.5 text-left type-body text-text hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard"
                  onClick={opt.command}
                >
                  {opt.label}
                </button>
              ))}
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="my-1 h-px bg-border-subtle" />

      <button type="button" role="menuitem" className={itemClass} onClick={handleDuplicate}>
        <IconCopy />
        <span>{labels.duplicate}</span>
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={handleMoveUp}>
        <IconArrowUp />
        <span>{labels.moveUp}</span>
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={handleMoveDown}>
        <IconArrowDown />
        <span>{labels.moveDown}</span>
      </button>

      <div className="my-1 h-px bg-border-subtle" />

      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left type-body text-danger hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard"
        onClick={handleDelete}
      >
        <IconTrash />
        <span>{labels.delete}</span>
      </button>
    </m.div>
  );
}

// ---------------------------------------------------------------------------
// Synthetic drag — works with Playwright's CDP mouse events where HTML5 DnD
// does not fire dragstart/drop in headless Chromium, and with real mice.
// While the pointer moves, the block under it gets a drop line above or below
// its midpoint; mouseup moves the dragged block there.
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD_PX = 5;

/** Where the block under the pointer would take the dragged block. */
export function dropLineAt(editor: Editor, clientX: number, clientY: number): DropLine | null {
  const view = editor.view;
  const editorRect = view.dom.getBoundingClientRect();
  if (editorRect.width === 0 && editorRect.height === 0) return null;
  // Clamp into the editor so dragging through the gutter or margins still
  // targets the nearest block.
  const coords = {
    left: Math.min(Math.max(clientX, editorRect.left + 1), editorRect.right - 1),
    top: Math.min(Math.max(clientY, editorRect.top + 1), editorRect.bottom - 1),
  };
  const found = view.posAtCoords(coords);
  if (!found) return null;
  const { doc } = view.state;
  const $pos = doc.resolve(found.pos);
  let index = $pos.index(0);
  if (index >= doc.childCount) index = doc.childCount - 1;
  if (index < 0) return null;
  const blockStart = $pos.posAtIndex(index, 0);
  const block = doc.child(index);
  const dom = view.nodeDOM(blockStart) as HTMLElement | null;
  if (!dom || typeof dom.getBoundingClientRect !== 'function') return null;
  const rect = dom.getBoundingClientRect();
  const below = clientY > rect.top + rect.height / 2;
  return {
    x: editorRect.left,
    width: editorRect.width,
    y: below ? rect.bottom : rect.top,
    insertPos: below ? blockStart + block.nodeSize : blockStart,
  };
}

/** Move the top-level block at `from` so it starts at `insertPos`. */
export function moveBlock(editor: Editor, from: number, insertPos: number): boolean {
  const { state } = editor.view;
  const node = state.doc.nodeAt(from);
  if (!node) return false;
  const to = from + node.nodeSize;
  if (insertPos >= from && insertPos <= to) return false; // same place
  const { tr } = state;
  const slice = state.doc.slice(from, to);
  tr.delete(from, to);
  const mapped = tr.mapping.map(insertPos);
  tr.insert(mapped, slice.content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(mapped + 1)));
  editor.view.dispatch(tr);
  return true;
}

interface SyntheticDragOptions {
  onDragChange: (dragging: boolean) => void;
  onDropLine: (line: DropLine | null) => void;
}

function useSyntheticDrag(
  editor: Editor,
  targetRef: React.RefObject<BlockTarget | null>,
  { onDragChange, onDropLine }: SyntheticDragOptions,
) {
  const draggingRef = useRef(false);

  const onGripMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = targetRef.current;
      if (!target) return;

      // Prevent native DnD from starting — otherwise the browser captures
      // the gesture and suppresses regular mousemove/mouseup.
      e.preventDefault();
      const blockDrag = (de: Event) => { de.preventDefault(); };
      document.addEventListener('dragstart', blockDrag, { capture: true });

      const startX = e.clientX;
      const startY = e.clientY;
      const startPos = target.pos;
      let committed = false;
      let line: DropLine | null = null;
      const markDragging = (pos: number | null) => {
        editor.view.dispatch(editor.state.tr.setMeta(draggingBlockKey, { pos }));
      };

      const begin = () => {
        committed = true;
        draggingRef.current = true;
        // Keep the handle on the dragged block instead of following the pointer.
        editor.commands.setMeta('lockDragHandle', true);
        markDragging(startPos);
        document.body.classList.add('cursor-grabbing');
        onDragChange(true);
      };

      const onMove = (ev: MouseEvent) => {
        if (!committed) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) return;
          begin();
        }
        line = dropLineAt(editor, ev.clientX, ev.clientY);
        onDropLine(line);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('dragstart', blockDrag, { capture: true } as EventListenerOptions);
        if (!committed) return; // a click, not a drag
        markDragging(null);
        document.body.classList.remove('cursor-grabbing');
        onDropLine(null);
        onDragChange(false);
        editor.commands.setMeta('lockDragHandle', false);
        if (line) moveBlock(editor, startPos, line.insertPos);
        // Let the grip's click handler see the drag before it is cleared.
        requestAnimationFrame(() => {
          draggingRef.current = false;
        });
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [editor, targetRef, onDragChange, onDropLine],
  );

  return { onGripMouseDown, isDragging: draggingRef };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BlockHandleComponent({ editor, labels, items, pickerLabels }: BlockHandleProps) {
  // The block the handle points to. Kept when the plugin reports "none"
  // (pointer left, key pressed) so an open menu keeps its target.
  const [target, setTarget] = useState<BlockTarget | null>(null);
  const targetRef = useRef<BlockTarget | null>(null);
  // Whether the plugin currently shows the handle.
  const [hovering, setHovering] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropLine, setDropLine] = useState<DropLine | null>(null);
  const pairRef = useRef<HTMLDivElement>(null);
  const fadeMotion = useMotionPreset('backdrop');

  const menuOpen = menuAnchor !== null && target !== null;
  const pickerOpen = pickerAnchor !== null && target !== null;
  const shown = hovering || menuOpen || pickerOpen || dragging;

  const handleNodeChange = useCallback(
    (data: { node: PmNode | null; editor: Editor; pos: number }) => {
      if (data.node && data.pos >= 0) {
        const next = { node: data.node, pos: data.pos };
        targetRef.current = next;
        setTarget(next);
        setHovering(true);
      } else {
        setHovering(false);
      }
    },
    [],
  );

  // The plugin hides its wrapper with `visibility: hidden` the moment the
  // pointer leaves. Clear that before paint so the pair can fade out; the
  // plugin also sets `pointer-events: none`, so the fading pair is inert.
  useLayoutEffect(() => {
    const wrapper = pairRef.current?.parentElement;
    if (wrapper && !shown && wrapper.style.visibility === 'hidden') {
      wrapper.style.visibility = '';
    }
  }, [shown]);

  // Keep the handle in place while a popup is open so it doesn't vanish
  // when the pointer leaves the block. The React <DragHandle> registers only
  // the plugin, not the extension's lock commands, so set the meta directly.
  useEffect(() => {
    editor.commands.setMeta('lockDragHandle', menuOpen || pickerOpen);
  }, [menuOpen, pickerOpen, editor]);

  // Ctrl/Cmd+/ from BlockKeyboardShortcuts: the menu for the block at the cursor.
  useEffect(() => {
    const dom = editor.view.dom;
    const handleToggle = () => {
      if (menuAnchor) {
        setMenuAnchor(null);
        return;
      }
      const { $from } = editor.state.selection;
      if ($from.depth < 1) return;
      const pos = $from.before(1);
      const node = editor.state.doc.nodeAt(pos);
      if (!node) return;
      const next = { node, pos };
      targetRef.current = next;
      setTarget(next);
      const rect = (editor.view.nodeDOM(pos) as HTMLElement | null)?.getBoundingClientRect();
      setMenuAnchor(
        rect
          ? clampToViewport(rect.left, rect.top + Math.min(rect.height, 28), MENU_WIDTH, MENU_HEIGHT)
          : { x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN },
      );
    };
    dom.addEventListener('nestself:toggle-block-menu', handleToggle);
    return () => dom.removeEventListener('nestself:toggle-block-menu', handleToggle);
  }, [editor, menuAnchor]);

  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  const closePicker = useCallback(() => {
    setPickerAnchor(null);
    editor.commands.focus();
  }, [editor]);

  const openPicker = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuAnchor(null);
    setPickerAnchor((open) =>
      open ? null : clampToViewport(rect.left, rect.bottom + 4, PICKER_WIDTH, PICKER_HEIGHT),
    );
  }, []);

  const handlePick = useCallback(
    (item: SlashMenuItem) => {
      const current = targetRef.current;
      setPickerAnchor(null);
      if (current) applyBlockPick(editor, current.pos, item);
    },
    [editor],
  );

  const { onGripMouseDown, isDragging } = useSyntheticDrag(editor, targetRef, {
    onDragChange: setDragging,
    onDropLine: setDropLine,
  });

  const buttonClass =
    'flex h-6 w-6 items-center justify-center rounded-control text-text-secondary hover:bg-tint hover:text-text transition-colors duration-[var(--motion-fast)] ease-standard focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus';

  const popups = (
    <MotionFeatures>
      <AnimatePresence>
        {menuOpen && target ? (
          <BlockMenu key="block-menu" editor={editor} target={target} labels={labels} fixedAt={menuAnchor} onClose={closeMenu} />
        ) : null}
        {pickerOpen && target ? (
          <BlockPicker
            key="block-picker"
            items={items}
            labels={pickerLabels}
            position={pickerAnchor}
            onSelect={handlePick}
            onClose={closePicker}
          />
        ) : null}
        {dropLine ? (
          <m.div
            key="drop-line"
            {...fadeMotion}
            aria-hidden="true"
            data-drop-line=""
            className="pointer-events-none fixed z-[var(--z-dropdown)] h-0.5 rounded-full bg-primary"
            style={{ left: dropLine.x, top: dropLine.y - 1, width: dropLine.width }}
          />
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );

  return (
    <DragHandle editor={editor} onNodeChange={handleNodeChange}>
      <div
        ref={pairRef}
        data-block-handle=""
        data-visible={shown ? 'true' : 'false'}
        className="flex items-center gap-0.5 pr-1.5 opacity-0 transition-opacity duration-[var(--motion-fast)] ease-standard pointer-events-none data-[visible=true]:opacity-100 data-[visible=true]:pointer-events-auto"
      >
        <button type="button" aria-label={labels.addBlock} onClick={openPicker} className={buttonClass}>
          <IconPlus />
        </button>

        {/* Grip: mousedown starts a drag; a click without travel opens the menu. */}
        <button
          type="button"
          aria-label={labels.dragBlock}
          onMouseDown={onGripMouseDown}
          onClick={(e) => {
            if (isDragging.current) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setPickerAnchor(null);
            setMenuAnchor((open) =>
              open ? null : clampToViewport(rect.left, rect.bottom + 4, MENU_WIDTH, MENU_HEIGHT),
            );
          }}
          className={`${buttonClass} cursor-grab`}
        >
          <IconDragGrip />
        </button>
      </div>
      {typeof document === 'undefined' ? null : createPortal(popups, document.body)}
    </DragHandle>
  );
}
