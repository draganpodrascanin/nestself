/**
 * ContentEditor — Notion-style Tiptap 3 rich text editor (T-C1.12).
 *
 * A calm, wide writing canvas with no permanent heavy toolbar. Interaction
 * happens through:
 * - **Slash menu** (`/` command to insert blocks)
 * - **Bubble menu** (on text selection: bold, link, turn into)
 * - **Block handle** ("+" opens the block picker for the hovered block, the
 *   grip drags it or opens the block menu)
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

import { useCallback, useRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { ContentDocument } from '../schema/document.ts';
import { createEditorExtensions } from './editor-extensions.ts';
import { DEFAULT_NODE_VIEW_LABELS } from './node-view-labels.ts';
import type { NodeViewLabels, ImageUploadHandler, ResourceSearchHandler } from './node-view-labels.ts';
import { BlockDialogs } from './BlockDialogs.tsx';
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
  /** Translated labels for React node views (note kinds, step title, etc.). */
  nodeView?: NodeViewLabels;
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
  /** Callback when the image slash command is used (legacy; prefer imageUploadHandler). */
  onInsertImage?: () => void;
  /** Image upload handler. When provided, the ImageView node view handles
   *  file selection and upload internally (showing status inside the figure). */
  imageUploadHandler?: ImageUploadHandler;
  /** Resource search handler. When provided, the CTA and RelatedResource
   *  node views show a search combobox instead of a plain text input. */
  resourceSearchHandler?: ResourceSearchHandler;
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
    format: 'Format',
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
  imageUploadHandler,
  resourceSearchHandler,
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

  // Stable initial content — computed once so Tiptap's useEditor never
  // re-applies it via setOptions on subsequent React renders.
  const [stableContent] = useState(() =>
    initialDocument ? fromContentDocument(initialDocument) : undefined,
  );

  // Stable extensions — recreating them triggers refreshEditorInstance()
  // which destroys and re-creates the editor. Memoize them so the array
  // identity stays the same across renders.
  const extensions = useMemo(
    () => [
      ...createEditorExtensions({
        placeholder,
        blockPlaceholder,
        headingPlaceholder,
        suggestionConfig,
        nodeViewLabels: labels.nodeView,
        imageUploadHandler,
        resourceSearchHandler,
      }),
      PasteNormalization,
    ],
    // Slash menu config is the only runtime dependency; placeholder strings
    // and labels are stable for the lifetime of this locale/editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestionConfig],
  );

  // Stable editorProps — a new object each render makes Tiptap's
  // EditorInstanceManager.compareOptions() return false, triggering
  // setOptions → view.updateState() on every React render. When this
  // interleaves with fast keyboard sequences (ProseMirror processing
  // a keypress while updateState re-applies the view), content can
  // be corrupted (link text disappearing, cursor jumping).
  const editorProps = useMemo(
    () => ({
      attributes: {
        class: [
          'min-h-[320px] py-2 focus:outline-none',
          'text-text',
          // Placeholder hints on empty nodes (Tiptap Placeholder sets data-placeholder)
          '[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-text-secondary [&_.is-empty]:before:content-[attr(data-placeholder)]',
          '[&_h2]:type-section-title [&_h2]:text-text [&_h2]:mt-6 [&_h2]:mb-2',
          '[&_h3]:type-body-large [&_h3]:font-[var(--font-weight-label)] [&_h3]:text-text [&_h3]:mt-4 [&_h3]:mb-1',
          '[&_p]:type-body [&_p]:text-text [&_p]:my-1',
          '[&_ul]:pl-6 [&_ul]:list-disc [&_ol]:pl-6 [&_ol]:list-decimal',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary',
          '[&_a]:text-primary [&_a]:underline',
          // Block node views style themselves (node-views.tsx); the canvas only
          // spaces them and dims the one being dragged.
          '[&_figure[data-type="image"]]:my-4',
          '[&_ul[data-type="checklist"]]:list-none [&_ul[data-type="checklist"]]:pl-0',
          '[&_[data-dragging=true]]:opacity-40 [&_[data-dragging=true]]:transition-opacity [&_[data-dragging=true]]:duration-[var(--motion-fast)]',
        ].join(' '),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': labels.editorLabel,
      },
    }),
    [labels.editorLabel],
  );

  const editor = useEditor({
    extensions,
    content: stableContent,
    editable,
    onUpdate: handleUpdate,
    editorProps,
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
        // A borderless writing canvas: the page is the editor.
        'relative overflow-visible',
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
        <BlockHandleComponent
          editor={editor}
          labels={labels.blockHandle}
          items={slashMenuItems}
          pickerLabels={labels.slashMenu}
        />
      ) : null}

      {/* Call-to-action and related-resource dialogs */}
      {editor && editable ? (
        <BlockDialogs
          editor={editor}
          labels={labels.nodeView ?? DEFAULT_NODE_VIEW_LABELS}
          search={resourceSearchHandler}
        />
      ) : null}

      {/* Slash menu popup (portal) */}
      {slashMenuPopup}
    </div>
  );
}
