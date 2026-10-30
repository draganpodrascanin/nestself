/**
 * Bubble menu — appears on text selection with Bold, Link and Turn-into.
 * No italic (design handoff rule).
 *
 * Uses `@tiptap/react/menus` BubbleMenu with explicit pluginKey.
 * Link insertion via a popover with allowlist validation (FMT-R-06).
 * Touch-friendly at 390 px.
 * Animated per the Motion rule (popover preset).
 * Colour: semantic tokens only.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import { isValidHref } from '../schema/blocks.ts';
import {
  m,
  AnimatePresence,
  MotionFeatures,
  useMotionPreset,
} from '@nestself/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BubbleMenuLabels {
  bold: string;
  link: string;
  linkUrl: string;
  linkInsert: string;
  linkRemove: string;
  linkInvalid: string;
  turnInto: string;
  paragraph: string;
  heading2: string;
  heading3: string;
  quote: string;
}

export interface EditorBubbleMenuProps {
  editor: Editor;
  labels: BubbleMenuLabels;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (Phosphor regular, 16px)
// ---------------------------------------------------------------------------

function IconBold() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M170.48,115.7A44,44,0,0,0,140,40H68a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8h80a48,48,0,0,0,22.48-90.3ZM76,56h64a28,28,0,0,1,0,56H76Zm72,136H76V128h72a32,32,0,0,1,0,64Z" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M137.54,186.36a8,8,0,0,1,0,11.31l-9.94,10a56,56,0,0,1-79.22-79.27l24.29-24.28a56,56,0,0,1,76.81-2.28,8,8,0,1,1-10.64,12,40,40,0,0,0-54.85,1.63L59.7,139.72a40,40,0,0,0,56.58,56.58l9.94-9.94A8,8,0,0,1,137.54,186.36Zm70.08-138a56.08,56.08,0,0,0-79.22,0l-9.94,9.95a8,8,0,0,0,11.32,11.31l9.94-9.94a40,40,0,0,1,56.58,56.58L171.94,140.4a40,40,0,0,1-54.85,1.63,8,8,0,1,0-10.64,12,56,56,0,0,0,76.81-2.28l24.29-24.28A56.08,56.08,0,0,0,207.62,48.38Z" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Bubble menu button
// ---------------------------------------------------------------------------

function BubbleButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center min-w-8 h-8 px-1.5 rounded-control',
        'transition-colors duration-[var(--motion-fast)] ease-standard',
        'hover:bg-tint focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        active ? 'bg-tint text-primary' : 'text-text',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Link popover (inside bubble menu)
// ---------------------------------------------------------------------------

function LinkPopover({
  open,
  onClose,
  onInsert,
  onRemove,
  isActive,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (url: string) => void;
  onRemove: () => void;
  isActive: boolean;
  labels: BubbleMenuLabels;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverMotion = useMotionPreset('popover');

  // Focus the input when mounting (key-based remount resets state)
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isValidHref(trimmed)) {
      setError(labels.linkInvalid);
      return;
    }
    onInsert(trimmed);
    onClose();
  };

  return (
    <MotionFeatures>
      <AnimatePresence>
        {open ? (
          <m.div
            {...popoverMotion}
            className="absolute top-full left-0 z-10 mt-1 w-64 rounded-control border border-border-subtle bg-surface p-3 shadow-menu"
            role="dialog"
            aria-label={labels.link}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
              }
            }}
          >
            {isActive ? (
              <button
                type="button"
                onClick={() => {
                  onRemove();
                  onClose();
                }}
                className="w-full inline-flex items-center justify-center min-h-8 px-3 rounded-control border border-border-control bg-surface text-danger hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard type-body"
              >
                {labels.linkRemove}
              </button>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <label
                  className="type-metadata text-text-secondary"
                  htmlFor="bubble-link-url"
                >
                  {labels.linkUrl}
                </label>
                <input
                  ref={inputRef}
                  id="bubble-link-url"
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  placeholder="https://"
                  className="px-2.5 py-1.5 rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus type-body"
                />
                {error ? (
                  <p className="type-metadata text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="inline-flex items-center justify-center min-h-8 px-3 rounded-control border border-transparent bg-primary text-on-primary hover:bg-primary-hover transition-colors duration-[var(--motion-fast)] ease-standard type-body font-[var(--font-weight-label)]"
                >
                  {labels.linkInsert}
                </button>
              </form>
            )}
          </m.div>
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}

// ---------------------------------------------------------------------------
// Turn-into dropdown
// ---------------------------------------------------------------------------

function TurnIntoDropdown({
  open,
  onClose,
  editor,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  editor: Editor;
  labels: BubbleMenuLabels;
}) {
  const popoverMotion = useMotionPreset('popover');

  const options = [
    {
      label: labels.paragraph,
      active: editor.isActive('paragraph'),
      command: () =>
        editor.chain().focus().setNode('paragraph').run(),
    },
    {
      label: labels.heading2,
      active: editor.isActive('sectionHeading', { level: 2 }),
      command: () =>
        editor
          .chain()
          .focus()
          .setNode('sectionHeading', { level: 2 })
          .run(),
    },
    {
      label: labels.heading3,
      active: editor.isActive('sectionHeading', { level: 3 }),
      command: () =>
        editor
          .chain()
          .focus()
          .setNode('sectionHeading', { level: 3 })
          .run(),
    },
    {
      label: labels.quote,
      active: editor.isActive('quote'),
      command: () => {
        if (editor.isActive('quote')) {
          editor.chain().focus().lift('quote').run();
        } else {
          editor.chain().focus().wrapIn('quote').run();
        }
      },
    },
  ];

  return (
    <MotionFeatures>
      <AnimatePresence>
        {open ? (
          <m.div
            {...popoverMotion}
            className="absolute top-full right-0 z-10 mt-1 w-40 rounded-control border border-border-subtle bg-surface py-1 shadow-menu"
            role="listbox"
            aria-label={labels.turnInto}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
              }
            }}
          >
            {options.map((opt) => (
              <button
                key={opt.label}
                type="button"
                role="option"
                aria-selected={opt.active}
                onClick={() => {
                  opt.command();
                  onClose();
                }}
                className={[
                  'flex w-full items-center px-3 py-1.5 text-left type-body',
                  'transition-colors duration-[var(--motion-fast)] ease-standard',
                  'hover:bg-tint focus-visible:outline-none',
                  opt.active ? 'text-primary font-[var(--font-weight-label)]' : 'text-text',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </m.div>
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const bubbleMenuPluginKey = new PluginKey('editorBubbleMenu');

export function EditorBubbleMenu({ editor, labels }: EditorBubbleMenuProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      const ed = ctx.editor;
      return {
        isBold: ed.isActive('bold'),
        isLink: ed.isActive('link'),
      };
    },
  });

  const handleInsertLink = useCallback(
    (url: string) => {
      editor.chain().focus().setMark('link', { href: url }).run();
    },
    [editor],
  );

  const handleRemoveLink = useCallback(() => {
    editor.chain().focus().unsetMark('link').run();
  }, [editor]);

  // Close popovers on click outside
  useEffect(() => {
    if (!linkOpen && !turnIntoOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setLinkOpen(false);
        setTurnIntoOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [linkOpen, turnIntoOpen]);

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={bubbleMenuPluginKey}
      className="relative flex items-center gap-0.5 rounded-control border border-border-subtle bg-surface px-1 py-0.5 shadow-menu"
    >
      <div ref={menuRef} className="flex items-center gap-0.5">
        {/* Bold */}
        <BubbleButton
          label={labels.bold}
          active={editorState?.isBold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <IconBold />
        </BubbleButton>

        {/* Link */}
        <BubbleButton
          label={editorState?.isLink ? labels.linkRemove : labels.link}
          active={editorState?.isLink}
          onClick={() => {
            setLinkOpen((o) => !o);
            setTurnIntoOpen(false);
          }}
        >
          <IconLink />
        </BubbleButton>

        {/* Separator */}
        <div className="w-px h-4 mx-0.5 bg-border-subtle" role="separator" />

        {/* Turn into */}
        <BubbleButton
          label={labels.turnInto}
          onClick={() => {
            setTurnIntoOpen((o) => !o);
            setLinkOpen(false);
          }}
        >
          <span className="type-metadata">{labels.turnInto}</span>
          <IconChevronDown />
        </BubbleButton>

        {/* Link popover (key forces remount to reset url/error state) */}
        <LinkPopover
          key={linkOpen ? 'link-open' : 'link-closed'}
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
          onInsert={handleInsertLink}
          onRemove={handleRemoveLink}
          isActive={editorState?.isLink ?? false}
          labels={labels}
        />

        {/* Turn-into dropdown */}
        <TurnIntoDropdown
          open={turnIntoOpen}
          onClose={() => setTurnIntoOpen(false)}
          editor={editor}
          labels={labels}
        />
      </div>
    </BubbleMenu>
  );
}
