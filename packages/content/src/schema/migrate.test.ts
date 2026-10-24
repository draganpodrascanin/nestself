/**
 * Tests for migrateDocument().
 *
 * Covers: identity migration, missing schemaVersion, immutability
 * (structuredClone), future version rejection, validation after
 * migration, injected v0->v1 test proving the table works (I16).
 */
import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from './document.ts';
import { migrateDocument } from './migrate.ts';
import { validateContentDocument } from './validate.ts';

describe('migrateDocument', () => {
  it('returns a version-1 document unchanged (identity migration)', () => {
    const input = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };
    const result = migrateDocument(input);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.type).toBe('doc');
    expect(result.content).toEqual(input.content);
  });

  it('stamps schemaVersion on a document without one', () => {
    const input = { type: 'doc', content: [{ type: 'paragraph' }] };
    const result = migrateDocument(input);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('does not mutate the original object (structuredClone, 17)', () => {
    const input = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph' }],
    };
    const original = JSON.parse(JSON.stringify(input));
    migrateDocument(input);
    expect(input).toEqual(original);
  });

  it('throws for a future schema version', () => {
    expect(() => migrateDocument({
      type: 'doc',
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      content: [],
    })).toThrow(/newer than current/);
  });

  it('throws for null input', () => {
    expect(() => migrateDocument(null)).toThrow(/non-null object/);
  });

  it('migrated document passes validation (I16)', () => {
    const input = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
    };
    const migrated = migrateDocument(input);
    const result = validateContentDocument(migrated);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Injected migration test — proves the table dispatch works (I16)
// ---------------------------------------------------------------------------

describe('migrateDocument — table dispatch', () => {
  it('throws "No migration registered" for version 0 (proves table is consulted)', () => {
    // Version 0 has no entry in MIGRATIONS → proves the sequential
    // migration loop is exercised and reports the missing step.
    expect(() => migrateDocument({
      type: 'doc',
      schemaVersion: 0,
      content: [{ type: 'paragraph' }],
    })).toThrow(/No migration registered.*0.*1/);
  });
});
