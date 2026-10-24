/**
 * Tests for migrateDocument().
 *
 * Covers: identity migration, missing schemaVersion, immutability
 * (structuredClone), future version rejection, validation after
 * migration, injectable migration table (I16), end-to-end injected
 * v0->v1 test proving the table works.
 */
import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from './document.ts';
import { migrateDocument, type MigrationFn } from './migrate.ts';
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
// Injectable migration table (I16)
// ---------------------------------------------------------------------------

describe('migrateDocument — injectable migration table (I16)', () => {
  it('throws "No migration registered" for version 0 with default table', () => {
    expect(() => migrateDocument({
      type: 'doc',
      schemaVersion: 0,
      content: [{ type: 'paragraph' }],
    })).toThrow(/No migration registered.*0.*1/);
  });

  it('applies an injected v0→v1 migration', () => {
    const testMigrations: Record<number, MigrationFn> = {
      0: (doc) => ({
        ...doc,
        schemaVersion: 1,
        // Simulate a migration that adds default content
        content: doc.content || [{ type: 'paragraph', content: [{ type: 'text', text: 'Migrated' }] }],
      }),
    };

    const input = {
      type: 'doc',
      schemaVersion: 0,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old' }] }],
    };

    const result = migrateDocument(input, testMigrations);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.type).toBe('doc');
  });

  it('injected migration output passes validation end-to-end', () => {
    const testMigrations: Record<number, MigrationFn> = {
      0: (doc) => ({
        ...doc,
        schemaVersion: 1,
      }),
    };

    const input = {
      type: 'doc',
      schemaVersion: 0,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Migrated' }] }],
    };

    const migrated = migrateDocument(input, testMigrations);
    const result = validateContentDocument(migrated);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ProseMirror-only rejection (I16)
// ---------------------------------------------------------------------------

describe('migrateDocument + validateContentDocument — ProseMirror-only rejection', () => {
  it('Zod catches hardBreak in sectionHeading (R1)', () => {
    // HeadingInlineSchema = TextNodeSchema only (no hardBreak), so Zod
    // rejects this before ProseMirror. This test proves the two-layer
    // pipeline catches it regardless of which layer fires.
    const input = {
      type: 'doc',
      schemaVersion: 1,
      content: [{
        type: 'sectionHeading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Title' }, { type: 'hardBreak' }],
      }],
    };
    const result = validateContentDocument(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
    }
  });

  it('ProseMirror catches structural violation that Zod allows', () => {
    // A text node directly under doc passes Zod's schema (text is in
    // BlockNodeSchema's discriminated union via an unintended code path)
    // — but ProseMirror's content expressions reject it.
    const result = validateContentDocument({
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'text', text: 'orphan' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'content_invalid_block')).toBe(true);
    }
  });
});
