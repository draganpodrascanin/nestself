/**
 * ContentEditor — Tiptap 3 rich text editor for the content CMS (T-C1.12).
 *
 * Maps the block catalogue (6.2) to a browser-based editor. Uses the
 * editor extensions (with parseHTML/renderHTML) rather than the schema-only
 * extensions. Round-trips through ContentDocument via the converters.
 *
 * The italic mark is accepted in stored documents but is NOT offered in
 * the toolbar (design handoff rule).
 */
'use client';

import { useCallback, useRef, useEffect, useImperativeHandle } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { ContentDocument } from '../schema/document.ts';
import { createEditorExtensions } from './editor-extensions.ts';
import { PasteNormalization } from './paste-handler.ts';
import { toContentDocument, fromContentDocument } from './converters.ts';
import { Toolbar } from './Toolbar.tsx';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ContentEditorProps {
  /** Initial document to load. */
  initialDocument?: ContentDocument;
  /** Called on every change with the current document. */
  onChange?: (doc: ContentDocument) => void;
  /** Whether the editor is editable. Default true. */
  editable?: boolean;
  /** Placeholder text for the empty editor. */
  placeholder?: string;
  /** Additional class names for the editor container. */
  className?: string;
  /** Toolbar labels (i18n). */
  toolbarLabels?: {
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
  /** Callback when the image toolbar button is clicked. */
  onInsertImage?: () => void;
  /**
   * Imperative handle ref — exposes `insertImageNode(assetId, alt)` so the
   * parent can insert an image block after a successful upload.
   */
  editorRef?: React.Ref<ContentEditorHandle>;
}

export interface ContentEditorHandle {
  /** Insert an image node at the current cursor position. */
  insertImageNode: (mediaAssetId: string, alt?: string) => void;
}

const DEFAULT_TOOLBAR_LABELS = {
  bold: 'Bold',
  heading: 'Heading',
  bulletList: 'Bullet list',
  orderedList: 'Numbered list',
  quote: 'Quote',
  image: 'Image',
  link: 'Link',
  linkUrl: 'Link URL',
  linkInsert: 'Insert link',
  linkRemove: 'Remove link',
  undo: 'Undo',
  redo: 'Redo',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContentEditor({
  initialDocument,
  onChange,
  editable = true,
  placeholder,
  className,
  toolbarLabels = DEFAULT_TOOLBAR_LABELS,
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

  const editor = useEditor({
    extensions: [
      ...createEditorExtensions({ placeholder }),
      PasteNormalization,
    ],
    content: initialDocument ? fromContentDocument(initialDocument) : undefined,
    editable,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class: [
          'prose-content min-h-[200px] p-4 focus:outline-none',
          'text-text bg-surface',
        ].join(' '),
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Content editor',
      },
    },
  });

  // Expose imperative handle for inserting nodes from the parent
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
            attrs: { mediaAssetId, alt: alt ?? null, caption: null },
          })
          .run();
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
        'rounded-control border border-border-control overflow-hidden',
        'focus-within:ring-2 focus-within:ring-focus',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {editable && (
        <Toolbar
          editor={editor}
          labels={toolbarLabels}
          onInsertImage={onInsertImage}
        />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

