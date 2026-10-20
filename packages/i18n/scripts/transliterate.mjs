#!/usr/bin/env node
/**
 * Transliterate Serbian Latin locale files to Cyrillic.
 *
 * Usage:
 *   node scripts/transliterate.mjs          # prints diff summary
 *   node scripts/transliterate.mjs --write  # writes sr-Cyrl/*.json from sr-Latn/*.json
 *   node scripts/transliterate.mjs --check  # exits 1 if committed Cyrillic differs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transliterateObject } from './transliterate-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, '..', 'locales');
const srLatnDir = join(localesDir, 'sr-Latn');
const srCyrlDir = join(localesDir, 'sr-Cyrl');

const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const checkMode = args.includes('--check');

if (!existsSync(srLatnDir)) {
  console.error('sr-Latn locale directory not found');
  process.exit(1);
}

const files = readdirSync(srLatnDir).filter((f) => f.endsWith('.json'));

if (files.length === 0) {
  console.error('No JSON files found in sr-Latn/');
  process.exit(1);
}

let hasChanges = false;

for (const file of files) {
  const latinPath = join(srLatnDir, file);
  const cyrlPath = join(srCyrlDir, file);

  const latinContent = JSON.parse(readFileSync(latinPath, 'utf-8'));
  const transliterated = transliterateObject(latinContent);
  const newContent = JSON.stringify(transliterated, null, 2) + '\n';

  if (writeMode) {
    if (!existsSync(srCyrlDir)) {
      mkdirSync(srCyrlDir, { recursive: true });
    }
    writeFileSync(cyrlPath, newContent, 'utf-8');
    console.log(`  wrote ${file}`);
  } else if (checkMode) {
    if (!existsSync(cyrlPath)) {
      console.error(`Missing: sr-Cyrl/${file}`);
      hasChanges = true;
      continue;
    }
    const existing = readFileSync(cyrlPath, 'utf-8');
    if (existing !== newContent) {
      console.error(`Mismatch: sr-Cyrl/${file} differs from fresh transliteration`);
      hasChanges = true;
    }
  } else {
    // Default: diff summary
    if (!existsSync(cyrlPath)) {
      console.log(`  ${file}: would create`);
      hasChanges = true;
    } else {
      const existing = readFileSync(cyrlPath, 'utf-8');
      if (existing !== newContent) {
        console.log(`  ${file}: would update`);
        hasChanges = true;
      } else {
        console.log(`  ${file}: up to date`);
      }
    }
  }
}

if (writeMode) {
  console.log('Cyrillic locales written.');
} else if (checkMode) {
  if (hasChanges) {
    console.error('Cyrillic locales are out of date. Run: pnpm --filter @nestself/i18n build:cyrillic');
    process.exit(1);
  } else {
    console.log('Cyrillic locales are up to date.');
  }
} else {
  if (!hasChanges) {
    console.log('All Cyrillic locales up to date.');
  }
}
