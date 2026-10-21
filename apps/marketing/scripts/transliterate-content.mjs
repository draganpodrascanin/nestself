#!/usr/bin/env node
/**
 * Transliterate sr-Latn content files to sr-Cyrl.
 *
 * Usage:
 *   node scripts/transliterate-content.mjs --write   # overwrite sr-Cyrl files
 *   node scripts/transliterate-content.mjs --check   # exit 1 if any file is stale
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { transliterate, transliterateObject } = await import(
  join(__dirname, '..', '..', '..', 'packages', 'i18n', 'scripts', 'transliterate-core.mjs')
);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONTENT_ROOT = process.env.__TRANSLITERATE_CONTENT_ROOT || join(__dirname, '..', 'content');

/** Frontmatter keys whose string values should be transliterated in MDX files. */
const MDX_TRANSLITERATE_KEYS = new Set(['title', 'description', 'coverAlt', 'author']);

/** Nested frontmatter paths that should be transliterated (dot-separated). */
const MDX_TRANSLITERATE_NESTED = [{ parent: 'speaker', key: 'role' }];

/** JSON keys that must NOT be transliterated. */
const JSON_UNTOUCHED_KEYS = new Set([
  'cover',
  'slug',
  'id',
  'href',
  'url',
  'source',
  'icon',
  'key',
  'locale',
  'topic',
  'format',
  'kind',
  'method',
]);

// ---------------------------------------------------------------------------
// MDX body transliteration with protection
// ---------------------------------------------------------------------------

/**
 * Transliterate MDX body text, protecting:
 * - Fenced code blocks (``` ... ```)
 * - Inline code (`...`)
 * - Link/image destinations in ](...)
 * - Autolinks <http://...>
 * - HTML/JSX tags and their attributes
 * - import/export lines
 */
export function transliterateMdxBody(body) {
  const protected_ = [];
  let idx = 0;

  function protect(match) {
    // Use Unicode private-use-area characters to avoid transliteration
    const placeholder = `￰${idx}￱`;
    protected_.push({ placeholder, value: match });
    idx++;
    return placeholder;
  }

  let result = body;

  // Protect fenced code blocks
  result = result.replace(/```[\s\S]*?```/g, protect);

  // Protect inline code
  result = result.replace(/`[^`\n]+`/g, protect);

  // Protect import/export lines
  result = result.replace(/^(import|export)\s.*$/gm, protect);

  // Protect HTML/JSX tags (including self-closing and with attributes)
  result = result.replace(/<\/?[A-Za-z][A-Za-z0-9]*(?:\s[^>]*)?\/?>/g, protect);

  // Protect link/image destinations: ](url) and ![alt](url)
  result = result.replace(/\]\([^)]*\)/g, protect);

  // Protect autolinks
  result = result.replace(/<https?:\/\/[^>]+>/g, protect);

  // Transliterate the remaining text
  result = transliterate(result);

  // Restore protected segments
  for (const { placeholder, value } of protected_) {
    result = result.replace(placeholder, value);
  }

  return result;
}

/**
 * Transliterate selected frontmatter keys.
 */
function transliterateFrontmatter(data) {
  const result = { ...data };
  for (const key of MDX_TRANSLITERATE_KEYS) {
    if (typeof result[key] === 'string') {
      result[key] = transliterate(result[key]);
    }
  }
  for (const { parent, key } of MDX_TRANSLITERATE_NESTED) {
    if (result[parent] && typeof result[parent][key] === 'string') {
      result[parent] = { ...result[parent], [key]: transliterate(result[parent][key]) };
    }
  }
  return result;
}

/**
 * Transliterate a JSON content object, wrapping transliterateObject from
 * @nestself/i18n with untouched-key filtering and URL-string preservation.
 */
/** Keys whose values are machine codes only when they are arrays (e.g. webinar languages ['sr', 'hu']). */
const ARRAY_ONLY_UNTOUCHED_KEYS = new Set(['languages']);

/** URL, domain and {{placeholder}} tokens that must survive transliteration inside prose. */
const PROSE_PROTECTED =
  /(https?:\/\/\S+|www\.\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:rs|hu|com|org|net|eu|int|dk|io|gov|edu)\b|\{\{[^}]+\}\})/g;

export function transliterateText(text) {
  return text
    .split(PROSE_PROTECTED)
    .map((part, index) => (index % 2 === 1 ? part : transliterateObject(part)))
    .join('');
}

export function transliterateJsonContent(obj) {
  if (typeof obj === 'string') {
    if (/^https?:\/\//.test(obj)) return obj;
    return transliterateText(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(transliterateJsonContent);
  }
  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const untouched =
        (JSON_UNTOUCHED_KEYS.has(key) && !ARRAY_ONLY_UNTOUCHED_KEYS.has(key)) ||
        (ARRAY_ONLY_UNTOUCHED_KEYS.has(key) && Array.isArray(value));
      result[key] = untouched ? value : transliterateJsonContent(value);
    }
    return result;
  }
  return transliterateObject(obj);
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

async function walk(dir) {
  const entries = [];
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...(await walk(full)));
    } else if (item.name === 'sr-Latn.mdx' || item.name === 'sr-Latn.json') {
      entries.push(full);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export async function transliterateFile(latinPath) {
  const ext = latinPath.endsWith('.mdx') ? '.mdx' : '.json';
  const cyrillicPath = latinPath.replace(/sr-Latn(\.\w+)$/, `sr-Cyrl$1`);
  const raw = await readFile(latinPath, 'utf-8');

  let output;
  if (ext === '.mdx') {
    const { data, content } = matter(raw);
    const newData = transliterateFrontmatter(data);
    const newBody = transliterateMdxBody(content);
    output = matter.stringify(newBody, newData);
  } else {
    const parsed = JSON.parse(raw);
    const transliterated = transliterateJsonContent(parsed);
    output = JSON.stringify(transliterated, null, 2) + '\n';
  }

  return { cyrillicPath, output };
}

async function run() {
  const mode = process.argv.includes('--check') ? 'check' : 'write';
  const files = await walk(CONTENT_ROOT);

  if (files.length === 0) {
    console.log('No sr-Latn content files found.');
    return;
  }

  let stale = 0;
  let written = 0;

  for (const latinPath of files) {
    const { cyrillicPath, output } = await transliterateFile(latinPath);
    const rel = relative(CONTENT_ROOT, cyrillicPath);

    if (mode === 'check') {
      let existing = '';
      try {
        existing = await readFile(cyrillicPath, 'utf-8');
      } catch {
        // File does not exist
      }
      if (existing !== output) {
        console.error(`STALE: ${rel}`);
        stale++;
      }
    } else {
      await mkdir(dirname(cyrillicPath), { recursive: true });
      await writeFile(cyrillicPath, output, 'utf-8');
      written++;
      console.log(`Written: ${rel}`);
    }
  }

  if (mode === 'check' && stale > 0) {
    console.error(
      `\n${stale} file(s) are stale. Run: pnpm --filter @nestself/marketing content:cyrillic`,
    );
    process.exit(1);
  }

  if (mode === 'write') {
    console.log(`\nTransliterated ${written} file(s).`);
  }
}

// Allow running as a script or importing for tests
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
