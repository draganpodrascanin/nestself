import { describe, it, expect } from 'vitest';
import {
  photos,

  availableWidths,
  srcSet,
  focalObjectPosition,
} from './index';

describe('photos', () => {
  it('has 10 photos', () => {
    expect(photos).toHaveLength(10);
  });

  it('focal points within 0..1', () => {
    for (const p of photos) {
      expect(p.focalPoint.x).toBeGreaterThanOrEqual(0);
      expect(p.focalPoint.x).toBeLessThanOrEqual(1);
      expect(p.focalPoint.y).toBeGreaterThanOrEqual(0);
      expect(p.focalPoint.y).toBeLessThanOrEqual(1);
    }
  });

  it('availableWidths for family-carry equals [480, 768, 1024]', () => {
    expect(availableWidths('family-carry')).toEqual([480, 768, 1024]);
  });

  it('srcSet for family-grass avif contains 1600w', () => {
    expect(srcSet('family-grass', 'avif')).toContain(' 1600w');
  });

  it('focalObjectPosition for family-grass is "50% 54%"', () => {
    expect(focalObjectPosition('family-grass')).toBe('50% 54%');
  });

  it('every photo has author, pexels source and licence URL', () => {
    for (const p of photos) {
      expect(p.author).toBeTruthy();
      expect(p.source).toMatch(/pexels\.com/);
      expect(p.license).toMatch(/pexels\.com\/license/);
    }
  });
});
