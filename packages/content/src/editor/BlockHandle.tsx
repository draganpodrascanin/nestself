/**
 * Block handle — drag grip and "+" button that appears on hover.
 *
 * Uses `@tiptap/extension-drag-handle-react` for positioning.
 * The grip opens a block menu (turn into, duplicate, delete, move up/down).
 * The "+" inserts a new paragraph below and opens the slash menu.
 *
 * Keyboard alternative: Alt+Shift+Up/Down for move, Ctrl/Cmd+/ for menu.
 * Animated per the Motion rule.
 * Colour: semantic tokens only.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  m,
  AnimatePresence,
  MotionFeatures,
  useMotionPreset,
} from '@nestself/ui';

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
// Block menu (opens from the drag grip)
// ---------------------------------------------------------------------------

interface BlockMenuProps {
  open: boolean;
  onClose: () => void;
  editor: Editor;
  pos: number;
  node: PmNode | null;
  labels: BlockHandleLabels;
}

function BlockMenu({ open, onClose, editor, pos, node, labels }: BlockMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const popoverMotion = useMotionPreset('popover');

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  const handleTurnInto = useCallback(
    (nodeType: string, attrs?: Record<string, unknown>) => {
      if (!node) return;
      try {
        editor.chain().focus().setNodeSelection(pos).setNode(nodeType, attrs).run();
      } catch {
        // Some conversions require wrapping instead
        try {
          editor.chain().focus().setNodeSelection(pos).wrapIn(nodeType, attrs).run();
        } catch {
          // Silently fail for incompatible conversions
        }
      }
      onClose();
    },
    [editor, pos, node, onClose],
  );

  const handleDuplicate = useCallback(() => {
    if (!node) return;
    const nodeJSON = node.toJSON();
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, nodeJSON)
      .run();
    onClose();
  }, [editor, pos, node, onClose]);

  const handleDelete = useCallback(() => {
    if (!node) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run();
    onClose();
  }, [editor, pos, node, onClose]);

  const handleMoveUp = useCallback(() => {
    if (!node || pos <= 0) return;
    const $pos = editor.state.doc.resolve(pos);
    if ($pos.index($pos.depth) <= 0) return;
    const before = $pos.before($pos.depth);
    const prevNode = editor.state.doc.nodeAt(before);
    if (!prevNode) return;
    const { tr } = editor.state;
    const nodeSlice = editor.state.doc.slice(pos, pos + node.nodeSize);
    tr.delete(pos, pos + node.nodeSize);
    tr.insert(before, nodeSlice.content);
    editor.view.dispatch(tr);
    onClose();
  }, [editor, pos, node, onClose]);

  const handleMoveDown = useCallback(() => {
    if (!node) return;
    const end = pos + node.nodeSize;
    if (end >= editor.state.doc.content.size) return;
    const nextNode = editor.state.doc.nodeAt(end);
    if (!nextNode) return;
    const { tr } = editor.state;
    const nodeSlice = editor.state.doc.slice(pos, end);
    tr.delete(pos, end);
    tr.insert(pos + nextNode.nodeSize, nodeSlice.content);
    editor.view.dispatch(tr);
    onClose();
  }, [editor, pos, node, onClose]);

  const turnIntoOptions = [
    {
      label: labels.paragraph,
      command: () => handleTurnInto('paragraph'),
    },
    {
      label: labels.heading2,
      command: () => handleTurnInto('sectionHeading', { level: 2 }),
    },
    {
      label: labels.heading3,
      command: () => handleTurnInto('sectionHeading', { level: 3 }),
    },
    {
      label: labels.quote,
      command: () => handleTurnInto('quote'),
    },
  ];

  const [showTurnInto, setShowTurnInto] = useState(false);

  return (
    <MotionFeatures>
      <AnimatePresence>
        {open ? (
          <m.div
            ref={menuRef}
            {...popoverMotion}
            className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 w-48 rounded-control border border-border-subtle bg-surface py-1 shadow-menu"
            role="menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
              }
            }}
          >
            {/* Turn into submenu */}
            <div className="relative">
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left type-body text-text hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard"
                onClick={() => setShowTurnInto((v) => !v)}
              >
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
                  <m.div
                    {...popoverMotion}
                    className="border-t border-border-subtle"
                  >
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

            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left type-body text-text hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard"
              onClick={handleDuplicate}
            >
              <IconCopy />
              <span>{labels.duplicate}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left type-body text-text hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard"
              onClick={handleMoveUp}
            >
              <IconArrowUp />
              <span>{labels.moveUp}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left type-body text-text hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard"
              onClick={handleMoveDown}
            >
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
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BlockHandleComponent({ editor, labels }: BlockHandleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentNode, setCurrentNode] = useState<PmNode | null>(null);
  const [currentPos, setCurrentPos] = useState(0);

  const handleNodeChange = useCallback(
    (data: { node: PmNode | null; editor: Editor; pos: number }) => {
      setCurrentNode(data.node);
      setCurrentPos(data.pos);
      setMenuOpen(false);
    },
    [],
  );

  const handleAddBlock = useCallback(() => {
    if (!currentNode) return;
    const end = currentPos + currentNode.nodeSize;
    // Insert a new paragraph below and focus it
    editor
      .chain()
      .focus()
      .insertContentAt(end, { type: 'paragraph' })
      .setTextSelection(end + 1)
      .run();
    // Type '/' to trigger the slash menu
    requestAnimationFrame(() => {
      editor.commands.insertContent('/');
    });
  }, [editor, currentNode, currentPos]);

  return (
    <DragHandle
      editor={editor}
      onNodeChange={handleNodeChange}
    >
      <div className="relative flex items-center gap-0.5 opacity-0 transition-opacity duration-[var(--motion-fast)] ease-standard group-hover/drag-handle:opacity-100 hover:opacity-100 focus-within:opacity-100"
        style={{ opacity: menuOpen ? 1 : undefined }}
      >
        {/* Add block button */}
        <button
          type="button"
          aria-label={labels.addBlock}
          onClick={handleAddBlock}
          className="flex h-6 w-6 items-center justify-center rounded-control text-text-secondary hover:bg-tint hover:text-text transition-colors duration-[var(--motion-fast)] ease-standard focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <IconPlus />
        </button>

        {/* Drag grip / menu trigger */}
        <button
          type="button"
          aria-label={labels.dragBlock}
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded-control text-text-secondary hover:bg-tint hover:text-text transition-colors duration-[var(--motion-fast)] ease-standard focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <IconDragGrip />
        </button>

        {/* Block menu */}
        <BlockMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          editor={editor}
          pos={currentPos}
          node={currentNode}
          labels={labels}
        />
      </div>
    </DragHandle>
  );
}
