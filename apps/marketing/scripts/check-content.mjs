#!/usr/bin/env node
/**
 * Validate all marketing content files.
 *
 * Checks:
 * - en file exists for every slug/page
 * - sr-Latn and hu exist (error or warning with CONTENT_ALLOW_MISSING_LOCALES=1)
 * - sr-Cyrl matches a fresh transliteration of sr-Latn
 * - Every file validates against its schema
 * - Every `cover` key exists in @nestself/assets photos.json
 * - Every `related` slug exists
 *
 * Usage: node scripts/check-content.mjs
 * Env:   CONTENT_ALLOW_MISSING_LOCALES=1  to downgrade missing locale errors to warnings
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = join(__dirname, '..', 'content');

// Import schemas (Node 24 strips types)
const schemas = await import('../src/content/schemas.ts');
const { frontmatterSchemas, AssessmentSchema } = schemas;

// Import transliteration for checking sr-Cyrl freshness
const { transliterateFile, transliterateJsonContent } = await import(
  join(__dirname, 'transliterate-content.mjs')
);

// Try to load photos.json for cover validation
let photoKeys = new Set();
try {
  const photosPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'packages',
    'assets',
    'photos.json',
  );
  const photosRaw = await readFile(photosPath, 'utf-8');
  const photosData = JSON.parse(photosRaw);
  photoKeys = new Set(
    Array.isArray(photosData)
      ? photosData.map((p) => p.key ?? p.id ?? p.name)
      : Object.keys(photosData),
  );
} catch {
  // photos.json may not exist yet; skip cover validation
}

const allowMissing = process.env.CONTENT_ALLOW_MISSING_LOCALES === '1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const errors = [];
const warnings = [];
/** Track unique slugs per type for the summary. */
const slugSets = { articles: new Set(), webinars: new Set(), tools: new Set(), assessments: new Set(), pages: new Set() };

function error(msg) {
  errors.push(msg);
  console.error(`ERROR: ${msg}`);
}

function warn(msg) {
  warnings.push(msg);
  console.warn(`WARN: ${msg}`);
}

async function listDirs(dir) {
  try {
    const items = await readdir(dir, { withFileTypes: true });
    return items.filter((i) => i.isDirectory()).map((i) => i.name);
  } catch {
    return [];
  }
}

async function listFiles(dir) {
  try {
    const items = await readdir(dir, { withFileTypes: true });
    return items.filter((i) => i.isFile()).map((i) => i.name);
  } catch {
    return [];
  }
}

function checkLocales(files, ext, slug, type) {
  const localeFiles = files
    .filter((f) => f.endsWith(ext))
    .map((f) => f.replace(ext, ''));

  if (!localeFiles.includes('en')) {
    error(`${type}/${slug}: missing en${ext}`);
    return localeFiles;
  }

  for (const loc of ['sr-Latn', 'hu']) {
    if (!localeFiles.includes(loc)) {
      const msg = `${type}/${slug}: missing ${loc}${ext}`;
      if (allowMissing) {
        warn(msg);
      } else {
        error(msg);
      }
    }
  }

  return localeFiles;
}

// ---------------------------------------------------------------------------
// MDX content types (articles, webinars, tools)
// ---------------------------------------------------------------------------

const allSlugs = { articles: new Set(), webinars: new Set(), tools: new Set() };

for (const type of ['articles', 'webinars', 'tools']) {
  const typeDir = join(CONTENT_ROOT, type);
  const slugs = await listDirs(typeDir);

  for (const slug of slugs) {
    allSlugs[type].add(slug);
    const slugDir = join(typeDir, slug);
    const files = await listFiles(slugDir);
    const locales = checkLocales(files, '.mdx', slug, type);

    for (const loc of locales) {
      const filePath = join(slugDir, `${loc}.mdx`);
      try {
        const raw = await readFile(filePath, 'utf-8');
        const { data } = matter(raw);
        const schema = frontmatterSchemas[type];
        const result = schema.safeParse(data);
        if (!result.success) {
          const issues = result.error.issues
            .map((iss) => `${iss.path?.join('.') ?? '(root)'}: ${iss.message}`)
            .join('; ');
          error(`${type}/${slug}/${loc}.mdx: invalid frontmatter: ${issues}`);
        } else {
          slugSets[type].add(slug);
          // Check cover exists in photos.json
          if (photoKeys.size > 0 && result.data.cover && !photoKeys.has(result.data.cover)) {
            error(`${type}/${slug}/${loc}.mdx: cover "${result.data.cover}" not found in photos.json`);
          }
          // Check related slugs exist
          // related slugs validated after all slugs are collected
        }
      } catch (e) {
        error(`${type}/${slug}/${loc}.mdx: ${e.message}`);
      }
    }

    // Check sr-Cyrl freshness using transliterateFile (same logic as --write)
    if (locales.includes('sr-Latn') && locales.includes('sr-Cyrl')) {
      try {
        const latinPath = join(slugDir, 'sr-Latn.mdx');
        const cyrillicRaw = await readFile(join(slugDir, 'sr-Cyrl.mdx'), 'utf-8');
        const { output: expected } = await transliterateFile(latinPath);

        if (cyrillicRaw !== expected) {
          error(`${type}/${slug}/sr-Cyrl.mdx: stale transliteration (regenerate with content:cyrillic)`);
        }
      } catch (e) {
        error(`${type}/${slug}/sr-Cyrl.mdx: transliteration check failed: ${e.message}`);
      }
    }
  }
}

// Validate related slugs across articles
for (const type of ['articles', 'webinars', 'tools']) {
  const typeDir = join(CONTENT_ROOT, type);
  const slugs = await listDirs(typeDir);
  for (const slug of slugs) {
    const enFile = join(typeDir, slug, 'en.mdx');
    try {
      const raw = await readFile(enFile, 'utf-8');
      const { data } = matter(raw);
      if (data.related) {
        for (const relSlug of data.related) {
          if (!allSlugs.articles.has(relSlug)) {
            error(`${type}/${slug}/en.mdx: related slug "${relSlug}" does not exist in articles`);
          }
        }
      }
    } catch {
      // Already reported above if the file doesn't exist
    }
  }
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

const assessDir = join(CONTENT_ROOT, 'assessments');
const assessmentSlugs = await listDirs(assessDir);

for (const slug of assessmentSlugs) {
  const slugDir = join(assessDir, slug);
  const files = await listFiles(slugDir);
  const locales = checkLocales(files, '.json', slug, 'assessments');

  for (const loc of locales) {
    const filePath = join(slugDir, `${loc}.json`);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = AssessmentSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((iss) => `${iss.path?.join('.') ?? '(root)'}: ${iss.message}`)
          .join('; ');
        error(`assessments/${slug}/${loc}.json: invalid: ${issues}`);
      } else {
        slugSets.assessments.add(slug);
      }
    } catch (e) {
      error(`assessments/${slug}/${loc}.json: ${e.message}`);
    }
  }

  // Check sr-Cyrl freshness for JSON assessments
  if (locales.includes('sr-Latn') && locales.includes('sr-Cyrl')) {
    try {
      const latinRaw = await readFile(join(slugDir, 'sr-Latn.json'), 'utf-8');
      const cyrillicRaw = await readFile(join(slugDir, 'sr-Cyrl.json'), 'utf-8');
      const expected =
        JSON.stringify(transliterateJsonContent(JSON.parse(latinRaw)), null, 2) + '\n';
      if (cyrillicRaw !== expected) {
        error(`assessments/${slug}/sr-Cyrl.json: stale transliteration`);
      }
    } catch (e) {
      error(`assessments/${slug}: transliteration check: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const pagesDir = join(CONTENT_ROOT, 'pages');
const pageNames = await listDirs(pagesDir);

for (const page of pageNames) {
  const pageDir = join(pagesDir, page);
  const files = await listFiles(pageDir);
  const locales = checkLocales(files, '.json', page, 'pages');
  if (locales.length > 0) slugSets.pages.add(page);

  // sr-Cyrl freshness for page JSON
  if (locales.includes('sr-Latn') && locales.includes('sr-Cyrl')) {
    try {
      const latinRaw = await readFile(join(pageDir, 'sr-Latn.json'), 'utf-8');
      const cyrillicRaw = await readFile(join(pageDir, 'sr-Cyrl.json'), 'utf-8');
      const expected =
        JSON.stringify(transliterateJsonContent(JSON.parse(latinRaw)), null, 2) + '\n';
      if (cyrillicRaw !== expected) {
        error(`pages/${page}/sr-Cyrl.json: stale transliteration`);
      }
    } catch (e) {
      error(`pages/${page}: transliteration check: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(
  `\nContent check: ${slugSets.articles.size} articles, ${slugSets.webinars.size} webinars, ${slugSets.tools.size} tools, ${slugSets.assessments.size} assessments, ${slugSets.pages.size} pages.`,
);

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) found.`);
  process.exit(1);
} else {
  console.log('All checks passed.');
}
