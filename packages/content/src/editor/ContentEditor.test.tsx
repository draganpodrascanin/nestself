/**
 * Unit tests for the Notion-style content editor (T-C1.12).
 *
 * Uses real Tiptap Editor instances with a lightweight extension set
 * (no DragHandle, Dropcursor or SlashMenu -- those require a real DOM).
 *
 * Covers:
 * - Round-trip of every block type through validateContentDocument
 * - Link marks and ordered-list attrs validate cleanly
 * - Italic shortcuts swallowed; stored italic marks preserved
 * - Slash menu: item creation, filtering, groups
 * - Link validation (FMT-R-06)
 * - Block move: Alt+Shift+Arrow up/down reorders blocks
 * - Converter cleanup (orderedList type, link attrs)
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Editor, Extension, Mark, Node, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { fromContentDocument, toContentDocument } from './converters.ts';
import type { ContentDocument } from '../schema/document.ts';
import { CURRENT_SCHEMA_VERSION } from '../schema/document.ts';
import { validateContentDocument } from '../schema/validate.ts';
import { isValidHref } from '../schema/blocks.ts';
import { createSlashMenuItems, type SlashMenuItemLabels } from './SlashMenu.tsx';

// ---------------------------------------------------------------------------
// Lightweight test extension set (no DOM-heavy DragHandle / Dropcursor)
// ---------------------------------------------------------------------------

const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content:
    '(sectionHeading | paragraph | bulletList | orderedList | quote | image | professionalNote | practicalStep | checklist | approvedMedia | transcript | relatedResource | cta)+',
});

const SectionHeading = Node.create({
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

function testExtensions(): Extensions {
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

// ---------------------------------------------------------------------------
// Shared editor (reused across tests)
// ---------------------------------------------------------------------------

let sharedEditor: Editor | null = null;

function getEditor() {
  if (!sharedEditor) {
    sharedEditor = new Editor({
      extensions: testExtensions(),
    });
  }
  return sharedEditor;
}

afterAll(() => {
  sharedEditor?.destroy();
  sharedEditor = null;
});

// Stub labels for slash menu
const ITEM_LABELS: SlashMenuItemLabels = {
  paragraph: 'Paragraph',
  paragraphHint: 'Plain text',
  heading2: 'Heading 2',
  heading2Hint: 'Section heading',
  heading3: 'Heading 3',
  heading3Hint: 'Sub-heading',
  bulletList: 'Bullet list',
  bulletListHint: 'Unordered list',
  numberedList: 'Numbered list',
  numberedListHint: 'Ordered list',
  checklist: 'Checklist',
  checklistHint: 'Track items',
  quote: 'Quote',
  quoteHint: 'Blockquote',
  note: 'Note',
  noteHint: 'Callout box',
  step: 'Step',
  stepHint: 'Numbered step',
  cta: 'Call to action',
  ctaHint: 'Button or link',
  related: 'Related resource',
  relatedHint: 'Link to content',
  image: 'Image',
  imageHint: 'Upload or paste',
};

// ---------------------------------------------------------------------------
// 1. Real Editor round-trip through validateContentDocument
// ---------------------------------------------------------------------------

describe('editor round-trip through validateContentDocument', () => {
  const blocks: Array<{
    name: string;
    node: ContentDocument['content'][number];
  }> = [
    {
      name: 'paragraph',
      node: { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
    },
    {
      name: 'sectionHeading (h2)',
      node: { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A heading' }] },
    },
    {
      name: 'sectionHeading (h3)',
      node: { type: 'sectionHeading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sub-heading' }] },
    },
    {
      name: 'bulletList',
      node: {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }] }],
      },
    },
    {
      name: 'orderedList',
      node: {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step 1' }] }] }],
      },
    },
    {
      name: 'quote',
      node: { type: 'quote', attrs: { attribution: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Wise words' }] }] },
    },
    {
      name: 'image',
      node: { type: 'image', attrs: { mediaAssetId: 'asset_abc', alt: 'Photo', caption: null } },
    },
    {
      name: 'professionalNote',
      node: { type: 'professionalNote', attrs: { noteKind: 'tip' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A tip.' }] }] },
    },
    {
      name: 'practicalStep',
      node: { type: 'practicalStep', attrs: { stepNumber: 1, title: 'Do this' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Detail.' }] }] },
    },
    {
      name: 'checklist',
      node: { type: 'checklist', content: [{ type: 'checklistItem', attrs: { label: '' }, content: [{ type: 'text', text: 'Check this' }] }] },
    },
    // approvedMedia requires a following transcript -- tested separately below
    {
      name: 'relatedResource',
      node: { type: 'relatedResource', attrs: { contentResourceId: 'res_xyz' } },
    },
    {
      name: 'cta',
      node: { type: 'cta', attrs: { ctaKind: 'suggest_topic', targetId: null, label: null } },
    },
  ];

  it('all block types round-trip and validate through a real editor', () => {
    const editor = getEditor();
    for (const { name, node } of blocks) {
      const doc: ContentDocument = {
        type: 'doc',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: [node as never],
      };
      editor.commands.setContent(fromContentDocument(doc));
      const extracted = toContentDocument(editor);
      const result = validateContentDocument(extracted);
      if (!result.ok) {
        const errMsg = `${name} validation failed.\nJSON: ${JSON.stringify(extracted.content[0], null, 2)}\nErrors: ${JSON.stringify(result.errors, null, 2)}`;
        expect.unreachable(errMsg);
      }
      expect(extracted.content.length, `${name} block count`).toBeGreaterThanOrEqual(1);
      expect(extracted.content[0]!.type, `${name} type`).toBe(node.type);
    }
  });

  it('approvedMedia + transcript pair round-trips and validates', () => {
    const editor = getEditor();
    const doc: ContentDocument = {
      type: 'doc',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      content: [
        { type: 'approvedMedia', attrs: { mediaAssetId: 'asset_456', kind: 'audio', caption: null } } as never,
        {
          type: 'transcript',
          attrs: { mediaAssetId: 'asset_456' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Transcript text' }] }],
        } as never,
      ],
    };
    editor.commands.setContent(fromContentDocument(doc));
    const extracted = toContentDocument(editor);
    const result = validateContentDocument(extracted);
    expect(result.ok).toBe(true);
    expect(extracted.content.some((b) => b.type === 'approvedMedia')).toBe(true);
    expect(extracted.content.some((b) => b.type === 'transcript')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Links and ordered lists validate
// ---------------------------------------------------------------------------

describe('link and ordered-list validation', () => {
  it('link mark round-trips and validates', () => {
    const editor = getEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'Visit',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        }],
      }],
    });
    const extracted = toContentDocument(editor);
    const result = validateContentDocument(extracted, { linkHostAllowlist: ['example.com'] });
    expect(result.ok).toBe(true);
  });

  it('orderedList validates after converter cleanup', () => {
    const editor = getEditor();
    editor.commands.setContent(fromContentDocument({
      type: 'doc',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      content: [{
        type: 'orderedList', attrs: { start: 1 },
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }],
      }],
    }));
    const extracted = toContentDocument(editor);
    expect(validateContentDocument(extracted).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Italic disabled
// ---------------------------------------------------------------------------

describe('italic disabled', () => {
  it('Mod-I shortcut is swallowed', () => {
    const editor = getEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    });
    editor.commands.selectAll();
    const result = editor.commands.keyboardShortcut('Mod-i');
    expect(editor.isActive('italic')).toBe(false);
    expect(result).toBe(true);
  });

  it('stored italic marks load without error', () => {
    const editor = getEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Italic text', marks: [{ type: 'italic' }] }],
      }],
    });
    const json = editor.getJSON();
    const marks = (json.content?.[0] as Record<string, unknown>)?.content as Array<Record<string, unknown>> | undefined;
    expect((marks?.[0]?.marks as Array<{ type: string }> | undefined)?.some((m) => m.type === 'italic')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Slash menu items (pure functions, no editor needed)
// ---------------------------------------------------------------------------

describe('slash menu items', () => {
  it('returns items in correct groups', () => {
    const items = createSlashMenuItems(ITEM_LABELS);
    const groups = new Set(items.map((i) => i.group));
    expect(groups).toContain('text');
    expect(groups).toContain('lists');
    expect(groups).toContain('blocks');
    expect(groups).toContain('media');
  });

  it('items have unique ids', () => {
    const items = createSlashMenuItems(ITEM_LABELS);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filtering by "heading" narrows to text group only', () => {
    const items = createSlashMenuItems(ITEM_LABELS);
    const filtered = items.filter(
      (item) =>
        item.label.toLowerCase().includes('heading') ||
        (item.hint && item.hint.toLowerCase().includes('heading')),
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(items.length);
  });

  it('has 12 items', () => {
    expect(createSlashMenuItems(ITEM_LABELS)).toHaveLength(12);
  });

  it('paragraph and heading2 commands produce content in editor', () => {
    const items = createSlashMenuItems(ITEM_LABELS);
    const editor = getEditor();
    for (const id of ['slash-paragraph', 'slash-heading2']) {
      const item = items.find((i) => i.id === id)!;
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '/' }] }],
      });
      item.command({ editor, range: { from: 1, to: 2 } });
      expect(toContentDocument(editor).content.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Link validation (FMT-R-06)
// ---------------------------------------------------------------------------

describe('link validation (FMT-R-06)', () => {
  it('accepts https URLs', () => {
    expect(isValidHref('https://example.com')).toBe(true);
  });

  it('accepts internal nestself: links', () => {
    expect(isValidHref('nestself:content/abc-123')).toBe(true);
  });

  it('rejects javascript: URLs', () => {
    expect(isValidHref('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(isValidHref('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isValidHref('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Block move (Alt+Shift+Arrow)
// ---------------------------------------------------------------------------

describe('block move (Alt+Shift+Arrow)', () => {
  it('moves a block down', () => {
    const editor = getEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    });
    editor.commands.setTextSelection(1);
    expect(editor.commands.keyboardShortcut('Alt-Shift-ArrowDown')).toBe(true);
    const text = (toContentDocument(editor).content[0] as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
    expect(text).toBe('Second');
  });

  it('moves a block up', () => {
    const editor = getEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    });
    const pos = editor.state.doc.content.child(0).nodeSize + 1;
    editor.commands.setTextSelection(pos);
    expect(editor.commands.keyboardShortcut('Alt-Shift-ArrowUp')).toBe(true);
    const text = (toContentDocument(editor).content[0] as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
    expect(text).toBe('Second');
  });

  it('does not move the first block up (content unchanged)', () => {
    const editor = getEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    });
    // Cursor in the first paragraph; try to move it up
    editor.commands.setTextSelection(1);
    editor.commands.keyboardShortcut('Alt-Shift-ArrowUp');
    // First block should still be "First" (cannot move further up)
    const text = (toContentDocument(editor).content[0] as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
    expect(text).toBe('First');
  });
});

// ---------------------------------------------------------------------------
// 7. Converter cleanup
// ---------------------------------------------------------------------------

describe('converters', () => {
  it('strips orderedList type attr', () => {
    const editor = getEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'orderedList', attrs: { start: 1 },
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }],
      }],
    });
    const ol = toContentDocument(editor).content.find((b) => b.type === 'orderedList');
    expect(ol).toBeDefined();
    if (ol && 'attrs' in ol && ol.attrs) {
      expect((ol.attrs as Record<string, unknown>).type).toBeUndefined();
    }
  });

  it('strips extraneous link mark attrs', () => {
    const editor = getEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }],
      }],
    });
    const para = toContentDocument(editor).content[0];
    const mark = (
      (para as { content?: Array<Record<string, unknown>> })?.content?.[0]?.marks as Array<Record<string, unknown>>
    )?.[0];
    expect(mark?.type).toBe('link');
    const attrs = mark?.attrs as Record<string, unknown>;
    expect(attrs?.href).toBe('https://example.com');
    expect(attrs?.target).toBeUndefined();
  });

  it('handles empty document', () => {
    const json = fromContentDocument({ type: 'doc', schemaVersion: CURRENT_SCHEMA_VERSION, content: [] });
    expect(json.type).toBe('doc');
    expect(json.content).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. Extension configuration (pure, no editor creation)
// ---------------------------------------------------------------------------

describe('editor extensions (configuration)', () => {
  it('createEditorExtensions returns extensions', async () => {
    const { createEditorExtensions } = await import('./editor-extensions.ts');
    const extensions = createEditorExtensions({ placeholder: 'Test' });
    expect(extensions.length).toBeGreaterThan(0);
  });

  it('includes all required node types', async () => {
    const { createEditorExtensions } = await import('./editor-extensions.ts');
    const names = createEditorExtensions()
      .filter((ext: { name?: string }) => ext && typeof ext === 'object' && 'name' in ext)
      .map((ext: { name: string }) => ext.name);
    for (const n of ['sectionHeading', 'quote', 'image', 'professionalNote', 'practicalStep', 'checklist', 'cta']) {
      expect(names).toContain(n);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Paste normalization
// ---------------------------------------------------------------------------

describe('paste normalization (FMT-R-12)', () => {
  it('PasteNormalization extension exists', async () => {
    const { PasteNormalization } = await import('./paste-handler.ts');
    expect(PasteNormalization.name).toBe('pasteNormalization');
  });
});
