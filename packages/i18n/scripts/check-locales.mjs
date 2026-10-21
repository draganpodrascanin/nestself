#!/usr/bin/env node
/**
 * Locale parity checker.
 * Fails (exit 1) when:
 *   - A key in `en` is missing in another locale, or vice versa
 *   - A value is an empty string
 *   - A plural group is incomplete for the locale's plural system
 *   - Committed sr-Cyrl differs from a fresh transliteration
 *   - A {{placeholder}} set differs between locales for the same key
 *
 * Prints "All 5 namespaces consistent across 4 locales." on success.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, '..', 'locales');

const localeNames = ['en', 'sr-Latn', 'sr-Cyrl', 'hu'];

const pluralSuffixesByLocale = {
  'sr-Latn': ['_one', '_few', '_other'],
  'sr-Cyrl': ['_one', '_few', '_other'],
  hu: ['_one', '_other'],
};

let errors = [];
let nsCount = 0;

/**
 * Flatten a nested object to dot-notation keys.
 */
function flattenKeys(obj, prefix = '') {
  const keys = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(keys, flattenKeys(value, fullKey));
    } else {
      keys[fullKey] = value;
    }
  }
  return keys;
}

/** All plural suffixes that any locale might use. */
const allPluralSuffixes = ['_one', '_few', '_other'];

/**
 * Returns true when `key` ends with a plural suffix that `locale` does not use.
 * English is the superset (it carries _few for Serbian), so keys ending in a
 * suffix that the target locale does not need are skipped in parity checks.
 */
function isPluralKeyIrrelevantFor(key, locale) {
  const localeSuffixes = pluralSuffixesByLocale[locale];
  if (!localeSuffixes) return false; // locale not in the map (e.g. en) — all keys relevant
  for (const suffix of allPluralSuffixes) {
    if (key.endsWith(suffix) && !localeSuffixes.includes(suffix)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract {{placeholder}} names from a string.
 */
function extractPlaceholders(value) {
  if (typeof value !== 'string') return new Set();
  const matches = value.match(/\{\{([^}]+)\}\}/g) || [];
  return new Set(matches.map((m) => m.slice(2, -2)));
}

// Get all namespace files from the English locale as the reference
const enDir = join(localesDir, 'en');
if (!existsSync(enDir)) {
  console.error('English locale directory not found');
  process.exit(1);
}

const nsFiles = readdirSync(enDir).filter((f) => f.endsWith('.json'));

for (const nsFile of nsFiles) {
  const ns = nsFile.replace('.json', '');
  nsCount++;

  // Load all locale files for this namespace
  const localeData = {};

  for (const locale of localeNames) {
    const filePath = join(localesDir, locale, nsFile);
    if (!existsSync(filePath)) {
      errors.push(`Missing file: ${locale}/${nsFile}`);
      continue;
    }
    try {
      localeData[locale] = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      errors.push(`Invalid JSON: ${locale}/${nsFile}: ${e.message}`);
    }
  }

  // Flatten keys for each locale
  const flatData = {};
  for (const [locale, data] of Object.entries(localeData)) {
    flatData[locale] = flattenKeys(data);
  }

  const enFlat = flatData['en'];
  if (!enFlat) continue;

  const enKeys = new Set(Object.keys(enFlat));

  for (const locale of localeNames) {
    if (locale === 'en') continue;
    const flat = flatData[locale];
    if (!flat) continue;

    const localeKeys = new Set(Object.keys(flat));

    // Keys in en but missing in this locale (skip plural suffixes the locale does not use)
    for (const key of enKeys) {
      if (isPluralKeyIrrelevantFor(key, locale)) continue;
      if (!localeKeys.has(key)) {
        errors.push(`${ns}: key "${key}" is in en but missing in ${locale}`);
      }
    }

    // Keys in this locale but missing in en (skip plural suffixes en does not use)
    for (const key of localeKeys) {
      if (isPluralKeyIrrelevantFor(key, 'en')) continue;
      if (!enKeys.has(key)) {
        errors.push(`${ns}: key "${key}" is in ${locale} but missing in en`);
      }
    }

    // Check empty values
    for (const [key, value] of Object.entries(flat)) {
      if (value === '') {
        errors.push(`${ns}: empty value for "${key}" in ${locale}`);
      }
    }

    // Check placeholder parity (skip plural keys irrelevant for this locale)
    for (const key of enKeys) {
      if (isPluralKeyIrrelevantFor(key, locale)) continue;
      if (!flat[key]) continue;
      const enPlaceholders = extractPlaceholders(enFlat[key]);
      const localePlaceholders = extractPlaceholders(flat[key]);

      const enSet = [...enPlaceholders].sort().join(',');
      const localeSet = [...localePlaceholders].sort().join(',');

      if (enSet !== localeSet) {
        errors.push(
          `${ns}: placeholder mismatch for "${key}" — en has {${enSet}}, ${locale} has {${localeSet}}`,
        );
      }
    }
  }

  // Check empty values in en
  for (const [key, value] of Object.entries(enFlat)) {
    if (value === '') {
      errors.push(`${ns}: empty value for "${key}" in en`);
    }
  }

  // Check plural groups per locale
  for (const [locale, suffixes] of Object.entries(pluralSuffixesByLocale)) {
    const flat = flatData[locale];
    if (!flat) continue;

    // Find all keys ending with a plural suffix
    const pluralRoots = new Set();
    for (const key of Object.keys(flat)) {
      for (const suffix of suffixes) {
        if (key.endsWith(suffix)) {
          pluralRoots.add(key.slice(0, -suffix.length));
          break;
        }
      }
    }

    for (const root of pluralRoots) {
      for (const suffix of suffixes) {
        const fullKey = `${root}${suffix}`;
        if (!flat[fullKey]) {
          errors.push(`${ns}: incomplete plural group "${root}" in ${locale} — missing "${fullKey}"`);
        }
      }
    }
  }
}

// Check Cyrillic consistency with transliteration
try {
  execFileSync('node', ['scripts/transliterate.mjs', '--check'], {
    cwd: join(__dirname, '..'),
    stdio: 'pipe',
  });
} catch (e) {
  const stderr = e.stderr ? e.stderr.toString().trim() : '';
  const stdout = e.stdout ? e.stdout.toString().trim() : '';
  errors.push(`Cyrillic transliteration check failed: ${stderr || stdout}`);
}

if (errors.length > 0) {
  console.error('Locale check failed:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log(`All ${nsCount} namespaces consistent across ${localeNames.length} locales.`);
}
