/**
 * Deterministic Serbian Latin-to-Cyrillic transliteration.
 *
 * This is the canonical, shared implementation used by:
 * - `@nestself/content/schema` (document transliteration)
 * - `packages/i18n/scripts/transliterate.mjs` (Cyrillic locale build)
 *
 * Pure module — no Node.js built-ins, no filesystem access beyond the
 * JSON import. Handles digraphs (longest first), preserves
 * {{placeholders}}, <tags>, URLs and protected terms from the
 * exceptions list (`scripts/transliteration-exceptions.json`).
 *
 * @module @nestself/i18n/transliterate
 */

import exceptions from '../scripts/transliteration-exceptions.json' with { type: 'json' };

const protectedTerms: string[] = exceptions.protected;
const wordOverrides: Record<string, string> = exceptions.wordOverrides;

// Digraphs first (longest), then single letters
const digraphMap: ReadonlyArray<readonly [string, string]> = [
  ['Dž', 'Џ'], ['dž', 'џ'], ['DŽ', 'Џ'],
  ['Lj', 'Љ'], ['lj', 'љ'], ['LJ', 'Љ'],
  ['Nj', 'Њ'], ['nj', 'њ'], ['NJ', 'Њ'],
];

const singleMap: ReadonlyArray<readonly [string, string]> = [
  ['A', 'А'], ['a', 'а'],
  ['B', 'Б'], ['b', 'б'],
  ['V', 'В'], ['v', 'в'],
  ['G', 'Г'], ['g', 'г'],
  ['D', 'Д'], ['d', 'д'],
  ['Đ', 'Ђ'], ['đ', 'ђ'],
  ['E', 'Е'], ['e', 'е'],
  ['Ž', 'Ж'], ['ž', 'ж'],
  ['Z', 'З'], ['z', 'з'],
  ['I', 'И'], ['i', 'и'],
  ['J', 'Ј'], ['j', 'ј'],
  ['K', 'К'], ['k', 'к'],
  ['L', 'Л'], ['l', 'л'],
  ['M', 'М'], ['m', 'м'],
  ['N', 'Н'], ['n', 'н'],
  ['O', 'О'], ['o', 'о'],
  ['P', 'П'], ['p', 'п'],
  ['R', 'Р'], ['r', 'р'],
  ['S', 'С'], ['s', 'с'],
  ['T', 'Т'], ['t', 'т'],
  ['Ć', 'Ћ'], ['ć', 'ћ'],
  ['U', 'У'], ['u', 'у'],
  ['F', 'Ф'], ['f', 'ф'],
  ['H', 'Х'], ['h', 'х'],
  ['C', 'Ц'], ['c', 'ц'],
  ['Č', 'Ч'], ['č', 'ч'],
  ['Š', 'Ш'], ['š', 'ш'],
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Transliterate a single string from Serbian Latin to Cyrillic.
 * Preserves: {{placeholders}}, `<html-tags>`, URLs (http/https),
 * protected terms from the exception list.
 */
export function transliterate(input: string): string {
  if (typeof input !== 'string') return input;

  // Build patterns to preserve
  const preservePatterns: string[] = [];

  // Protected terms (exact match)
  for (const term of protectedTerms) {
    preservePatterns.push(escapeRegex(term));
  }

  // {{placeholders}}
  preservePatterns.push('\\{\\{[^}]+\\}\\}');

  // <html tags>
  preservePatterns.push('<[^>]+>');

  // URLs
  preservePatterns.push('https?://[^\\s"\'<>]+');

  const preserveRegex = new RegExp(`(${preservePatterns.join('|')})`, 'g');

  // Split text into preservable and transliterable segments
  const segments = input.split(preserveRegex);

  return segments
    .map((segment) => {
      // If segment matches any preserve pattern, return as-is
      if (preserveRegex.test(segment)) {
        preserveRegex.lastIndex = 0;
        return segment;
      }
      return transliterateSegment(segment);
    })
    .join('');
}

/**
 * Transliterate a segment of text, applying word overrides first.
 */
function transliterateSegment(text: string): string {
  // Apply word overrides on whole words (case-insensitively, preserving initial capital)
  let result = text;
  for (const [latin, cyrillic] of Object.entries(wordOverrides)) {
    const regex = new RegExp(`\\b${escapeRegex(latin)}\\b`, 'gi');
    result = result.replace(regex, (match) => {
      // Preserve case of first letter
      if (match[0] === match[0]!.toUpperCase() && match[0] !== match[0]!.toLowerCase()) {
        return cyrillic.charAt(0).toUpperCase() + cyrillic.slice(1);
      }
      return cyrillic;
    });
  }

  // Apply character-by-character transliteration
  let output = '';
  let i = 0;
  while (i < result.length) {
    let matched = false;

    // Try digraphs first (2-char)
    if (i + 1 < result.length) {
      const twoChar = result.slice(i, i + 2);
      for (const [latin, cyrillic] of digraphMap) {
        if (twoChar === latin) {
          output += cyrillic;
          i += 2;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      const oneChar = result[i];
      let charMapped = false;
      for (const [latin, cyrillic] of singleMap) {
        if (oneChar === latin) {
          output += cyrillic;
          charMapped = true;
          break;
        }
      }
      if (!charMapped) {
        output += oneChar;
      }
      i += 1;
    }
  }

  return output;
}

/**
 * Deep-transliterate all string values in a JSON-like object.
 * Keys are preserved as-is; only leaf string values are transliterated.
 */
export function transliterateObject<T>(obj: T): T {
  if (typeof obj === 'string') return transliterate(obj) as T;
  if (Array.isArray(obj)) return obj.map(transliterateObject) as T;
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = transliterateObject(value);
    }
    return result as T;
  }
  return obj;
}
