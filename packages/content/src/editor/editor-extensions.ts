/**
 * Editor-specific Tiptap extensions (FMT-R-10, T-C1.12).
 *
 * These extend the schema-only definitions in `../schema/extensions.ts`
 * with parseHTML, renderHTML and interactive behavior for the browser
 * editor. The schema extensions remain validation-only (React-free).
 *
 * Extensions:
 * - StarterKit (bold, lists, hardBreak, history; italic kept for storage
 *   compat but shortcuts disabled)
 * - Custom block nodes (sectionHeading, quote, image, professionalNote,
 *   practicalStep, checklist, cta, relatedResource, etc.)
 * - Placeholder (per-node type placeholders)
 * - TrailingNode (always a paragraph at the end)
 * - Dropcursor (visual drag indicator)
 * - Slash menu (Suggestion-based / command)
 * - DragHandle (block-level drag & drop)
 * - DisableItalicInput (swallows Mod-I)
 */
import { type Extensions, Extension, Mark, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder, TrailingNode, Dropcursor } from '@tiptap/extensions';
import { DragHandle } from '@tiptap/extension-drag-handle';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { createSlashMenuExtension } from './SlashMenu.tsx';
import {
  ProfessionalNoteView,
  PracticalStepView,
  ChecklistView,
  ChecklistItemView,
  CtaView,
  RelatedResourceView,
  ImageView,
} from './node-views.tsx';

// ---------------------------------------------------------------------------
// Document (overrides StarterKit's doc)
// ---------------------------------------------------------------------------

const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content:
    '(sectionHeading | paragraph | bulletList | orderedList | quote | image | professionalNote | practicalStep | checklist | approvedMedia | transcript | relatedResource | cta)+',
});

// ---------------------------------------------------------------------------
// Custom block nodes
// ---------------------------------------------------------------------------

const SectionHeading = Node.create({
  name: 'sectionHeading',
  group: 'block',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      level: { default: 2 },
    };
  },

  parseHTML() {
    return [
      { tag: 'h2[data-type="sectionHeading"]', attrs: { level: 2 } },
      { tag: 'h3[data-type="sectionHeading"]', attrs: { level: 3 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
    ];
  },

  renderHTML({ node }) {
    const level = node.attrs.level as number;
    const tag = level === 3 ? 'h3' : 'h2';
    return [tag, { 'data-type': 'sectionHeading' }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-2': () =>
        this.editor.commands.toggleNode('sectionHeading', 'paragraph', { level: 2 }),
      'Mod-Alt-3': () =>
        this.editor.commands.toggleNode('sectionHeading', 'paragraph', { level: 3 }),
    };
  },
});

const Quote = Node.create({
  name: 'quote',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      attribution: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-attribution') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.attribution) return {};
          return { 'data-attribution': attributes.attribution as string };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'blockquote[data-type="quote"]' },
      { tag: 'blockquote' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['blockquote', { 'data-type': 'quote', ...HTMLAttributes }, 0];
  },
});

const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      mediaAssetId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-asset-id') || null,
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-asset-id': (attributes.mediaAssetId as string | null) ?? '',
        }),
      },
      alt: {
        default: '',
        parseHTML: (element: HTMLElement) => {
          const img = element.querySelector('img');
          if (img) return img.getAttribute('alt') ?? '';
          return element.getAttribute('data-alt') ?? '';
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-alt': (attributes.alt as string) ?? '',
        }),
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-caption') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.caption) return {};
          return { 'data-caption': attributes.caption as string };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="image"]' }];
  },

  renderHTML({ node }) {
    const assetId = node.attrs.mediaAssetId as string | null;
    const alt = node.attrs.alt as string;
    return [
      'figure',
      {
        'data-type': 'image',
        'data-asset-id': assetId ?? '',
        'data-alt': alt || '',
        ...(node.attrs.caption ? { 'data-caption': node.attrs.caption as string } : {}),
      },
      ['div', { class: 'image-placeholder' }, alt || assetId || 'Image'],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

const ProfessionalNote = Node.create({
  name: 'professionalNote',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      noteKind: {
        default: 'tip',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-note-kind') ?? 'tip',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-note-kind': attributes.noteKind as string,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-type="professionalNote"]' }];
  },

  renderHTML({ node }) {
    return [
      'aside',
      { 'data-type': 'professionalNote', 'data-note-kind': node.attrs.noteKind as string },
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProfessionalNoteView);
  },
});

const PracticalStep = Node.create({
  name: 'practicalStep',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      stepNumber: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const val = element.getAttribute('data-step-number');
          return val ? parseInt(val, 10) : 1;
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-step-number': String(attributes.stepNumber),
        }),
      },
      title: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-step-title') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-step-title': (attributes.title as string) ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="practicalStep"]' }];
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'practicalStep',
        'data-step-number': String(node.attrs.stepNumber),
        'data-step-title': node.attrs.title as string,
      },
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PracticalStepView);
  },
});

const Checklist = Node.create({
  name: 'checklist',
  group: 'block',
  content: 'checklistItem+',

  parseHTML() {
    return [{ tag: 'ul[data-type="checklist"]' }];
  },

  renderHTML() {
    return ['ul', { 'data-type': 'checklist' }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChecklistView);
  },
});

const ChecklistItem = Node.create({
  name: 'checklistItem',
  content: 'inline*',

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-label') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-label': (attributes.label as string) ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'li[data-type="checklistItem"]' }];
  },

  renderHTML({ node }) {
    return ['li', { 'data-type': 'checklistItem', 'data-label': node.attrs.label as string }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChecklistItemView);
  },
});

const ApprovedMedia = Node.create({
  name: 'approvedMedia',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      mediaAssetId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-asset-id') || null,
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-asset-id': (attributes.mediaAssetId as string | null) ?? '',
        }),
      },
      kind: {
        default: 'audio',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-kind') ?? 'audio',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-kind': attributes.kind as string,
        }),
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-caption') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.caption) return {};
          return { 'data-caption': attributes.caption as string };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="approvedMedia"]' }];
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'approvedMedia',
        'data-asset-id': (node.attrs.mediaAssetId as string | null) ?? '',
        'data-kind': node.attrs.kind as string,
        ...(node.attrs.caption ? { 'data-caption': node.attrs.caption as string } : {}),
      },
      `[Media: ${(node.attrs.kind as string)} — ${(node.attrs.mediaAssetId as string | null) ?? 'none'}]`,
    ];
  },
});

const Transcript = Node.create({
  name: 'transcript',
  group: 'block',
  content: 'paragraph+',

  addAttributes() {
    return {
      mediaAssetId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-asset-id') || null,
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-asset-id': (attributes.mediaAssetId as string | null) ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="transcript"]' }];
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'transcript',
        'data-asset-id': (node.attrs.mediaAssetId as string | null) ?? '',
      },
      0,
    ];
  },
});

const RelatedResource = Node.create({
  name: 'relatedResource',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      contentResourceId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-resource-id') || null,
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-resource-id': (attributes.contentResourceId as string | null) ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="relatedResource"]' }];
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'relatedResource',
        'data-resource-id': (node.attrs.contentResourceId as string | null) ?? '',
      },
      `[Related: ${(node.attrs.contentResourceId as string | null) ?? 'none'}]`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RelatedResourceView);
  },
});

const Cta = Node.create({
  name: 'cta',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      ctaKind: {
        default: 'suggest_topic',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-cta-kind') ?? 'suggest_topic',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-cta-kind': attributes.ctaKind as string,
        }),
      },
      targetId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-target-id') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.targetId) return {};
          return { 'data-target-id': attributes.targetId as string };
        },
      },
      label: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-label') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.label) return {};
          return { 'data-label': attributes.label as string };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="cta"]' }];
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'cta',
        'data-cta-kind': node.attrs.ctaKind as string,
        ...(node.attrs.targetId ? { 'data-target-id': node.attrs.targetId as string } : {}),
        ...(node.attrs.label ? { 'data-label': node.attrs.label as string } : {}),
      },
      `[CTA: ${(node.attrs.label as string | null) ?? (node.attrs.ctaKind as string)}]`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CtaView);
  },
});

// ---------------------------------------------------------------------------
// Link mark (our own; StarterKit's is disabled)
// ---------------------------------------------------------------------------

const Link = Mark.create({
  name: 'link',
  inclusive: false,

  addAttributes() {
    return {
      href: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'a[href]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', { href: HTMLAttributes.href as string, rel: 'noopener noreferrer nofollow' }, 0];
  },
});

// ---------------------------------------------------------------------------
// Disable italic shortcuts and input rules.
//
// The italic *mark* is kept in StarterKit (stored docs may contain it),
// but the toolbar doesn't offer it and users shouldn't be able to create
// it via Mod-I or the Markdown *text* input rule either.
// ---------------------------------------------------------------------------

const DisableItalicInput = Extension.create({
  name: 'disableItalicInput',
  priority: 200, // run after StarterKit

  addKeyboardShortcuts() {
    return {
      'Mod-i': () => true,  // swallow the shortcut
      'Mod-I': () => true,
    };
  },

  addInputRules() {
    return [];
  },
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts for block move operations (Alt+Shift+Arrow)
// ---------------------------------------------------------------------------

const BlockKeyboardShortcuts = Extension.create({
  name: 'blockKeyboardShortcuts',

  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': () => {
        const { state, dispatch } = this.editor.view;
        const { $from } = state.selection;
        if ($from.depth < 1) return false;
        const pos = $from.before(1);
        const node = state.doc.nodeAt(pos);
        if (!node || pos <= 0) return false;
        const $pos = state.doc.resolve(pos);
        if ($pos.index(0) <= 0) return false;
        const prevStart = $pos.posAtIndex($pos.index(0) - 1, 0);
        const { tr } = state;
        const slice = state.doc.slice(pos, pos + node.nodeSize);
        tr.delete(pos, pos + node.nodeSize);
        tr.insert(prevStart, slice.content);
        dispatch(tr);
        return true;
      },
      'Alt-Shift-ArrowDown': () => {
        const { state, dispatch } = this.editor.view;
        const { $from } = state.selection;
        if ($from.depth < 1) return false;
        const pos = $from.before(1);
        const node = state.doc.nodeAt(pos);
        if (!node) return false;
        const end = pos + node.nodeSize;
        if (end >= state.doc.content.size) return false;
        const nextNode = state.doc.nodeAt(end);
        if (!nextNode) return false;
        const { tr } = state;
        const slice = state.doc.slice(pos, end);
        tr.delete(pos, end);
        tr.insert(pos + nextNode.nodeSize, slice.content);
        dispatch(tr);
        return true;
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface EditorExtensionsOptions {
  placeholder?: string;
  blockPlaceholder?: string;
  headingPlaceholder?: string;
  suggestionConfig?: Partial<SuggestionOptions>;
}

/**
 * Returns the editor extension set for the Notion-style content editor.
 *
 * Uses StarterKit for basic text editing (bold, lists, hardBreak,
 * history) with heading/codeBlock/code/horizontalRule/blockquote/link/
 * underline/strike disabled (replaced by our custom nodes and marks).
 *
 * StarterKit's `link` and `underline` are disabled so the editor doesn't
 * emit extra attributes that fail validation. Our own `Link` mark only
 * has `href`.
 *
 * The orderedList `type` attribute is trimmed in the converter.
 */
export function createEditorExtensions(
  options: EditorExtensionsOptions = {},
): Extensions {
  const extensions: Extensions = [
    Doc,
    StarterKit.configure({
      document: false,     // we provide our own Doc
      heading: false,      // replaced by SectionHeading
      codeBlock: false,
      code: false,
      horizontalRule: false,
      blockquote: false,   // replaced by Quote
      strike: false,
      link: false,         // replaced by our own Link mark
      underline: false,    // not in the schema
    }),
    DisableItalicInput,
    BlockKeyboardShortcuts,
    Link,
    SectionHeading,
    Quote,
    Image,
    ProfessionalNote,
    PracticalStep,
    Checklist,
    ChecklistItem,
    ApprovedMedia,
    Transcript,
    RelatedResource,
    Cta,
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: true,
      placeholder: ({ node, editor }) => {
        if (node.type.name === 'sectionHeading') {
          return options.headingPlaceholder ?? 'Heading';
        }
        if (node.type.name === 'paragraph') {
          if (editor.isEmpty) {
            return options.placeholder ?? 'Start writing...';
          }
          return options.blockPlaceholder ?? "Type '/' for blocks";
        }
        return '';
      },
    }),
    TrailingNode.configure({
      node: 'paragraph',
    }),
    Dropcursor.configure({
      color: 'var(--color-primary)',
      width: 2,
    }),
    DragHandle.configure({
      render: () => {
        const el = document.createElement('div');
        el.className = 'drag-handle';
        return el;
      },
    }),
  ];

  // Slash menu (Suggestion-based)
  if (options.suggestionConfig) {
    extensions.push(createSlashMenuExtension(options.suggestionConfig));
  }

  return extensions;
}
