/**
 * CMS tables: content resources, variants, revisions, publications and their
 * audiences, and the revision-media join table [C-06, C-07].
 *
 * All tables are platform data (no RLS). Catalogue tables are NestSelf-owned,
 * shared across clients and reached only through module services.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  contentAudienceKind,
  contentLocale,
  contentPublicationState,
  contentResourceState,
  contentRevisionState,
  contentReviewPolicy,
  contentType,
  contentCapability,
  durationBand,
  mediaUsageKind,
  reviewDiscipline,
} from './enums.js';
import { users } from './identity.js';
import { organizations } from './organization.js';
import { categories } from './taxonomy.js';
import { mediaAssets } from './media.js';
import { createdAt, idColumn, textArray, ts, updatedAt } from './_shared.js';
import { orgUnits } from './organization.js';

/**
 * Language-independent identity of a content item [C-06].
 * Six resource types: article, video, audio, practical, qa, collection.
 */
export const contentResources = pgTable(
  'content_resources',
  {
    id: idColumn(),
    type: contentType().notNull(),
    state: contentResourceState().notNull().default('active'),
    primaryCategoryId: text()
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    ownerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    backupOwnerUserId: text().references(() => users.id, { onDelete: 'set null' }),
    reviewPolicy: contentReviewPolicy().notNull().default('professional'),
    reviewDiscipline: reviewDiscipline(),
    schemaVersion: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts(),
  },
  (t) => [
    index('content_resources_type_state_idx').on(t.type, t.state),
    index('content_resources_primary_category_id_idx').on(t.primaryCategoryId),
    index('content_resources_owner_user_id_idx').on(t.ownerUserId),
    check(
      'content_resources_discipline_check',
      sql`review_policy != 'professional' OR review_discipline IS NOT NULL`,
    ),
  ],
);

/**
 * One row per resource and locale. `sr-Cyrl` is never stored; it is
 * derived at read time [C-28, DAT-R-05].
 */
export const contentVariants = pgTable(
  'content_variants',
  {
    id: idColumn(),
    contentResourceId: text()
      .notNull()
      .references(() => contentResources.id, { onDelete: 'cascade' }),
    locale: contentLocale().notNull(),
    slug: text().notNull(),
    localApplicability: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('content_variants_resource_locale_key').on(t.contentResourceId, t.locale),
    uniqueIndex('content_variants_slug_locale_key').on(t.slug, t.locale),
    check(
      'content_variants_authored_locale_check',
      sql`locale <> 'sr-Cyrl'`,
    ),
  ],
);

/**
 * Immutable snapshot of content once submitted. Edits to a draft are in-place
 * updates on the working revision; edits after submission create a new
 * revision [C-06].
 */
export const contentRevisions = pgTable(
  'content_revisions',
  {
    id: idColumn(),
    contentVariantId: text()
      .notNull()
      .references(() => contentVariants.id, { onDelete: 'cascade' }),
    revisionNumber: integer().notNull(),
    state: contentRevisionState().notNull().default('draft'),
    body: jsonb().notNull(),
    title: text().notNull(),
    summary: text().notNull(),
    outcome: text(),
    durationSeconds: integer(),
    durationBand: durationBand(),
    difficulty: text(),
    sources: jsonb(),
    proposedAudience: jsonb(),
    cta: jsonb(),
    relatedResourceIds: textArray(),
    authorUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    lastEditorUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    lockVersion: integer().notNull().default(1),
    approvalHash: text(),
    submittedAt: ts(),
    approvedAt: ts(),
    approvedByUserId: text().references(() => users.id, { onDelete: 'set null' }),
    reviewDueAt: ts(),
    quicklyOutdated: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('content_revisions_variant_number_key').on(t.contentVariantId, t.revisionNumber),
    index('content_revisions_variant_state_idx').on(t.contentVariantId, t.state),
    check(
      'content_revisions_related_limit',
      sql`array_length(related_resource_ids, 1) IS NULL OR array_length(related_resource_ids, 1) <= 3`,
    ),
  ],
);

/**
 * Which media assets a revision references and in what role.
 */
export const contentRevisionMedia = pgTable(
  'content_revision_media',
  {
    id: idColumn(),
    contentRevisionId: text()
      .notNull()
      .references(() => contentRevisions.id, { onDelete: 'cascade' }),
    mediaAssetId: text()
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    usageKind: mediaUsageKind().notNull(),
  },
  (t) => [
    uniqueIndex('content_revision_media_revision_asset_key').on(
      t.contentRevisionId,
      t.mediaAssetId,
    ),
  ],
);

/**
 * An approved revision made available to an audience in a time window [C-06].
 * `required_capability` is NOT NULL, default `'library'` (C-11 revised).
 */
export const contentPublications = pgTable(
  'content_publications',
  {
    id: idColumn(),
    contentVariantId: text()
      .notNull()
      .references(() => contentVariants.id, { onDelete: 'restrict' }),
    contentRevisionId: text()
      .notNull()
      .references(() => contentRevisions.id, { onDelete: 'restrict' }),
    approvalHash: text().notNull(),
    state: contentPublicationState().notNull(),
    requiredCapability: contentCapability().notNull().default('library'),
    startsAt: ts().notNull(),
    endsAt: ts(),
    scheduleTimeZone: text(),
    withdrawnAt: ts(),
    withdrawnByUserId: text().references(() => users.id, { onDelete: 'restrict' }),
    withdrawalReason: text(),
    publishedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    editorialPriority: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('content_publications_variant_state_starts_idx').on(
      t.contentVariantId, t.state, t.startsAt,
    ),
    index('content_publications_state_idx').on(t.state),
  ],
);

/**
 * Which organizations or org units a publication is available to. Rows
 * combine with OR within a publication [C-12]. Platform data, no RLS (C-07).
 */
export const contentPublicationAudiences = pgTable(
  'content_publication_audiences',
  {
    id: idColumn(),
    publicationId: text()
      .notNull()
      .references(() => contentPublications.id, { onDelete: 'cascade' }),
    kind: contentAudienceKind().notNull(),
    orgId: text().references(() => organizations.id, { onDelete: 'restrict' }),
    orgUnitId: text().references(() => orgUnits.id, { onDelete: 'restrict' }),
    includeDescendants: boolean().notNull().default(true),
  },
  (t) => [index('content_publication_audiences_pub_idx').on(t.publicationId)],
);
