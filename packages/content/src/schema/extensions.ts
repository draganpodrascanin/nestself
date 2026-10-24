/**
 * React-free Tiptap node and mark extensions mirroring the block catalogue.
 *
 * These extensions define the ProseMirror schema used for server-side
 * structural validation (FMT-R-07 layer 2). They intentionally omit
 * parseHTML, renderHTML and addNodeView — those belong in the editor
 * subpath which may import React.
 *
 * The schema subpath must NOT import React, @tiptap/react or @nestself/ui
 * (ESLint guard in eslint.config.js).
 */
import { type Extensions, Mark, Node } from '@tiptap/core';

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const Doc = Node.create({
  name: 'doc',
  topNode: true,
  // Note: the spec's content expression for doc listed hardBreak, but
  // ProseMirror forbids mixing inline and block content. hardBreak is
  // inline and lives inside paragraphs/text contexts, not at the doc level.
  content:
    '(sectionHeading | paragraph | bulletList | orderedList | quote | image | professionalNote | practicalStep | checklist | approvedMedia | transcript | relatedResource | cta)+',
});

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

const Text = Node.create({
  name: 'text',
  group: 'inline',
});

const HardBreak = Node.create({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
});

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

const Bold = Mark.create({
  name: 'bold',
});

const Italic = Mark.create({
  name: 'italic',
});

const Link = Mark.create({
  name: 'link',
  addAttributes() {
    return {
      href: { default: null },
    };
  },
});

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

const SectionHeading = Node.create({
  name: 'sectionHeading',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      level: { default: 2 },
    };
  },
});

const Paragraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
});

const BulletList = Node.create({
  name: 'bulletList',
  group: 'block',
  content: 'listItem+',
});

const OrderedList = Node.create({
  name: 'orderedList',
  group: 'block',
  content: 'listItem+',
  addAttributes() {
    return {
      start: { default: 1 },
    };
  },
});

const ListItem = Node.create({
  name: 'listItem',
  content: '(paragraph | bulletList | orderedList)+',
  defining: true,
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
});

const Checklist = Node.create({
  name: 'checklist',
  group: 'block',
  content: 'checklistItem+',
});

const ChecklistItem = Node.create({
  name: 'checklistItem',
  content: 'inline*',
  addAttributes() {
    return {
      label: { default: '' },
    };
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
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * All extensions for the content document schema.
 * Used by getSchema(extensions) for server-side ProseMirror validation
 * and by the editor (which adds React node views on top).
 */
export const extensions: Extensions = [
  Doc,
  Text,
  HardBreak,
  Bold,
  Italic,
  Link,
  SectionHeading,
  Paragraph,
  BulletList,
  OrderedList,
  ListItem,
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
];
