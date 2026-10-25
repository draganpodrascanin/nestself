/**
 * Body document filter (FMT-R-05, LIB-R-23, ACC-R-22).
 *
 * Walks a ContentDocument and:
 * 1. Collects every referenced content resource id from `cta` nodes,
 *    `relatedResource` nodes and `link` marks with `nestself:content/<id>`.
 * 2. Given an availability set, drops `cta` and `relatedResource` nodes
 *    whose target is unavailable.
 * 3. Unwraps unavailable internal links (`nestself:content/<id>`) to plain
 *    text, keeping the text node content.
 * 4. Drops `open_service` CTAs unless the reader's capabilities include the
 *    CTA's targetId (the capability key).
 * 5. Drops CTAs of unknown kind.
 *
 * The filtering happens on the stored document BEFORE transliteration.
 */

const INTERNAL_LINK_RE = /^nestself:content\/([A-Za-z0-9_-]+)$/;

/** Known CTA kinds (from the block catalogue). */
const KNOWN_CTA_KINDS = new Set([
  'open_content',
  'open_collection',
  'suggest_topic',
  'ask_general_question',
  'express_event_interest',
  'open_service',
]);

/** CTA kinds whose targetId references a content resource (needs availability). */
const CONTENT_TARGETING_CTA_KINDS = new Set(['open_content', 'open_collection']);

/**
 * Node types whose `content` array must be non-empty per ContentDocumentSchema.
 * When filtering empties one, the container itself is removed.
 */
const REQUIRES_NON_EMPTY_CONTENT = new Set([
  'bulletList',
  'orderedList',
  'quote',
  'professionalNote',
  'practicalStep',
  'checklist',
  'transcript',
  'listItem',
]);

// ---------------------------------------------------------------------------
// Collector: walk the document and gather all referenced resource ids
// ---------------------------------------------------------------------------

/**
 * Walk the document tree and collect every content resource id referenced
 * by `cta` nodes (open_content, open_collection targetId),
 * `relatedResource` nodes (contentResourceId),
 * and `link` marks with `nestself:content/<id>` hrefs.
 */
export function collectReferencedResourceIds(doc: unknown): string[] {
  const ids = new Set<string>();
  walkNodes(doc, ids);
  return [...ids];
}

function walkNodes(node: unknown, ids: Set<string>): void {
  if (!node || typeof node !== 'object') return;

  const n = node as Record<string, unknown>;
  const type = n.type as string | undefined;

  if (type === 'relatedResource') {
    const attrs = n.attrs as Record<string, unknown> | undefined;
    if (attrs?.contentResourceId && typeof attrs.contentResourceId === 'string') {
      ids.add(attrs.contentResourceId);
    }
    return;
  }

  if (type === 'cta') {
    const attrs = n.attrs as Record<string, unknown> | undefined;
    if (attrs?.ctaKind && typeof attrs.ctaKind === 'string') {
      if (CONTENT_TARGETING_CTA_KINDS.has(attrs.ctaKind) && typeof attrs.targetId === 'string') {
        ids.add(attrs.targetId);
      }
    }
    return;
  }

  // Check marks on text nodes for internal links
  if (type === 'text') {
    const marks = n.marks as Array<Record<string, unknown>> | undefined;
    if (marks) {
      for (const mark of marks) {
        if (mark.type === 'link') {
          const attrs = mark.attrs as Record<string, unknown> | undefined;
          if (attrs?.href && typeof attrs.href === 'string') {
            const match = INTERNAL_LINK_RE.exec(attrs.href);
            if (match) ids.add(match[1]!);
          }
        }
      }
    }
    return;
  }

  // Recurse into content arrays
  const content = n.content as unknown[] | undefined;
  if (Array.isArray(content)) {
    for (const child of content) {
      walkNodes(child, ids);
    }
  }
}

// ---------------------------------------------------------------------------
// Filter: produce a new document with unavailable references removed
// ---------------------------------------------------------------------------

export interface FilterContext {
  /** Set of resource ids that are available to the reader. */
  availableIds: Set<string>;
  /** The reader's org capabilities. */
  capabilities: readonly string[];
}

/**
 * Filter the document: returns a shallow-copied doc with unavailable
 * references removed. The original document is not mutated.
 */
export function filterDocumentBody(
  doc: unknown,
  ctx: FilterContext,
): unknown {
  if (!doc || typeof doc !== 'object') return doc;

  const d = doc as Record<string, unknown>;
  const content = d.content as unknown[] | undefined;
  if (!Array.isArray(content)) return doc;

  const filtered = content
    .map((node) => filterNode(node, ctx))
    .filter((node): node is NonNullable<typeof node> => node !== null);

  return { ...d, content: filtered };
}

/**
 * Filter a single node. Returns null to drop it, or a (possibly modified)
 * copy to keep it.
 */
function filterNode(
  node: unknown,
  ctx: FilterContext,
): unknown | null {
  if (!node || typeof node !== 'object') return node;

  const n = node as Record<string, unknown>;
  const type = n.type as string | undefined;

  // -- relatedResource: drop if target unavailable
  if (type === 'relatedResource') {
    const attrs = n.attrs as Record<string, unknown> | undefined;
    const targetId = attrs?.contentResourceId;
    if (typeof targetId === 'string' && !ctx.availableIds.has(targetId)) {
      return null;
    }
    return node;
  }

  // -- cta: drop unknown kinds, capability-gate, availability-gate
  if (type === 'cta') {
    const attrs = n.attrs as Record<string, unknown> | undefined;
    const ctaKind = attrs?.ctaKind as string | undefined;

    // Drop unknown kinds
    if (!ctaKind || !KNOWN_CTA_KINDS.has(ctaKind)) return null;

    // open_service: drop unless the capability matches the reader's org
    // Also drop when targetId is not a non-empty string (invalid CTA).
    if (ctaKind === 'open_service') {
      const targetId = attrs?.targetId;
      if (typeof targetId !== 'string' || targetId.length === 0) {
        return null;
      }
      if (!ctx.capabilities.includes(targetId)) {
        return null;
      }
    }

    // Content-targeting CTAs: drop if target unavailable
    if (CONTENT_TARGETING_CTA_KINDS.has(ctaKind)) {
      const targetId = attrs?.targetId;
      if (typeof targetId === 'string' && !ctx.availableIds.has(targetId)) {
        return null;
      }
    }

    return node;
  }

  // -- text nodes: unwrap internal links to unavailable targets
  if (type === 'text') {
    const marks = n.marks as Array<Record<string, unknown>> | undefined;
    if (!marks || marks.length === 0) return node;

    const filteredMarks = marks.filter((mark) => {
      if (mark.type !== 'link') return true;
      const attrs = mark.attrs as Record<string, unknown> | undefined;
      const href = attrs?.href;
      if (typeof href !== 'string') return true;
      const match = INTERNAL_LINK_RE.exec(href);
      if (!match) return true; // external link, keep
      return ctx.availableIds.has(match[1]!);
    });

    if (filteredMarks.length === marks.length) return node; // no change
    if (filteredMarks.length === 0) {
      // Remove marks entirely
      const { marks: _dropped, ...rest } = n;
      return rest;
    }
    return { ...n, marks: filteredMarks };
  }

  // -- Recurse into nodes that have content arrays
  const content = n.content as unknown[] | undefined;
  if (Array.isArray(content)) {
    const filteredContent = content
      .map((child) => filterNode(child, ctx))
      .filter((child): child is NonNullable<typeof child> => child !== null);

    // If filtering empties a container that the schema requires to be
    // non-empty (min(1)), remove the container itself (FMT-R-27).
    if (
      filteredContent.length === 0 &&
      type &&
      REQUIRES_NON_EMPTY_CONTENT.has(type)
    ) {
      return null;
    }

    return { ...n, content: filteredContent };
  }

  return node;
}

// ---------------------------------------------------------------------------
// CTA extraction from the filtered body (must-fix 2)
// ---------------------------------------------------------------------------

export interface ExtractedCta {
  kind: string;
  targetId: string | null;
  label: string | null;
}

/**
 * Extract the first CTA node from a (filtered) document body.
 * The body `cta` node is the single source of truth (FMT-R-05).
 */
export function extractCtaFromBody(doc: unknown): ExtractedCta | null {
  if (!doc || typeof doc !== 'object') return null;

  const d = doc as Record<string, unknown>;
  const content = d.content as unknown[] | undefined;
  if (!Array.isArray(content)) return null;

  for (const node of content) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (n.type !== 'cta') continue;

    const attrs = n.attrs as Record<string, unknown> | undefined;
    if (!attrs?.ctaKind) continue;

    return {
      kind: attrs.ctaKind as string,
      targetId: typeof attrs.targetId === 'string' ? attrs.targetId : null,
      label: typeof attrs.label === 'string' ? attrs.label : null,
    };
  }

  return null;
}
