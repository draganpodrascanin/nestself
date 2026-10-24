/**
 * Content document migration (FMT-R-20, FMT-R-21).
 *
 * Every ContentDocument carries a `schemaVersion` integer. When the
 * block catalogue changes, the version increments and a migration
 * function is added to the `MIGRATIONS` table below.
 *
 * `migrateDocument(doc)` applies every migration from the stored
 * version to the current version sequentially. The original JSON is
 * never mutated; a new object is returned at the current version.
 */
import { CURRENT_SCHEMA_VERSION } from './document.ts';

// ---------------------------------------------------------------------------
// Migration table
// ---------------------------------------------------------------------------

/**
 * Each entry migrates from (key) to (key + 1).
 * Add a new entry when CURRENT_SCHEMA_VERSION increments.
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // Version 1 is the initial version — identity migration (FMT-R-21).
  // When version 2 is introduced, add:
  //   1: (doc) => { /* transform v1 → v2 */ return { ...doc, schemaVersion: 2 }; },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Migrate a stored document to the current schema version.
 *
 * - If the document is already at the current version, it is returned as-is.
 * - If the document is at a lower version, migrations are applied sequentially.
 * - If the document has no `schemaVersion`, it is treated as version 1.
 * - If the version is higher than the current version, an error is thrown
 *   (forward migrations are not supported).
 *
 * The returned document always has `schemaVersion === CURRENT_SCHEMA_VERSION`.
 */
export function migrateDocument(doc: unknown): Record<string, unknown> {
  if (doc === null || typeof doc !== 'object') {
    throw new Error('migrateDocument: input must be a non-null object');
  }

  let current = { ...(doc as Record<string, unknown>) };
  let version = typeof current.schemaVersion === 'number' ? current.schemaVersion : 1;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `migrateDocument: document schemaVersion ${version} is newer than ` +
        `current version ${CURRENT_SCHEMA_VERSION}. Forward migration is not supported.`,
    );
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new Error(
        `migrateDocument: no migration defined for version ${version} → ${version + 1}.`,
      );
    }
    current = migrate(current);
    version++;
  }

  // Ensure the version is stamped even for the identity case.
  current.schemaVersion = CURRENT_SCHEMA_VERSION;
  return current;
}
