/**
 * Media tables: assets and their processed renditions [C-14].
 * Platform data, no RLS [C-07].
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  mediaAssetState,
  mediaKind,
  mediaLicenseKind,
  mediaRenditionKind,
  mediaScanStatus,
} from './enums.js';
import { users } from './identity.js';
import { categories } from './taxonomy.js';
import { createdAt, idColumn, ts } from './_shared.js';

/**
 * An uploaded file with processing state, rights and renditions [C-14].
 * Delivery requires the asset to be `ready` with valid rights (C-10).
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: idColumn(),
    kind: mediaKind().notNull(),
    state: mediaAssetState().notNull().default('uploaded'),
    ownerCategoryId: text().references(() => categories.id, { onDelete: 'set null' }),
    originalFilenameHash: text().notNull(),
    checksumSha256: text(),
    byteSize: integer().notNull(),
    mimeType: text().notNull(),
    durationSeconds: integer(),
    width: integer(),
    height: integer(),
    scanStatus: mediaScanStatus().notNull().default('pending'),
    licenseKind: mediaLicenseKind(),
    licenseReference: text(),
    rightsExpiresAt: ts(),
    consentReference: text(),
    altText: jsonb().$type<Record<string, string>>(),
    focalPoint: jsonb().$type<{ x: number; y: number }>(),
    rejectionCode: text(),
    uploadedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    readyAt: ts(),
  },
  (t) => [
    index('media_assets_state_idx').on(t.state),
    index('media_assets_owner_category_idx').on(t.ownerCategoryId),
    index('media_assets_rights_expires_at_idx')
      .on(t.rightsExpiresAt)
      .where(sql`rights_expires_at IS NOT NULL`),
  ],
);

/**
 * Processed output files for a media asset [C-14].
 */
export const mediaRenditions = pgTable(
  'media_renditions',
  {
    id: idColumn(),
    mediaAssetId: text()
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    kind: mediaRenditionKind().notNull(),
    width: integer(),
    height: integer(),
    byteSize: integer().notNull(),
    mimeType: text().notNull(),
    storageKey: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('media_renditions_asset_kind_key').on(t.mediaAssetId, t.kind),
  ],
);
