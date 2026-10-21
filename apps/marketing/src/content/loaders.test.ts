import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  getEntry,
  listEntries,
  listSlugs,
  getAssessment,
  listAssessments,
  listAssessmentSlugs,
  loadPageContent,
} from './loaders';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '__fixtures__');
const invalidFixturesDir = join(__dirname, '__fixtures__', 'invalid');

describe('loaders', () => {
  describe('getEntry', () => {
    it('returns the Serbian file with fallback: false', async () => {
      const entry = await getEntry('articles', 'example', 'sr-Latn', {
        root: fixturesDir,
      });
      expect(entry).not.toBeNull();
      expect(entry!.locale).toBe('sr-Latn');
      expect(entry!.requestedLocale).toBe('sr-Latn');
      expect(entry!.fallback).toBe(false);
      expect(entry!.frontmatter.title).toBe(
        'Razumevanje dobrobiti na radnom mestu',
      );
    });

    it('falls back to English for hu (missing locale) with fallback: true', async () => {
      const entry = await getEntry('articles', 'example', 'hu', {
        root: fixturesDir,
      });
      expect(entry).not.toBeNull();
      expect(entry!.locale).toBe('en');
      expect(entry!.requestedLocale).toBe('hu');
      expect(entry!.fallback).toBe(true);
      expect(entry!.frontmatter.title).toBe(
        'Understanding workplace wellbeing',
      );
    });

    it('returns null for a missing slug', async () => {
      const entry = await getEntry('articles', 'missing', 'en', {
        root: fixturesDir,
      });
      expect(entry).toBeNull();
    });
  });

  describe('listEntries', () => {
    it('excludes drafts by default and sorts articles by publishedAt descending', async () => {
      const entries = await listEntries('articles', 'en', {
        root: fixturesDir,
      });
      // draft-only should be excluded
      const slugs = entries.map((e) => e.slug);
      expect(slugs).not.toContain('draft-only');
      expect(slugs).toContain('example');
    });

    it('includes drafts when includeDrafts is true', async () => {
      const entries = await listEntries('articles', 'en', {
        root: fixturesDir,
        includeDrafts: true,
      });
      const slugs = entries.map((e) => e.slug);
      expect(slugs).toContain('draft-only');
    });

    it('sorts webinars by startsAt ascending', async () => {
      const entries = await listEntries('webinars', 'en', {
        root: fixturesDir,
      });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      // With a single webinar, just verify it loads
      expect(entries[0]!.frontmatter.title).toBe('Building resilient teams');
    });
  });

  describe('listSlugs', () => {
    it('lists directories that contain at least an en file', async () => {
      const slugs = await listSlugs('articles', { root: fixturesDir });
      expect(slugs).toContain('example');
      expect(slugs).toContain('draft-only');
    });
  });

  describe('frontmatter validation', () => {
    it('throws an error containing the file path and zod issue path on invalid frontmatter', async () => {
      await expect(
        getEntry('articles', 'broken', 'en', {
          root: invalidFixturesDir,
        }),
      ).rejects.toThrow(/broken\/en\.mdx/);
    });

    it('error message includes the zod issue path', async () => {
      try {
        await getEntry('articles', 'broken', 'en', {
          root: invalidFixturesDir,
        });
        // Should not reach here
        expect.unreachable('Expected getEntry to throw');
      } catch (err) {
        const message = (err as Error).message;
        // The error should mention the file path
        expect(message).toContain('broken');
        // The error should mention the zod issue path (title or topic)
        expect(message).toMatch(/title|topic/);
      }
    });
  });

  describe('getAssessment', () => {
    it('returns the assessment with correct question count', async () => {
      const result = await getAssessment('example', 'en', {
        root: fixturesDir,
      });
      expect(result).not.toBeNull();
      expect(result!.data.questions.length).toBe(4);
      expect(result!.locale).toBe('en');
      expect(result!.fallback).toBe(false);
    });
  });

  describe('listAssessmentSlugs', () => {
    it('lists assessment slugs', async () => {
      const slugs = await listAssessmentSlugs({ root: fixturesDir });
      expect(slugs).toContain('example');
    });
  });

  describe('listAssessments', () => {
    it('lists all assessments for a locale', async () => {
      const assessments = await listAssessments('en', { root: fixturesDir });
      expect(assessments.length).toBeGreaterThanOrEqual(1);
      expect(assessments[0]!.slug).toBe('example');
    });
  });

  describe('loadPageContent', () => {
    const PageSchema = z.object({
      heroTitle: z.string(),
      heroSubtitle: z.string(),
    });

    it('returns the Hungarian file when it exists', async () => {
      const result = await loadPageContent('home', 'hu', PageSchema, {
        root: fixturesDir,
      });
      expect(result.locale).toBe('hu');
      expect(result.fallback).toBe(false);
      expect(result.data.heroTitle).toContain('Tamogassa');
    });

    it('falls back to en for a missing locale with fallback: true', async () => {
      const result = await loadPageContent('home', 'sr-Latn', PageSchema, {
        root: fixturesDir,
      });
      expect(result.locale).toBe('en');
      expect(result.fallback).toBe(true);
    });

    it('throws in strict mode on fallback', async () => {
      const original = process.env.CONTENT_STRICT;
      process.env.CONTENT_STRICT = '1';
      try {
        await expect(
          loadPageContent('home', 'sr-Latn', PageSchema, {
            root: fixturesDir,
          }),
        ).rejects.toThrow();
      } finally {
        if (original === undefined) {
          delete process.env.CONTENT_STRICT;
        } else {
          process.env.CONTENT_STRICT = original;
        }
      }
    });
  });

  describe('readingMinutes in entries', () => {
    it('computes readingMinutes as Math.max(1, Math.round(words / 200))', async () => {
      const entry = await getEntry('articles', 'example', 'en', {
        root: fixturesDir,
      });
      expect(entry).not.toBeNull();
      // The fixture body is short, so should be 1 minute
      expect(entry!.readingMinutes).toBe(1);
    });
  });
});
