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
  home: (ctx: ActiveContext, locale: string) => [...contextKey(ctx), 'library', 'home', locale] as const,
  contentList: (ctx: ActiveContext, locale: string) =>
    [...contextKey(ctx), 'library', 'content', 'list', locale] as const,
  contentDetail: (ctx: ActiveContext, contentId: string, locale: string) =>
    [...contextKey(ctx), 'library', 'content', contentId, locale] as const,
};

export const savedKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'me', 'saved'] as const,
  list: (ctx: ActiveContext, locale: string) =>
    [...contextKey(ctx), 'me', 'saved', locale] as const,
};

export const requestKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'requests'] as const,
};

export const questionKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'questions'] as const,
};

export const cmsKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'cms'] as const,
  resources: (ctx: ActiveContext) => [...contextKey(ctx), 'cms', 'resources'] as const,
  resourceList: (ctx: ActiveContext, params: Record<string, unknown>) =>
    [...contextKey(ctx), 'cms', 'resources', 'list', params] as const,
  resourceDetail: (ctx: ActiveContext, resourceId: string) =>
    [...contextKey(ctx), 'cms', 'resources', resourceId] as const,
};

export const mediaKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'media'] as const,
  detail: (ctx: ActiveContext, assetId: string) =>
    [...contextKey(ctx), 'media', assetId] as const,
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

/** Employee listening (ADR 0002): the employee's survey, the organization's reports and cycles, the operations views. */
export const listeningKeys = {
  all: (ctx: ActiveContext) => [...contextKey(ctx), 'listening'] as const,
  mySurvey: (ctx: ActiveContext) => [...contextKey(ctx), 'listening', 'my-survey'] as const,
  overview: (ctx: ActiveContext, orgId: string) => [...contextKey(ctx), 'listening', orgId, 'overview'] as const,
  heatmap: (ctx: ActiveContext, orgId: string, snapshotId: string | null) =>
    [...contextKey(ctx), 'listening', orgId, 'heatmap', snapshotId ?? 'latest'] as const,
  dimension: (ctx: ActiveContext, orgId: string, key: string, snapshotId: string | null) =>
    [...contextKey(ctx), 'listening', orgId, 'dimension', key, snapshotId ?? 'latest'] as const,
  cycles: (ctx: ActiveContext, orgId: string) => [...contextKey(ctx), 'listening', orgId, 'cycles'] as const,
  configuration: (ctx: ActiveContext, orgId: string) => [...contextKey(ctx), 'listening', orgId, 'configuration'] as const,
  opsConfiguration: (ctx: ActiveContext, orgId: string) => [...contextKey(ctx), 'listening', 'ops', orgId, 'configuration'] as const,
  questionnaires: (ctx: ActiveContext) => [...contextKey(ctx), 'listening', 'ops', 'questionnaires'] as const,
};
