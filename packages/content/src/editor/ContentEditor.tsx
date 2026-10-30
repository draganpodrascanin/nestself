/**
 * ContentEditor — Notion-style Tiptap 3 rich text editor (T-C1.12).
 *
 * A calm, wide writing canvas with no permanent heavy toolbar. Interaction
 * happens through:
 * - **Slash menu** (`/` command to insert blocks)
 * - **Bubble menu** (on text selection: bold, link, turn into)
 * - **Block handle** (drag grip + add on hover; block menu)
 * - **Placeholders** (empty paragraph shows "Type '/' for blocks")
 * - **Markdown shortcuts** (## , ### , - , 1. , > , --- )
 *
 * The italic mark is accepted in stored documents but is NOT offered
 * anywhere (design handoff rule). Its shortcut and input rules are
 * disabled in the extensions.
 *
 * Colour: semantic tokens only (no hex literals).
 * Motion: menus and popovers animated per the Motion rule.
 */
'use client';

import { useCallback, useRef, useEffect, useImperativeHandle, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { ContentDocument } from '../schema/document.ts';
import { createEditorExtensions } from './editor-extensions.ts';
import { PasteNormalization } from './paste-handler.ts';
import { toContentDocument, fromContentDocument } from './converters.ts';
import { useSlashMenu, createSlashMenuItems } from './SlashMenu.tsx';
import type { SlashMenuLabels, SlashMenuItemLabels } from './SlashMenu.tsx';
import { EditorBubbleMenu } from './EditorBubbleMenu.tsx';
import type { BubbleMenuLabels } from './EditorBubbleMenu.tsx';
import { BlockHandleComponent } from './BlockHandle.tsx';
import type { BlockHandleLabels } from './BlockHandle.tsx';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ContentEditorLabels {
  slashMenu: SlashMenuLabels;
  slashItems: SlashMenuItemLabels;
  bubbleMenu: BubbleMenuLabels;
  blockHandle: BlockHandleLabels;
  /** Accessible label for the editor region. */
  editorLabel: string;
}

export interface ContentEditorProps {
  /** Initial document to load. */
  initialDocument?: ContentDocument;
  /** Called on every change with the current document. */
  onChange?: (doc: ContentDocument) => void;
  /** Whether the editor is editable. Default true. */
  editable?: boolean;
  /** Placeholder text for an empty document (shown as a friendly start hint). */
  placeholder?: string;
  /** Placeholder for empty paragraphs (e.g. "Type '/' for blocks"). */
  blockPlaceholder?: string;
  /** Placeholder for empty headings. */
  headingPlaceholder?: string;
  /** Additional class names for the editor container. */
  className?: string;
  /** All translated labels for menus and accessibility. */
  labels?: ContentEditorLabels;
  /** Callback when the image slash command is used. */
  onInsertImage?: () => void;
  /**
   * Imperative handle ref -- exposes methods for the parent to control
   * the editor (insert nodes, replace content for conflict resolution).
   */
  editorRef?: React.Ref<ContentEditorHandle>;
}

export interface ContentEditorHandle {
  /** Insert an image node at the current cursor position. */
  insertImageNode: (mediaAssetId: string, alt?: string) => void;
  /** Replace the entire editor content (for conflict resolution). */
  setContent: (doc: ContentDocument) => void;
  /** Read the current document from the editor. */
  getDocument: () => ContentDocument | null;
}

// ---------------------------------------------------------------------------
// Default labels (English fallback)
// ---------------------------------------------------------------------------

export const DEFAULT_EDITOR_LABELS: ContentEditorLabels = {
  editorLabel: 'Content editor',
  slashMenu: {
    placeholder: 'Filter blocks...',
    empty: 'No matching blocks',
    groupText: 'Text',
    groupLists: 'Lists',
    groupBlocks: 'Blocks',
    groupMedia: 'Media',
  },
  slashItems: {
    paragraph: 'Paragraph',
    paragraphHint: 'Plain text',
    heading2: 'Heading 2',
    heading2Hint: 'Section heading',
    heading3: 'Heading 3',
    heading3Hint: 'Subsection',
    bulletList: 'Bulleted list',
    bulletListHint: 'Unordered list',
    numberedList: 'Numbered list',
    numberedListHint: 'Ordered list',
    checklist: 'Checklist',
    checklistHint: 'Checkable items',
    quote: 'Quote',
    quoteHint: 'Blockquote',
    note: 'Professional note',
    noteHint: 'Tip, warning or info',
    step: 'Practical step',
    stepHint: 'Numbered instruction',
    cta: 'Call to action',
    ctaHint: 'Action button',
    related: 'Related resource',
    relatedHint: 'Link to another article',
    image: 'Image',
    imageHint: 'Upload or paste',
  },
  bubbleMenu: {
    bold: 'Bold',
    link: 'Link',
    linkUrl: 'Link URL',
    linkInsert: 'Insert link',
    linkRemove: 'Remove link',
    linkInvalid: 'Only https:// links and internal references are allowed.',
    turnInto: 'Turn into',
    paragraph: 'Paragraph',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    quote: 'Quote',
  },
  blockHandle: {
    addBlock: 'Add block',
    dragBlock: 'Drag or open menu',
    turnInto: 'Turn into',
    duplicate: 'Duplicate',
    delete: 'Delete',
    moveUp: 'Move up',
    moveDown: 'Move down',
    paragraph: 'Paragraph',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    quote: 'Quote',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContentEditor({
  initialDocument,
  onChange,
  editable = true,
  placeholder = 'Start writing, or type "/" for blocks...',
  blockPlaceholder = "Type '/' for blocks",
  headingPlaceholder = 'Heading',
  className,
  labels = DEFAULT_EDITOR_LABELS,
  onInsertImage,
  editorRef,
}: ContentEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const handleUpdate = useCallback(
    ({ editor: ed }: { editor: Editor }) => {
      if (onChangeRef.current) {
        onChangeRef.current(toContentDocument(ed));
      }
    },
    [],
  );

  // --- Slash menu ---
  const slashMenuItems = useMemo(
    () => createSlashMenuItems(labels.slashItems, onInsertImage),
    [labels.slashItems, onInsertImage],
  );

  const { suggestionConfig, popup: slashMenuPopup } = useSlashMenu({
    items: slashMenuItems,
    labels: labels.slashMenu,
  });

  const editor = useEditor({
    extensions: [
      ...createEditorExtensions({
        placeholder,
        blockPlaceholder,
        headingPlaceholder,
        suggestionConfig,
      }),
      PasteNormalization,
    ],
    content: initialDocument ? fromContentDocument(initialDocument) : undefined,
    editable,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class: [
          'min-h-[200px] py-4 px-2 focus:outline-none',
          'text-text bg-surface',
          '[&_h2]:type-section-title [&_h2]:text-text [&_h2]:mt-6 [&_h2]:mb-2',
          '[&_h3]:type-body-large [&_h3]:font-[var(--font-weight-label)] [&_h3]:text-text [&_h3]:mt-4 [&_h3]:mb-1',
          '[&_p]:type-body [&_p]:text-text [&_p]:my-1',
          '[&_ul]:pl-6 [&_ul]:list-disc [&_ol]:pl-6 [&_ol]:list-decimal',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary [&_blockquote]:italic',
          '[&_a]:text-primary [&_a]:underline',
          '[&_figure[data-type="image"]]:my-4 [&_figure[data-type="image"]]:rounded-control [&_figure[data-type="image"]]:border [&_figure[data-type="image"]]:border-border-subtle [&_figure[data-type="image"]]:bg-tint [&_figure[data-type="image"]]:p-4 [&_figure[data-type="image"]]:text-center [&_figure[data-type="image"]]:text-text-secondary',
          '[&_aside[data-type="professionalNote"]]:my-4 [&_aside[data-type="professionalNote"]]:rounded-control [&_aside[data-type="professionalNote"]]:border [&_aside[data-type="professionalNote"]]:border-border-subtle [&_aside[data-type="professionalNote"]]:bg-info-surface [&_aside[data-type="professionalNote"]]:p-4',
          '[&_aside[data-note-kind="warning"]]:bg-warning-surface',
          '[&_div[data-type="practicalStep"]]:my-4 [&_div[data-type="practicalStep"]]:rounded-control [&_div[data-type="practicalStep"]]:border [&_div[data-type="practicalStep"]]:border-border-subtle [&_div[data-type="practicalStep"]]:bg-tint [&_div[data-type="practicalStep"]]:p-4',
          '[&_ul[data-type="checklist"]]:list-none [&_ul[data-type="checklist"]]:pl-0',
          '[&_div[data-type="cta"]]:my-4 [&_div[data-type="cta"]]:rounded-control [&_div[data-type="cta"]]:border [&_div[data-type="cta"]]:border-primary [&_div[data-type="cta"]]:bg-accent-soft [&_div[data-type="cta"]]:p-4 [&_div[data-type="cta"]]:text-center [&_div[data-type="cta"]]:font-[var(--font-weight-label)]',
          '[&_div[data-type="relatedResource"]]:my-4 [&_div[data-type="relatedResource"]]:rounded-control [&_div[data-type="relatedResource"]]:border [&_div[data-type="relatedResource"]]:border-border-subtle [&_div[data-type="relatedResource"]]:bg-tint [&_div[data-type="relatedResource"]]:p-3',
        ].join(' '),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': labels.editorLabel,
      },
    },
  });

  // Expose imperative handle
  useImperativeHandle(
    editorRef,
    () => ({
      insertImageNode(mediaAssetId: string, alt?: string) {
        if (!editor) return;
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'image',
            attrs: { mediaAssetId, alt: alt ?? '', caption: null },
          })
          .run();
      },
      setContent(doc: ContentDocument) {
        if (!editor) return;
        editor.commands.setContent(fromContentDocument(doc));
      },
      getDocument() {
        if (!editor) return null;
        return toContentDocument(editor);
      },
    }),
    [editor],
  );

  // Sync editable prop
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  return (
    <div
      className={[
        'relative rounded-control border border-border-control overflow-visible',
        'focus-within:ring-2 focus-within:ring-focus',
        'bg-surface',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <EditorContent editor={editor} />

      {/* Bubble menu (text selection) */}
      {editor && editable ? (
        <EditorBubbleMenu editor={editor} labels={labels.bubbleMenu} />
      ) : null}

      {/* Block handle (drag + add on hover) */}
      {editor && editable ? (
        <BlockHandleComponent editor={editor} labels={labels.blockHandle} />
      ) : null}

      {/* Slash menu popup (portal) */}
      {slashMenuPopup}
    </div>
  );
}
