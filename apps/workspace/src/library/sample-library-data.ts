/**
 * Maps SAMPLE_CONTENT_RESOURCES to the library card and detail shapes
 * used by the workspace routes in sample mode (CLI-R-14).
 *
 * No inline fictional data: everything comes from `@nestself/sample-data`.
 */
import {
  SAMPLE_CONTENT_RESOURCES,
  SAMPLE_CATEGORY_LABELS,
} from '@nestself/sample-data';
import type {
  SampleContentResource,
  SampleContentVariant,
} from '@nestself/sample-data';
import type { LibraryCard, LibraryContentDetail, SavedItem } from '@nestself/contracts';

function findVariant(
  resource: SampleContentResource,
  locale: string,
): SampleContentVariant {
  // Try exact match first, fall back to en
  return (
    resource.variants.find((v) => v.locale === locale) ??
    resource.variants.find((v) => v.locale === 'en') ??
    resource.variants[0]!
  );
}

function categoryLabel(categoryId: string, locale: string): string {
  const label =
    SAMPLE_CATEGORY_LABELS.find(
      (l) => l.categoryId === categoryId && l.locale === locale,
    ) ??
    SAMPLE_CATEGORY_LABELS.find(
      (l) => l.categoryId === categoryId && l.locale === 'en',
    );
  return label?.name ?? categoryId;
}

/**
 * Returns the available sample content resources as LibraryCard shapes.
 * Excludes future and withdrawn articles.
 */
export function sampleContentCards(locale: string): LibraryCard[] {
  return SAMPLE_CONTENT_RESOURCES
    .filter((r) => r.scenario === 'all_eligible' || r.scenario === 'org_a')
    .map((r) => {
      const variant = findVariant(r, locale);
      return {
        resourceId: r.id,
        type: r.type,
        locale: variant.locale,
        title: variant.title,
        summary: variant.summary,
        categoryName: categoryLabel(r.primaryCategoryId, locale),
        durationBand: r.durationBand,
        coverImageUrl: null,
        saved: false,
        availableLocales: r.variants.map((v) => v.locale),
      };
    });
}

/**
 * Returns a sample content detail by resource id and locale.
 */
export function sampleContentDetail(
  contentId: string,
  locale: string,
): LibraryContentDetail | null {
  const resource = SAMPLE_CONTENT_RESOURCES.find((r) => r.id === contentId);
  if (!resource) return null;
  // Only show available resources
  if (resource.scenario !== 'all_eligible' && resource.scenario !== 'org_a') return null;

  const variant = findVariant(resource, locale);
  return {
    id: resource.id,
    type: resource.type,
    locale: variant.locale,
    title: variant.title,
    summary: variant.summary,
    outcome: variant.outcome,
    body: variant.body,
    durationSeconds: resource.durationSeconds,
    durationBand: resource.durationBand,
    difficulty: resource.difficulty,
    category: {
      id: resource.primaryCategoryId,
      slug: resource.primaryCategoryId,
      label: categoryLabel(resource.primaryCategoryId, locale),
      description: null,
    },
    secondaryCategories: [],
    topics: [],
    authorName: 'Editorial team',
    reviewerName: null,
    reviewedAt: null,
    sources: [],
    media: [],
    relatedResources: [],
    cta: null,
    availableLocales: resource.variants.map((v) => v.locale),
    saved: false,
    playbackPosition: null,
    replacementLink: null,
  };
}

/**
 * Returns sample saved items (empty by default; sample mode has no persistence).
 */
export function sampleSavedItems(): SavedItem[] {
  return [];
}
