/**
 * Lightweight editor extension set for unit tests: the real schema's node
 * and mark names without the DOM-heavy DragHandle, Dropcursor and React
 * node views, so `new Editor()` runs in jsdom.
 */
import { Extension, InputRule, Mark, Node, type Extensions, textblockTypeInputRule, wrappingInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

// ---------------------------------------------------------------------------
// Lightweight test extension set (no DOM-heavy DragHandle / Dropcursor)
// ---------------------------------------------------------------------------

const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content:
    '(sectionHeading | paragraph | bulletList | orderedList | quote | image | professionalNote | practicalStep | checklist | approvedMedia | transcript | relatedResource | cta)+',
});

export const SectionHeading = Node.create({
  name: 'sectionHeading',
  group: 'block',
  content: 'text*',
  defining: true,
  addAttributes() {
    return { level: { default: 2 } };
  },
  parseHTML() {
    return [
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
    ];
  },
  renderHTML({ node }) {
    return [node.attrs.level === 3 ? 'h3' : 'h2', { 'data-type': 'sectionHeading' }, 0];
  },
  addInputRules() {
    return [
      textblockTypeInputRule({ find: /^##\s$/, type: this.type, getAttributes: () => ({ level: 2 }) }),
      textblockTypeInputRule({ find: /^###\s$/, type: this.type, getAttributes: () => ({ level: 3 }) }),
    ];
  },
});

export const Quote = Node.create({
  name: 'quote',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      attribution: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-attribution') || null,
        renderHTML: (a: Record<string, unknown>) =>
          a.attribution ? { 'data-attribution': a.attribution as string } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'blockquote' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['blockquote', { 'data-type': 'quote', ...HTMLAttributes }, 0];
  },
  addInputRules() {
    return [wrappingInputRule({ find: /^>\s$/, type: this.type })];
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
    return ['figure', { 'data-type': 'image', 'data-asset-id': node.attrs.mediaAssetId as string ?? '' }, 0];
  },
});

const ProfessionalNote = Node.create({
  name: 'professionalNote',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return { noteKind: { default: 'tip' } };
  },
  parseHTML() {
    return [{ tag: 'aside[data-type="professionalNote"]' }];
  },
  renderHTML({ node }) {
    return ['aside', { 'data-type': 'professionalNote', 'data-note-kind': node.attrs.noteKind as string }, 0];
  },
});

const PracticalStep = Node.create({
  name: 'practicalStep',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return { stepNumber: { default: 1 }, title: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="practicalStep"]' }];
  },
  renderHTML({ node }) {
    return [
      'div',
      { 'data-type': 'practicalStep', 'data-step-number': String(node.attrs.stepNumber), 'data-step-title': node.attrs.title as string },
      0,
    ];
  },
});

export const Checklist = Node.create({
  name: 'checklist',
  group: 'block',
  content: 'checklistItem+',
  parseHTML() {
    return [{ tag: 'ul[data-type="checklist"]' }];
  },
  renderHTML() {
    return ['ul', { 'data-type': 'checklist' }, 0];
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^\[\]\s$/,
        handler: ({ range, chain }) => {
          chain()
            .deleteRange(range)
            .insertContent({
              type: 'checklist',
              content: [{ type: 'checklistItem', attrs: { label: '' }, content: [{ type: 'text', text: ' ' }] }],
            })
            .run();
        },
      }),
    ];
  },
});

const ChecklistItem = Node.create({
  name: 'checklistItem',
  content: 'inline*',
  addAttributes() {
    return { label: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'li[data-type="checklistItem"]' }];
  },
  renderHTML({ node }) {
    return ['li', { 'data-type': 'checklistItem', 'data-label': node.attrs.label as string }, 0];
  },
});

const ApprovedMedia = Node.create({
  name: 'approvedMedia',
  group: 'block',
  atom: true,
  addAttributes() {
    return { mediaAssetId: { default: null }, kind: { default: 'audio' }, caption: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="approvedMedia"]' }];
  },
  renderHTML() {
    return ['div', { 'data-type': 'approvedMedia' }, 0];
  },
});

const Transcript = Node.create({
  name: 'transcript',
  group: 'block',
  content: 'paragraph+',
  addAttributes() {
    return { mediaAssetId: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="transcript"]' }];
  },
  renderHTML() {
    return ['div', { 'data-type': 'transcript' }, 0];
  },
});

const RelatedResource = Node.create({
  name: 'relatedResource',
  group: 'block',
  atom: true,
  addAttributes() {
    return { contentResourceId: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="relatedResource"]' }];
  },
  renderHTML() {
    return ['div', { 'data-type': 'relatedResource' }, 0];
  },
});

const Cta = Node.create({
  name: 'cta',
  group: 'block',
  atom: true,
  addAttributes() {
    return { ctaKind: { default: 'suggest_topic' }, targetId: { default: null }, label: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="cta"]' }];
  },
  renderHTML() {
    return ['div', { 'data-type': 'cta' }, 0];
  },
});

const Link = Mark.create({
  name: 'link',
  inclusive: false,
  addAttributes() {
    return { href: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'a[href]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', { href: HTMLAttributes.href as string }, 0];
  },
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        this.editor.view.dom.dispatchEvent(
          new CustomEvent('nestself:toggle-link', { bubbles: true }),
        );
        return true;
      },
    };
  },
});

const DisableItalicInput = Extension.create({
  name: 'disableItalicInput',
  priority: 200,
  addKeyboardShortcuts() {
    return {
      'Mod-i': () => true,
      'Mod-I': () => true,
    };
  },
});

const BlockKeyboardShortcuts = Extension.create({
  name: 'blockKeyboardShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-/': () => {
        this.editor.view.dom.dispatchEvent(
          new CustomEvent('nestself:toggle-block-menu', { bubbles: true }),
        );
        return true;
      },
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

export function testExtensions(): Extensions {
  return [
    Doc,
    StarterKit.configure({
      document: false,
      heading: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      blockquote: false,
      strike: false,
      link: false,
      underline: false,
      // As shipped: otherwise TrailingNode appends the doc's first content
      // alternative (a section heading) instead of a paragraph.
      trailingNode: { node: 'paragraph' },
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
  ];
}
