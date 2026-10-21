import { describe, it, expect } from 'vitest';
import {
  photos,

  availableWidths,
  srcSet,
  focalObjectPosition,
} from './index';

describe('photos', () => {
  it('has the 10 stock photos plus generated imagery with unique keys', () => {
    const stock = photos.filter((p) => p.kind !== 'generated');
    expect(stock).toHaveLength(10);
    expect(new Set(photos.map((p) => p.key)).size).toBe(photos.length);
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

  it('every stock photo has author, pexels source and licence URL', () => {
    for (const p of photos.filter((x) => x.kind !== 'generated')) {
      expect(p.author).toBeTruthy();
      expect(p.source).toMatch(/pexels\.com/);
      expect(p.license).toMatch(/pexels\.com\/license/);
    }
  });

  it('every generated image names its generator and carries the no-endorsement status', () => {
    for (const p of photos.filter((x) => x.kind === 'generated')) {
      expect(p.author).toMatch(/GPT Image/);
      expect(p.status).toMatch(/AI generated/);
      expect(p.usage).toBeTruthy();
    }
  });
});
