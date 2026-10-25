/**
 * Editor-specific Tiptap extensions (FMT-R-10).
 *
 * These extend the schema-only definitions in `../schema/extensions.ts`
 * with parseHTML, renderHTML and interactive behavior for the browser
 * editor. The schema extensions remain validation-only (React-free).
 *
 * The italic mark is accepted in stored documents for schema
 * compatibility but is NOT offered in the toolbar (design handoff rule).
 */
import { type Extensions, Mark, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

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
      attribution: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'blockquote' }];
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
      mediaAssetId: { default: null },
      alt: { default: '' },
      caption: { default: null },
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
      { 'data-type': 'image', 'data-asset-id': assetId ?? '' },
      ['div', { class: 'image-placeholder' }, alt || assetId || 'Image'],
    ];
  },
});

const ProfessionalNote = Node.create({
  name: 'professionalNote',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      noteKind: { default: 'tip' },
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
});

const PracticalStep = Node.create({
  name: 'practicalStep',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return {
      stepNumber: { default: 1 },
      title: { default: '' },
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
});

const ChecklistItem = Node.create({
  name: 'checklistItem',
  content: 'inline*',

  addAttributes() {
    return {
      label: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'li[data-type="checklistItem"]' }];
  },

  renderHTML() {
    return ['li', { 'data-type': 'checklistItem' }, 0];
  },
});

const ApprovedMedia = Node.create({
  name: 'approvedMedia',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      mediaAssetId: { default: null },
      kind: { default: 'audio' },
      caption: { default: null },
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
      mediaAssetId: { default: null },
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
      contentResourceId: { default: null },
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
});

const Cta = Node.create({
  name: 'cta',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      ctaKind: { default: 'suggest_topic' },
      targetId: { default: null },
      label: { default: null },
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
      },
      `[CTA: ${(node.attrs.label as string | null) ?? (node.attrs.ctaKind as string)}]`,
    ];
  },
});

// ---------------------------------------------------------------------------
// Link mark (replaces StarterKit link)
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
// Export
// ---------------------------------------------------------------------------

export interface EditorExtensionsOptions {
  placeholder?: string;
}

/**
 * Returns the editor extension set for the content editor (FMT-R-10).
 *
 * Uses StarterKit for basic text editing (bold, italic, lists, hardBreak,
 * history) with heading/codeBlock/code/horizontalRule/blockquote disabled
 * (replaced by our custom nodes).
 */
export function createEditorExtensions(
  options: EditorExtensionsOptions = {},
): Extensions {
  return [
    Doc,
    StarterKit.configure({
      document: false,  // we provide our own Doc
      heading: false,   // replaced by SectionHeading
      codeBlock: false,
      code: false,
      horizontalRule: false,
      blockquote: false, // replaced by Quote
      strike: false,
      // Keep: bold, italic, hardBreak, paragraph, text, bulletList,
      // orderedList, listItem, history (undo/redo)
    }),
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
      placeholder: options.placeholder ?? '',
    }),
  ];
}
