/**
 * Content document migration (FMT-R-20, FMT-R-21).
 *
 * Reads older document versions and migrates them to the current
 * schema version. Each migration step is a pure function that takes
 * a document at version N and returns a document at version N+1.
 *
 * Returns a `ContentDocument` via `structuredClone` (17).
 */
import { type ContentDocument, CURRENT_SCHEMA_VERSION } from './document.ts';

// ---------------------------------------------------------------------------
// Migration table
// ---------------------------------------------------------------------------

/**
 * Each entry is a function from version N to version N+1.
 * The key is the source version.
 */
export type MigrationFn = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * The default migration table. Exported for testing (I16).
 */
export const MIGRATIONS: Record<number, MigrationFn> = {
  // Version 1 is the current version — identity migration.
  // When version 2 is introduced, add:
  //   1: (doc) => { /* transform v1 → v2 */ return { ...doc, schemaVersion: 2 }; },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Migrate a content document to the current schema version.
 *
 * - Documents without `schemaVersion` are treated as version 1.
 * - Future versions (> CURRENT_SCHEMA_VERSION) throw.
 * - The input is never mutated; returns a deep clone.
 *
 * Use for **reads** of stored documents. Writes require
 * `schemaVersion === CURRENT_SCHEMA_VERSION` (enforced by
 * `validateContentDocument`).
 *
 * The `migrations` parameter is injectable for testing (I16).
 */
export function migrateDocument(
  input: unknown,
  migrations: Record<number, MigrationFn> = MIGRATIONS,
): ContentDocument {
  if (input === null || typeof input !== 'object') {
    throw new Error('migrateDocument expects a non-null object.');
  }

  // Deep clone to avoid mutating the input (17)
  const doc = structuredClone(input) as Record<string, unknown>;

  // Default missing schemaVersion to 1
  if (!('schemaVersion' in doc) || doc.schemaVersion == null) {
    doc.schemaVersion = 1;
  }

  let version = doc.schemaVersion as number;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Document schemaVersion ${version} is newer than current version ${CURRENT_SCHEMA_VERSION}. ` +
      'Upgrade the application to read this document.',
    );
  }

  // Apply migrations sequentially
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) {
      throw new Error(
        `No migration registered for version ${version} → ${version + 1}.`,
      );
    }
    Object.assign(doc, migrate(doc));
    version = doc.schemaVersion as number;
  }

  return doc as unknown as ContentDocument;
}
