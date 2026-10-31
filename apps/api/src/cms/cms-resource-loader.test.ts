/**
 * CmsResourceLoader unit tests (T-C1.10).
 *
 * Tests the resource-resolution methods used by @Authorize() resolvers.
 * Uses a mock DbService with canned query results so no database is needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { CmsResourceLoader } from './cms-resource-loader.js';

// ---------------------------------------------------------------------------
// Mock DbService
// ---------------------------------------------------------------------------

function mockDbService(rows: Record<string, unknown>[] = []) {
  const selectChain: Record<string, unknown> = {};
  selectChain.from = vi.fn().mockReturnValue(selectChain);
  selectChain.innerJoin = vi.fn().mockReturnValue(selectChain);
  selectChain.where = vi.fn().mockReturnValue(selectChain);
  selectChain.limit = vi.fn().mockResolvedValue(rows);

  const db = {
    select: vi.fn().mockReturnValue(selectChain),
  };
  return { db } as unknown as ConstructorParameters<typeof CmsResourceLoader>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CmsResourceLoader', () => {
  describe('forAsset', () => {
    it('returns null when no row matches', async () => {
      const loader = new CmsResourceLoader(mockDbService([]));
      expect(await loader.forAsset('asset_missing')).toBeNull();
    });

    it('returns media_asset resource with correct ids', async () => {
      const loader = new CmsResourceLoader(
        mockDbService([{ id: 'asset_1', ownerCategoryId: 'cat_stress' }]),
      );
      const result = await loader.forAsset('asset_1');
      expect(result).toEqual({
        type: 'media_asset',
        id: 'asset_1',
        collectionId: 'cat_stress',
      });
    });
  });

  describe('forCreate', () => {
    it('returns a content_resource with empty id', () => {
      const loader = new CmsResourceLoader(mockDbService());
      const result = loader.forCreate('cat_stress');
      expect(result).toEqual({
        type: 'content_resource',
        id: '',
        collectionId: 'cat_stress',
      });
    });
  });

  describe('forResource', () => {
    it('returns null for missing resource', async () => {
      const loader = new CmsResourceLoader(mockDbService([]));
      expect(await loader.forResource('res_missing')).toBeNull();
    });

    it('returns the resource with primary category', async () => {
      const loader = new CmsResourceLoader(
        mockDbService([{ id: 'res_1', primaryCategoryId: 'cat_anxiety' }]),
      );
      const result = await loader.forResource('res_1');
      expect(result).toEqual({
        type: 'content_resource',
        id: 'res_1',
        collectionId: 'cat_anxiety',
      });
    });
  });

  describe('forRevision', () => {
    const revRow = {
      resourceId: 'res_1',
      primaryCategoryId: 'cat_stress',
      reviewDiscipline: 'psychological',
      authorUserId: 'user_a',
      lastEditorUserId: 'user_b',
      variantLocale: 'sr-Latn',
    };

    it('returns null for missing revision', async () => {
      const loader = new CmsResourceLoader(mockDbService([]));
      expect(await loader.forRevision('rev_missing')).toBeNull();
    });

    it('returns resource without category when forReview is false', async () => {
      const loader = new CmsResourceLoader(mockDbService([revRow]));
      const result = await loader.forRevision('rev_1');
      expect(result).toBeTruthy();
      expect(result!.category).toBeUndefined();
      expect(result!.collectionId).toBe('cat_stress');
    });

    it('sets category to reviewDiscipline when forReview is true (ACC-R-07)', async () => {
      const loader = new CmsResourceLoader(mockDbService([revRow]));
      const result = await loader.forRevision('rev_1', { forReview: true });
      expect(result).toBeTruthy();
      expect(result!.category).toBe('psychological');
      expect(result!.reviewDiscipline).toBe('psychological');
    });

    it('preserves author and editor user ids', async () => {
      const loader = new CmsResourceLoader(mockDbService([revRow]));
      const result = await loader.forRevision('rev_1', { forReview: true });
      expect(result!.authorUserId).toBe('user_a');
      expect(result!.lastEditorUserId).toBe('user_b');
      expect(result!.variantLocale).toBe('sr-Latn');
    });

    it('returns category as undefined when reviewDiscipline is null and forReview', async () => {
      const nullDiscipline = { ...revRow, reviewDiscipline: null };
      const loader = new CmsResourceLoader(mockDbService([nullDiscipline]));
      const result = await loader.forRevision('rev_1', { forReview: true });
      expect(result!.category).toBeUndefined();
      expect(result!.reviewDiscipline).toBeNull();
    });
  });

  describe('forVariant', () => {
    it('returns null for missing variant', async () => {
      const loader = new CmsResourceLoader(mockDbService([]));
      expect(await loader.forVariant('var_missing')).toBeNull();
    });

    it('returns the resource id from the join', async () => {
      const loader = new CmsResourceLoader(
        mockDbService([{ resourceId: 'res_1', primaryCategoryId: 'cat_stress' }]),
      );
      const result = await loader.forVariant('var_1');
      expect(result).toEqual({
        type: 'content_resource',
        id: 'res_1',
        collectionId: 'cat_stress',
      });
    });
  });

  describe('forPublication', () => {
    it('returns null for missing publication', async () => {
      const loader = new CmsResourceLoader(mockDbService([]));
      expect(await loader.forPublication('pub_missing')).toBeNull();
    });

    it('resolves through variant → resource join', async () => {
      const loader = new CmsResourceLoader(
        mockDbService([{ resourceId: 'res_1', primaryCategoryId: 'cat_stress' }]),
      );
      const result = await loader.forPublication('pub_1');
      expect(result).toEqual({
        type: 'content_resource',
        id: 'res_1',
        collectionId: 'cat_stress',
      });
    });
  });
});
