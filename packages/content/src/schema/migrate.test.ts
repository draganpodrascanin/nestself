/**
 * Tests for migrateDocument().
 */
import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from './document.ts';
import { migrateDocument } from './migrate.ts';

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
    const input = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
    const result = migrateDocument(input);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('does not mutate the original object', () => {
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
    const input = {
      type: 'doc',
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      content: [],
    };
    expect(() => migrateDocument(input)).toThrow(/newer than current/);
  });

  it('throws for null input', () => {
    expect(() => migrateDocument(null)).toThrow(/non-null object/);
  });

  it('round-trips through validation', () => {
    // A version-1 document should still be valid after migration.
    const input = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
    };
    const migrated = migrateDocument(input);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.type).toBe('doc');
  });
});
