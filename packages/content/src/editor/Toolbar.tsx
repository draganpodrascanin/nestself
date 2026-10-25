/**
 * Content editor toolbar (FMT-R-11).
 *
 * Groups:
 * 1. Bold (italic is NOT offered per design handoff — italic mark is
 *    accepted in stored documents for schema compatibility only)
 * 2. Heading / Quote
 * 3. Bullet list / Ordered list
 * 4. Image / Link
 * 5. Undo / Redo
 *
 * Every button has an accessible label and keyboard operation.
 *
 * Uses inline SVG for icons because `@phosphor-icons/react` is not
 * a dependency of `@nestself/content` (listed as missing dependency).
 * The SVGs are sourced from the Phosphor icon set.
 */
import { useCallback } from 'react';
import type { Editor } from '@tiptap/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolbarProps {
  editor: Editor | null;
  labels: {
    bold: string;
    heading: string;
    bulletList: string;
    orderedList: string;
    quote: string;
    image: string;
    link: string;
    linkUrl: string;
    linkInsert: string;
    linkRemove: string;
    undo: string;
    redo: string;
  };
  onInsertImage?: () => void;
}

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

function IconHeading() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M208,56V200a8,8,0,0,1-16,0V136H64v64a8,8,0,0,1-16,0V56a8,8,0,0,1,16,0v64H192V56a8,8,0,0,1,16,0Z" />
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
}

function ToolbarButton({ label, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center w-8 h-8 rounded-control',
        'transition-colors duration-[var(--motion-fast)] ease-standard',
        'hover:bg-surface-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        active ? 'bg-primary-surface text-primary' : 'text-text-secondary',
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
  return <div className="w-px h-5 mx-1 bg-border" role="separator" />;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

export function Toolbar({ editor, labels, onInsertImage }: ToolbarProps) {
  const toggleLink = useCallback(() => {
    if (!editor) return;

    if (editor.isActive('link')) {
      editor.chain().focus().unsetMark('link').run();
      return;
    }

    const url = window.prompt(labels.linkUrl);
    if (url) {
      editor.chain().focus().setMark('link', { href: url }).run();
    }
  }, [editor, labels.linkUrl]);

  if (!editor) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 p-1.5 border-b border-border bg-surface-raised"
      role="toolbar"
      aria-label="Editor toolbar"
    >
      {/* Group 1: Text formatting */}
      <ToolbarButton
        label={labels.bold}
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <IconBold />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Group 2: Block types */}
      <ToolbarButton
        label={labels.heading}
        active={editor.isActive('sectionHeading')}
        onClick={() =>
          editor.chain().focus().toggleNode('sectionHeading', 'paragraph', { level: 2 }).run()
        }
      >
        <IconHeading />
      </ToolbarButton>

      <ToolbarButton
        label={labels.quote}
        active={editor.isActive('quote')}
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

      <ToolbarSeparator />

      {/* Group 3: Lists */}
      <ToolbarButton
        label={labels.bulletList}
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <IconBulletList />
      </ToolbarButton>

      <ToolbarButton
        label={labels.orderedList}
        active={editor.isActive('orderedList')}
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
        label={editor.isActive('link') ? labels.linkRemove : labels.link}
        active={editor.isActive('link')}
        onClick={toggleLink}
      >
        <IconLink />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Group 5: History */}
      <ToolbarButton
        label={labels.undo}
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <IconUndo />
      </ToolbarButton>

      <ToolbarButton
        label={labels.redo}
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <IconRedo />
      </ToolbarButton>
    </div>
  );
}
