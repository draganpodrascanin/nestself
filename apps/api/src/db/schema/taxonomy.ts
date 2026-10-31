/**
 * Taxonomy tables: categories and their locale-specific labels.
 * Platform data, no RLS [C-07, C-09].
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { contentLocale } from './enums.js';
import { createdAt, idColumn } from './_shared.js';

/**
 * Editorial ownership unit and top-level browse category [C-09].
 * Six launch categories: stress, sleep, relationships, money, work, body.
 */
export const categories = pgTable(
  'categories',
  {
    id: idColumn(),
    slug: text().notNull(),
    promotable: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('categories_slug_key').on(t.slug)],
);

/**
 * Locale-specific name and description for a category.
 * `sr-Cyrl` labels are derived at read time, never stored [C-28, DAT-R-05].
 */
export const categoryLabels = pgTable(
  'category_labels',
  {
    id: idColumn(),
    categoryId: text()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    locale: contentLocale().notNull(),
    name: text().notNull(),
    description: text(),
  },
  (t) => [
    uniqueIndex('category_labels_category_locale_key').on(t.categoryId, t.locale),
    check(
      'category_labels_authored_locale_check',
      sql`locale <> 'sr-Cyrl'`,
    ),
  ],
);
