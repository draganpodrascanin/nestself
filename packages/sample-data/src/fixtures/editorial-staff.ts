/**
 * Editorial sample fixtures for the CMS epic (T-C1.03).
 *
 * `SAMPLE_CATEGORY_IDS` are the stable ids of the six launch categories
 * (epic 5.1). A COLLECTION assignment's `targetId` is one of these ids
 * (cms-ee C-09). Category rows and labels arrive with the taxonomy tables.
 *
 * `SAMPLE_EDITORIAL_STAFF` are fictional operations staff, one per editorial
 * template. They have no legacy role, so the API seed grants their templates
 * explicitly (like the sample employer owner) and never derives them.
 */

export const SAMPLE_CATEGORY_IDS = {
  stress: 'cat_stress',
  sleep: 'cat_sleep',
  relationships: 'cat_relationships',
  money: 'cat_money',
  work: 'cat_work',
  body: 'cat_body',
} as const;

export type SampleCategoryId = (typeof SAMPLE_CATEGORY_IDS)[keyof typeof SAMPLE_CATEGORY_IDS];

/** Every launch category id, in catalogue order. */
export const SAMPLE_CATEGORY_ID_LIST: readonly SampleCategoryId[] = Object.values(SAMPLE_CATEGORY_IDS);

export const SAMPLE_EDITORIAL_STAFF = [
  {
    id: 'user_katarina',
    displayName: 'Katarina',
    initials: 'KA',
    templateKey: 'content_author' as const,
    /** Review disciplines for a `categories` condition; empty for non-reviewers. */
    disciplines: [] as readonly string[],
    categoryIds: SAMPLE_CATEGORY_ID_LIST,
    portrait: null,
    sample: true as const,
  },
  {
    id: 'user_darko',
    displayName: 'Darko',
    initials: 'DA',
    templateKey: 'content_reviewer' as const,
    disciplines: ['psychological', 'general'] as readonly string[],
    categoryIds: SAMPLE_CATEGORY_ID_LIST,
    portrait: null,
    sample: true as const,
  },
  {
    id: 'user_milena',
    displayName: 'Milena',
    initials: 'ML',
    templateKey: 'content_publisher' as const,
    disciplines: [] as readonly string[],
    categoryIds: SAMPLE_CATEGORY_ID_LIST,
    portrait: null,
    sample: true as const,
  },
  {
    id: 'user_vuk',
    displayName: 'Vuk',
    initials: 'VU',
    templateKey: 'editorial_lead' as const,
    disciplines: [] as readonly string[],
    categoryIds: [] as readonly SampleCategoryId[],
    portrait: null,
    sample: true as const,
  },
] as const;
