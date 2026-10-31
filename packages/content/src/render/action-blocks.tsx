/**
 * Action block components: RelatedResourceCard, ContentCta.
 *
 * Item 16: CTA uses discriminated `ResolvedCta = CtaLink | CtaAction`,
 * rendered with `LinkButton` / `Button` from `@nestself/ui`.
 * Item 6: resolver-returned hrefs pass `isSafeAppHref`.
 * Item 5: contentResourceId validated with ContentIdSchema.
 */
import { Button, LinkButton } from '@nestself/ui';

import { ContentIdSchema } from '../schema/blocks.ts';

import type { RenderContext } from './context.ts';
import { isSafeAppHref } from './safe-href.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
}

// ---------------------------------------------------------------------------
// RelatedResourceCard
// ---------------------------------------------------------------------------

export function RelatedResourceCard({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const rawId = node.attrs?.contentResourceId;
  if (typeof rawId !== 'string') return null;

  // Validate id before calling resolver (item 5)
  if (!ContentIdSchema.safeParse(rawId).success) return null;

  const resolved = ctx.resolveRelated(rawId);
  if (!resolved) return null;

  // Validate resolver href (item 6)
  if (!isSafeAppHref(resolved.href)) return null;

  const Link = ctx.linkComponent ?? 'a';
  return (
    <div className="mb-4 p-4 border border-border-subtle rounded-card bg-raised">
      <Link
        href={resolved.href}
        className="text-primary type-label underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {resolved.title}
      </Link>
      {resolved.description ? (
        <p className="mt-1 text-text-secondary type-body">{resolved.description}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentCta (item 16: discriminated union)
// ---------------------------------------------------------------------------

export function ContentCta({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const attrs = node.attrs as {
    ctaKind: string;
    targetId?: string | null;
    label?: string | null;
  } | undefined;

  if (!attrs) return null;

  const resolved = ctx.resolveCta(attrs);
  if (!resolved) return null;

  if (resolved.kind === 'link') {
    // Validate resolver href (item 6)
    if (!isSafeAppHref(resolved.href)) return null;
    return (
      <div className="mb-4">
        <LinkButton href={resolved.href}>
          {resolved.label}
        </LinkButton>
      </div>
    );
  }

  // kind === 'action'
  return (
    <div className="mb-4">
      <Button onClick={resolved.onActivate}>
        {resolved.label}
      </Button>
    </div>
  );
}
