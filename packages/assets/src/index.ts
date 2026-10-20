import photosJson from '../photos.json';

export type PhotoKey = 'family-grass' | 'family-autumn' | 'grandfather' | 'older-couple' | 'family-carry' | 'family-play' | 'care-home' | 'couple-cooking' | 'friends-men' | 'friends-bench';
export type ImageRole = 'hero-3x2' | 'hero-4x5' | 'portrait' | 'card' | 'avatar' | 'article';
export type ImageFormat = 'avif' | 'webp' | 'jpg';
export interface Photo { key: PhotoKey; id: number; author: string; source: string; license: string; width: number; height: number; focalPoint: { x: number; y: number }; status: string; usage: string; asset: string }

export const photos = photosJson as Photo[];
export const photoByKey = Object.fromEntries(photos.map((p) => [p.key, p])) as Record<PhotoKey, Photo>;
export const RESPONSIVE_WIDTHS = [480, 768, 1024, 1280, 1600] as const;
export const IMAGE_FORMATS: ImageFormat[] = ['avif', 'webp', 'jpg'];
export const CROP_SPECS: Record<ImageRole, { width: number; height: number; targetKB: number; aspectRatio: string }> = {
  'hero-3x2': { width: 1600, height: 1067, targetKB: 200, aspectRatio: '3:2' },
  'hero-4x5': { width: 800, height: 1000, targetKB: 200, aspectRatio: '4:5' },
  portrait: { width: 800, height: 1000, targetKB: 150, aspectRatio: '4:5' },
  card: { width: 800, height: 450, targetKB: 80, aspectRatio: '16:9' },
  avatar: { width: 320, height: 320, targetKB: 35, aspectRatio: '1:1' },
  article: { width: 1200, height: 675, targetKB: 120, aspectRatio: '16:9' },
};
export const IMAGE_BASE_PATH = '/images';

/** Widths actually generated for a photo (never enlarged). */
export function availableWidths(key: PhotoKey): number[] { return RESPONSIVE_WIDTHS.filter((w) => w <= photoByKey[key].width); }
/** `/images/<key>/<key>-<width>.<ext>` */
export function variantPath(key: PhotoKey, width: number, format: ImageFormat): string { return `${IMAGE_BASE_PATH}/${key}/${key}-${width}.${format}`; }
export function cropPath(key: PhotoKey, role: ImageRole, format: ImageFormat): string { return `${IMAGE_BASE_PATH}/${key}/${key}-${role}.${format}`; }
export function srcSet(key: PhotoKey, format: ImageFormat): string { return availableWidths(key).map((w) => `${variantPath(key, w, format)} ${w}w`).join(', '); }
/** CSS object-position from the normalized focal point, e.g. "50% 54%". */
export function focalObjectPosition(key: PhotoKey): string { const f = photoByKey[key].focalPoint; return `${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%`; }
/** expo-image contentPosition from the focal point. */
export function focalContentPosition(key: PhotoKey): { top: `${number}%`; left: `${number}%` } { const f = photoByKey[key].focalPoint; return { top: `${Math.round(f.y * 100)}%`, left: `${Math.round(f.x * 100)}%` }; }
export const fontFiles = { web: { onest: ['Onest-Regular.woff2', 'Onest-SemiBold.woff2', 'Onest-Bold.woff2'] }, native: { onest: ['native/Onest-Regular.ttf', 'native/Onest-SemiBold.ttf', 'native/Onest-Bold.ttf'] } } as const;
