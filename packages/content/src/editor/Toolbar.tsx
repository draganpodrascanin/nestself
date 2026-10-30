/**
 * Content editor toolbar (FMT-R-11).
 *
 * Groups:
 * 1. Bold
 * 2. H2 / H3 / Quote / Note / Step / Checklist / CTA / Related
 * 3. Bullet list / Ordered list
 * 4. Image / Link (via popover with allowlist validation)
 * 5. Undo / Redo
 *
 * Every button has an accessible label and keyboard operation.
 * Arrow keys provide roving tabindex within the toolbar.
 *
 * Uses semantic colour tokens only (no hex literals).
 * Link insertion uses a popover with Motion animation per the Motion rule.
 *
 * Italic is NOT offered (design handoff rule; the mark is kept for storage
 * compatibility but the shortcut and input rules are disabled in extensions).
 */
import { useCallback, useRef, useState, useEffect, type KeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
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

export interface ToolbarLabels {
  bold: string;
  heading: string;
  heading3: string;
  bulletList: string;
  orderedList: string;
  quote: string;
  note: string;
  step: string;
  checklist: string;
  cta: string;
  related: string;
  image: string;
  link: string;
  linkUrl: string;
  linkInsert: string;
  linkRemove: string;
  linkInvalid: string;
  undo: string;
  redo: string;
  toolbar: string;
}

export interface ToolbarProps {
  editor: Editor | null;
  labels: ToolbarLabels;
  onInsertImage?: () => void;
}

// ---------------------------------------------------------------------------
// Default labels (English fallback; callers should pass translated labels)
// ---------------------------------------------------------------------------

export const DEFAULT_TOOLBAR_LABELS: ToolbarLabels = {
  bold: 'Bold',
  heading: 'Heading 2',
  heading3: 'Heading 3',
  bulletList: 'Bullet list',
  orderedList: 'Numbered list',
  quote: 'Quote',
  note: 'Professional note',
  step: 'Practical step',
  checklist: 'Checklist',
  cta: 'Call to action',
  related: 'Related resource',
  image: 'Image',
  link: 'Link',
  linkUrl: 'Link URL',
  linkInsert: 'Insert link',
  linkRemove: 'Remove link',
  linkInvalid: 'Only https:// links and internal references are allowed.',
  undo: 'Undo',
  redo: 'Redo',
  toolbar: 'Editor toolbar',
};

// ---------------------------------------------------------------------------
// Inline SVG icons (Phosphor regular weight, 18px)
// ---------------------------------------------------------------------------

function IconBold() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M170.48,115.7A44,44,0,0,0,140,40H68a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8h80a48,48,0,0,0,22.48-90.3ZM76,56h64a28,28,0,0,1,0,56H76Zm72,136H76V128h72a32,32,0,0,1,0,64Z" />
    </svg>
  );
}

function IconH2() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M208,56V200a8,8,0,0,1-16,0V136H64v64a8,8,0,0,1-16,0V56a8,8,0,0,1,16,0v64H192V56a8,8,0,0,1,16,0Z" />
    </svg>
  );
}

function IconH3() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M152,56V200a8,8,0,0,1-16,0V136H56v64a8,8,0,0,1-16,0V56a8,8,0,0,1,16,0v64h80V56a8,8,0,0,1,16,0Zm71.77,68.32a36,36,0,0,0-52-10.47,8,8,0,0,0,9.34,13,20,20,0,1,1,13.13,35.2H184a8,8,0,0,0,0,16h10.23A20,20,0,1,1,181.11,213.5a8,8,0,1,0-9.34,13,36,36,0,0,0,52-10.47,35.27,35.27,0,0,0,0-36.4A36.64,36.64,0,0,0,223.77,124.32Z" />
    </svg>
  );
}

function IconQuote() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M100,56H40A16,16,0,0,0,24,72v64a16,16,0,0,0,16,16h60v4a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,100,56Zm0,80H40V72h60ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v4a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Zm0,80H156V72h60Z" />
    </svg>
  );
}

function IconBulletList() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M80,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H88A8,8,0,0,1,80,64Zm136,56H88a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,64H88a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM44,52A12,12,0,1,0,56,64,12,12,0,0,0,44,52Zm0,64a12,12,0,1,0,12,12A12,12,0,0,0,44,116Zm0,64a12,12,0,1,0,12,12A12,12,0,0,0,44,180Z" />
    </svg>
  );
}

function IconOrderedList() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M224,128a8,8,0,0,1-8,8H104a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM104,72H216a8,8,0,0,0,0-16H104a8,8,0,0,0,0,16ZM216,184H104a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM43.58,55.16,48,52.94V104a8,8,0,0,0,16,0V40a8,8,0,0,0-11.58-7.16l-16,8a8,8,0,0,0,7.16,14.32Z" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,200V172l52-52,80,80H40Zm176,0H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M137.54,186.36a8,8,0,0,1,0,11.31l-9.94,10a56,56,0,0,1-79.22-79.27l24.29-24.28a56,56,0,0,1,76.81-2.28,8,8,0,1,1-10.64,12,40,40,0,0,0-54.85,1.63L59.7,139.72a40,40,0,0,0,56.58,56.58l9.94-9.94A8,8,0,0,1,137.54,186.36Zm70.08-138a56.08,56.08,0,0,0-79.22,0l-9.94,9.95a8,8,0,0,0,11.32,11.31l9.94-9.94a40,40,0,0,1,56.58,56.58L171.94,140.4a40,40,0,0,1-54.85,1.63,8,8,0,1,0-10.64,12,56,56,0,0,0,76.81-2.28l24.29-24.28A56.08,56.08,0,0,0,207.62,48.38Z" />
    </svg>
  );
}

function IconNote() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z" />
    </svg>
  );
}

function IconStep() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,176H48V48H208V208Zm-32-80a8,8,0,0,1-8,8H136v32a8,8,0,0,1-16,0V136H88a8,8,0,0,1,0-16h32V88a8,8,0,0,1,16,0v32h32A8,8,0,0,1,176,128Z" />
    </svg>
  );
}

function IconChecklist() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M224,128a8,8,0,0,1-8,8H128a8,8,0,0,1,0-16h88A8,8,0,0,1,224,128ZM128,72h88a8,8,0,0,0,0-16H128a8,8,0,0,0,0,16Zm88,112H128a8,8,0,0,0,0,16h88a8,8,0,0,0,0-16ZM79.51,39.51,56,63l-7.51-7.52a8,8,0,0,0-11.32,11.32l13.17,13.17a8,8,0,0,0,11.32,0L85.66,56a8,8,0,0,0,0-11.32A8,8,0,0,0,79.51,39.51Zm0,64L56,127l-7.51-7.52a8,8,0,0,0-11.32,11.32l13.17,13.17a8,8,0,0,0,11.32,0l24-24a8,8,0,0,0-11.32-11.32Zm0,64L56,191l-7.51-7.52a8,8,0,0,0-11.32,11.32l13.17,13.17a8,8,0,0,0,11.32,0l24-24a8,8,0,0,0-11.32-11.32Z" />
    </svg>
  );
}

function IconCta() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z" />
    </svg>
  );
}

function IconRelated() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M240,88.23a54.43,54.43,0,0,1-16,37L189.25,160a54.27,54.27,0,0,1-38.63,16h-.05A54.63,54.63,0,0,1,96,120.07a8,8,0,0,1,16,.36,38.63,38.63,0,0,0,38.56,39.57,38.39,38.39,0,0,0,27.31-11.31l34.75-34.75a38.63,38.63,0,0,0-54.63-54.63l-11,11A8,8,0,0,1,135.7,59l11-11A54.65,54.65,0,0,1,240,88.23ZM109,185.66l-11,11A38.41,38.41,0,0,1,70.6,208a38.63,38.63,0,0,1-27.29-65.94L78.06,107.3A38.63,38.63,0,0,1,144,135.57a8,8,0,0,0,16,.36A54.86,54.86,0,0,0,105.38,80,54.65,54.65,0,0,0,66.74,96,54.59,54.59,0,0,0,48,96l-34.75,34.75A54.62,54.62,0,0,0,51.63,208h.05a54.28,54.28,0,0,0,38.63-16l11-11a8,8,0,0,0-11.31-11.32Z" />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,61.66L51.31,96H128A104.11,104.11,0,0,1,232,200Z" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M24,200a8,8,0,0,0,16,0,88.1,88.1,0,0,1,88-88H204.69l-34.35,34.34a8,8,0,0,0,11.32,11.32l48-48a8,8,0,0,0,0-11.32l-48-48a8,8,0,0,0-11.32,11.32L204.69,96H128A104.11,104.11,0,0,0,24,200Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tabIndex?: number;
}

function ToolbarButton({ label, active, disabled, onClick, children, tabIndex }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      tabIndex={tabIndex}
      className={[
        'inline-flex items-center justify-center w-8 h-8 rounded-control',
        'transition-colors duration-[var(--motion-fast)] ease-standard',
        'hover:bg-tint focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        active ? 'bg-tint text-primary' : 'text-text-secondary',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

function ToolbarSeparator() {
  return <div className="w-px h-5 mx-1 bg-border-subtle" role="separator" />;
}

// ---------------------------------------------------------------------------
// Link popover (Motion rule — dialog/popover must animate)
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
  labels: ToolbarLabels;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverMotion = useMotionPreset('popover');

  // Focus the input when opening (state reset handled by key remounting)
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <MotionFeatures>
      <AnimatePresence>
        {open ? (
          <m.div
            {...popoverMotion}
            className="absolute top-full left-0 z-10 mt-1 w-72 rounded-control border border-border-subtle bg-surface p-3 shadow-menu"
            role="dialog"
            aria-label={labels.link}
            onKeyDown={handleKeyDown}
          >
            {isActive ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => { onRemove(); onClose(); }}
                  className="inline-flex items-center justify-center min-h-9 px-3 rounded-control border border-border-control bg-surface text-primary hover:bg-tint transition-colors duration-[var(--motion-fast)] ease-standard type-body font-[var(--font-weight-label)]"
                >
                  {labels.linkRemove}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <label className="type-metadata text-text-secondary" htmlFor="toolbar-link-url">
                  {labels.linkUrl}
                </label>
                <input
                  ref={inputRef}
                  id="toolbar-link-url"
                  type="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(null); }}
                  placeholder="https://"
                  className="px-2.5 py-1.5 rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus type-body"
                />
                {error ? (
                  <p className="type-metadata text-danger" role="alert">{error}</p>
                ) : null}
                <button
                  type="submit"
                  className="inline-flex items-center justify-center min-h-9 px-3 rounded-control border border-transparent bg-primary text-on-primary hover:bg-primary-hover transition-colors duration-[var(--motion-fast)] ease-standard type-body font-[var(--font-weight-label)]"
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
// Toolbar
// ---------------------------------------------------------------------------

export function Toolbar({ editor, labels, onInsertImage }: ToolbarProps) {
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Fresh state from the editor (avoids stale pressed/disabled)
  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      const ed = ctx.editor;
      if (!ed) {
        return {
          isBold: false,
          isH2: false,
          isH3: false,
          isQuote: false,
          isNote: false,
          isStep: false,
          isChecklist: false,
          isCta: false,
          isRelated: false,
          isBulletList: false,
          isOrderedList: false,
          isLink: false,
          canUndo: false,
          canRedo: false,
        };
      }
      return {
        isBold: ed.isActive('bold'),
        isH2: ed.isActive('sectionHeading', { level: 2 }),
        isH3: ed.isActive('sectionHeading', { level: 3 }),
        isQuote: ed.isActive('quote'),
        isNote: ed.isActive('professionalNote'),
        isStep: ed.isActive('practicalStep'),
        isChecklist: ed.isActive('checklist'),
        isCta: ed.isActive('cta'),
        isRelated: ed.isActive('relatedResource'),
        isBulletList: ed.isActive('bulletList'),
        isOrderedList: ed.isActive('orderedList'),
        isLink: ed.isActive('link'),
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
      };
    },
  });

  // --- Roving tabindex ---
  const handleToolbarKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const buttons = Array.from(
      toolbar.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );
    if (buttons.length === 0) return;
    const current = document.activeElement as HTMLElement;
    const idx = buttons.indexOf(current as HTMLButtonElement);
    let next: number;
    if (e.key === 'ArrowRight') {
      next = idx < buttons.length - 1 ? idx + 1 : 0;
    } else {
      next = idx > 0 ? idx - 1 : buttons.length - 1;
    }
    buttons[next]?.focus();
    e.preventDefault();
  }, []);

  // --- Link actions ---
  const handleToggleLink = useCallback(() => {
    setLinkPopoverOpen((prev) => !prev);
  }, []);

  const handleInsertLink = useCallback((url: string) => {
    if (!editor) return;
    editor.chain().focus().setMark('link', { href: url }).run();
  }, [editor]);

  const handleRemoveLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetMark('link').run();
  }, [editor]);

  // Close link popover on click outside
  useEffect(() => {
    if (!linkPopoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setLinkPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [linkPopoverOpen]);

  if (!editor) return null;

  return (
    <div
      ref={toolbarRef}
      className="relative flex flex-wrap items-center gap-0.5 p-1.5 border-b border-border-subtle bg-raised"
      role="toolbar"
      aria-label={labels.toolbar}
      onKeyDown={handleToolbarKeyDown}
    >
      {/* Group 1: Text formatting */}
      <ToolbarButton
        label={labels.bold}
        active={editorState?.isBold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <IconBold />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Group 2: Block types */}
      <ToolbarButton
        label={labels.heading}
        active={editorState?.isH2}
        onClick={() =>
          editor.chain().focus().toggleNode('sectionHeading', 'paragraph', { level: 2 }).run()
        }
      >
        <IconH2 />
      </ToolbarButton>

      <ToolbarButton
        label={labels.heading3}
        active={editorState?.isH3}
        onClick={() =>
          editor.chain().focus().toggleNode('sectionHeading', 'paragraph', { level: 3 }).run()
        }
      >
        <IconH3 />
      </ToolbarButton>

      <ToolbarButton
        label={labels.quote}
        active={editorState?.isQuote}
        onClick={() => {
          if (editor.isActive('quote')) {
            editor.chain().focus().lift('quote').run();
          } else {
            editor.chain().focus().wrapIn('quote').run();
          }
        }}
      >
        <IconQuote />
      </ToolbarButton>

      <ToolbarButton
        label={labels.note}
        active={editorState?.isNote}
        onClick={() => {
          if (editor.isActive('professionalNote')) {
            editor.chain().focus().lift('professionalNote').run();
          } else {
            editor.chain().focus().wrapIn('professionalNote').run();
          }
        }}
      >
        <IconNote />
      </ToolbarButton>

      <ToolbarButton
        label={labels.step}
        active={editorState?.isStep}
        onClick={() => {
          if (editor.isActive('practicalStep')) {
            editor.chain().focus().lift('practicalStep').run();
          } else {
            editor.chain().focus().wrapIn('practicalStep').run();
          }
        }}
      >
        <IconStep />
      </ToolbarButton>

      <ToolbarButton
        label={labels.checklist}
        active={editorState?.isChecklist}
        onClick={() => {
          editor.chain().focus().insertContent({
            type: 'checklist',
            content: [{ type: 'checklistItem', attrs: { label: '' }, content: [{ type: 'text', text: ' ' }] }],
          }).run();
        }}
      >
        <IconChecklist />
      </ToolbarButton>

      <ToolbarButton
        label={labels.cta}
        active={editorState?.isCta}
        onClick={() => {
          editor.chain().focus().insertContent({
            type: 'cta',
            attrs: { ctaKind: 'suggest_topic', targetId: null, label: null },
          }).run();
        }}
      >
        <IconCta />
      </ToolbarButton>

      <ToolbarButton
        label={labels.related}
        active={editorState?.isRelated}
        onClick={() => {
          editor.chain().focus().insertContent({
            type: 'relatedResource',
            attrs: { contentResourceId: null },
          }).run();
        }}
      >
        <IconRelated />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Group 3: Lists */}
      <ToolbarButton
        label={labels.bulletList}
        active={editorState?.isBulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <IconBulletList />
      </ToolbarButton>

      <ToolbarButton
        label={labels.orderedList}
        active={editorState?.isOrderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <IconOrderedList />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Group 4: Inserts */}
      <ToolbarButton
        label={labels.image}
        onClick={() => onInsertImage?.()}
      >
        <IconImage />
      </ToolbarButton>

      <ToolbarButton
        label={editorState?.isLink ? labels.linkRemove : labels.link}
        active={editorState?.isLink}
        onClick={handleToggleLink}
      >
        <IconLink />
      </ToolbarButton>

      {/* Link popover (key forces remount to reset url/error state) */}
      <LinkPopover
        key={linkPopoverOpen ? 'link-open' : 'link-closed'}
        open={linkPopoverOpen}
        onClose={() => setLinkPopoverOpen(false)}
        onInsert={handleInsertLink}
        onRemove={handleRemoveLink}
        isActive={editorState?.isLink ?? false}
        labels={labels}
      />

      <ToolbarSeparator />

      {/* Group 5: History */}
      <ToolbarButton
        label={labels.undo}
        disabled={!editorState?.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <IconUndo />
      </ToolbarButton>

      <ToolbarButton
        label={labels.redo}
        disabled={!editorState?.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <IconRedo />
      </ToolbarButton>
    </div>
  );
}
