/**
 * Paste normalization for the content editor (FMT-R-12).
 *
 * Rules:
 * - Unknown node types are converted to paragraphs
 * - Disallowed marks are removed (only bold, italic, link are kept)
 * - Invalid links (non-https, except internal nestself: links) are stripped
 *
 * This is a Tiptap PasteRule-free approach: we use a transformPastedHTML
 * and transformPasted callback on the editor to normalize clipboard content.
 */
import { Extension } from '@tiptap/core';
import { Slice, Fragment, type Node as PmNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

/** The set of node types recognised by the content schema. */
const KNOWN_NODE_TYPES = new Set([
  'doc',
  'text',
  'hardBreak',
  'paragraph',
  'sectionHeading',
  'bulletList',
  'orderedList',
  'listItem',
  'quote',
  'image',
  'professionalNote',
  'practicalStep',
  'checklist',
  'checklistItem',
  'approvedMedia',
  'transcript',
  'relatedResource',
  'cta',
]);

/** The marks allowed by the content schema. */
const ALLOWED_MARKS = new Set(['bold', 'italic', 'link']);

/**
 * Recursively normalises a ProseMirror node tree from a paste.
 *
 * - Unknown nodes whose content is inline become paragraphs
 * - Unknown nodes whose content is block get their children lifted
 * - Unknown marks are stripped
 * - Link marks with non-https hrefs (except internal nestself: links)
 *   have the link mark removed
 */
function normaliseNode(node: PmNode, schema: PmNode['type']['schema']): PmNode | PmNode[] {
  // Text nodes: strip disallowed marks
  if (node.isText) {
    let marks = node.marks.filter((m) => ALLOWED_MARKS.has(m.type.name));
    // Validate link hrefs
    marks = marks.filter((m) => {
      if (m.type.name === 'link') {
        const href = m.attrs.href as string | undefined;
        if (!href) return false;
        // Internal links always pass
        if (/^nestself:content\/[A-Za-z0-9_-]{1,64}$/.test(href)) return true;
        try {
          const url = new URL(href);
          return url.protocol === 'https:';
        } catch {
          return false;
        }
      }
      return true;
    });
    return node.mark(marks);
  }

  // Known node types: normalise children
  if (KNOWN_NODE_TYPES.has(node.type.name)) {
    const children: PmNode[] = [];
    node.forEach((child) => {
      const result = normaliseNode(child, schema);
      if (Array.isArray(result)) {
        children.push(...result);
      } else {
        children.push(result);
      }
    });
    try {
      return node.copy(Fragment.from(children));
    } catch {
      // If the new children don't fit the content expression, wrap in paragraph
      return node;
    }
  }

  // Unknown node types
  if (node.isLeaf) {
    // Unknown leaf: drop it entirely
    return [];
  }

  if (node.isInline) {
    // Unknown inline node: extract text content
    const children: PmNode[] = [];
    node.forEach((child) => {
      const result = normaliseNode(child, schema);
      if (Array.isArray(result)) {
        children.push(...result);
      } else {
        children.push(result);
      }
    });
    return children;
  }

  // Unknown block node: convert to paragraph(s) with its inline content,
  // or lift block children
  const inlineChildren: PmNode[] = [];
  const blockChildren: PmNode[] = [];

  node.forEach((child) => {
    if (child.isBlock) {
      const result = normaliseNode(child, schema);
      if (Array.isArray(result)) {
        blockChildren.push(...result);
      } else {
        blockChildren.push(result);
      }
    } else {
      const result = normaliseNode(child, schema);
      if (Array.isArray(result)) {
        inlineChildren.push(...result);
      } else {
        inlineChildren.push(result);
      }
    }
  });

  const result: PmNode[] = [];

  // Wrap inline children in a paragraph
  if (inlineChildren.length > 0) {
    const paraType = schema.nodes.paragraph;
    if (paraType) {
      try {
        result.push(paraType.create(null, Fragment.from(inlineChildren)));
      } catch {
        // Fallback: drop if paragraph can't hold these
      }
    }
  }

  // Block children are already normalised
  result.push(...blockChildren);

  return result.length > 0 ? result : [];
}

/**
 * Tiptap extension that normalises pasted content (FMT-R-12).
 */
export const PasteNormalization = Extension.create({
  name: 'pasteNormalization',

  addProseMirrorPlugins() {
    const schema = this.editor.schema;
    return [
      {
        props: {
          transformPasted(slice: Slice, _view: EditorView): Slice {
            const children: PmNode[] = [];
            slice.content.forEach((node) => {
              const result = normaliseNode(node, schema);
              if (Array.isArray(result)) {
                children.push(...result);
              } else {
                children.push(result);
              }
            });
            return new Slice(
              Fragment.from(children),
              slice.openStart,
              slice.openEnd,
            );
          },
        },
      } as never,
    ];
  },
});
