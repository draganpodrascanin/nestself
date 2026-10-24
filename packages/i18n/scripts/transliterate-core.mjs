/**
 * Re-export the shared transliteration implementation from @nestself/content.
 *
 * The canonical implementation lives in packages/content/src/schema/transliterate-core.mjs.
 * This re-export ensures both the i18n build script and the content package use
 * one shared, pure implementation (FMT-R-26, C-28).
 */
export { transliterate, transliterateObject } from '../../content/src/schema/transliterate-core.mjs';
