#!/usr/bin/env node
// @ts-check
import { cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const distImages = join(pkgRoot, 'dist', 'images');
const targetDir = process.argv[2];

if (!targetDir) {
  console.error('Usage: sync-images.mjs <targetDir>');
  process.exit(1);
}

if (!existsSync(distImages)) {
  console.error('run "pnpm --filter @nestself/assets build" first');
  process.exit(1);
}

const dest = resolve(targetDir);
cpSync(distImages, dest, { recursive: true });
console.log(`Synced images to ${dest}`);
