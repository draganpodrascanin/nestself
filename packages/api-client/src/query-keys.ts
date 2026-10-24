/**
 * Query key factories for TanStack Query, scoped by active context.
 *
 * Every query key starts with `contextKey(ctx)` so that
 * `queryClient.clear()` on context switch invalidates all cached data.
 *
 * @see CLI-R-07, C-22
 */
import type { ActiveContext } from '@nestself/contracts';

/**
 * Stable tuple prefix derived from the active context.
 *
 * Examples:
 * - `['ctx', 'personal', 'org_a']`
 * - `['ctx', 'organization', 'org_a']`
 * - `['ctx', 'expert']`
 * - `['ctx', 'operations']`
 */
export function contextKey(
  context: ActiveContext,
): readonly [string, string, ...string[]] {
  switch (context.kind) {
    case 'personal':
      return context.orgId
        ? (['ctx', 'personal', context.orgId] as const)
        : (['ctx', 'personal'] as const);
    case 'organization':
      return ['ctx', 'organization', context.orgId] as const;
    case 'expert':
      return ['ctx', 'expert'] as const;
    case 'operations':
      return ['ctx', 'operations'] as const;
  }
}

// ---------------------------------------------------------------------------
// Key factories — each takes the context first and returns readonly tuples
// that start with `contextKey(context)`.
// ---------------------------------------------------------------------------

export const libraryKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'library'] as const,
  home: (ctx: ActiveContext) => [...contextKey(ctx), 'library', 'home'] as const,
  contentDetail: (ctx: ActiveContext, contentId: string) =>
    [...contextKey(ctx), 'library', 'content', contentId] as const,
};

export const savedKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'saved'] as const,
  list: (ctx: ActiveContext) => [...contextKey(ctx), 'saved', 'list'] as const,
};

export const requestKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'requests'] as const,
};

export const questionKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'questions'] as const,
};

export const cmsKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'cms'] as const,
};

export const mediaKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'media'] as const,
};

export const pollKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'polls'] as const,
};

export const intakeKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'intake'] as const,
};

export const reportingKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'reporting'] as const,
};
