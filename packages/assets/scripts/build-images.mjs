#!/usr/bin/env node
// @ts-check
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const photosPath = join(pkgRoot, 'photos.json');
const photosDir = join(pkgRoot, 'photos');
const outBase = process.env.NESTSELF_IMAGES_OUT || join(pkgRoot, 'dist', 'images');

const RESPONSIVE_WIDTHS = [480, 768, 1024, 1280, 1600];
const IMAGE_FORMATS = ['avif', 'webp', 'jpg'];
const CROP_SPECS = {
  'hero-3x2': { width: 1600, height: 1067, targetKB: 200, aspectRatio: '3:2' },
  'hero-4x5': { width: 800, height: 1000, targetKB: 200, aspectRatio: '4:5' },
  portrait: { width: 800, height: 1000, targetKB: 150, aspectRatio: '4:5' },
  card: { width: 800, height: 450, targetKB: 80, aspectRatio: '16:9' },
  avatar: { width: 320, height: 320, targetKB: 35, aspectRatio: '1:1' },
  article: { width: 1200, height: 675, targetKB: 120, aspectRatio: '16:9' },
};

const ENCODE_OPTS = {
  avif: { quality: 50, effort: 4 },
  webp: { quality: 72 },
  jpg: { quality: 78, mozjpeg: true },
};

// Parse CLI flags
const args = process.argv.slice(2);
let onlyKey = null;
let onlyWidths = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only' && args[i + 1]) { onlyKey = args[++i]; }
  if (args[i] === '--widths' && args[i + 1]) { onlyWidths = args[++i].split(',').map(Number); }
}

/** @param {sharp.Sharp} pipeline @param {string} format @param {number} quality */
function encode(pipeline, format, quality) {
  if (format === 'avif') return pipeline.avif({ ...ENCODE_OPTS.avif, quality });
  if (format === 'webp') return pipeline.webp({ ...ENCODE_OPTS.webp, quality });
  return pipeline.jpeg({ ...ENCODE_OPTS.jpg, quality, mozjpeg: true });
}

/**
 * Focal-point crop: extract a region of the target aspect ratio centred on the focal point, clamped to bounds.
 * @param {number} srcW @param {number} srcH @param {number} tgtW @param {number} tgtH
 * @param {{ x: number; y: number }} focal
 */
function focalExtract(srcW, srcH, tgtW, tgtH, focal) {
  const tgtAspect = tgtW / tgtH;
  const srcAspect = srcW / srcH;
  let cropW, cropH;
  if (srcAspect > tgtAspect) {
    cropH = srcH;
    cropW = Math.round(srcH * tgtAspect);
  } else {
    cropW = srcW;
    cropH = Math.round(srcW / tgtAspect);
  }
  cropW = Math.min(cropW, srcW);
  cropH = Math.min(cropH, srcH);

  const cx = Math.round(focal.x * srcW);
  const cy = Math.round(focal.y * srcH);
  let left = Math.round(cx - cropW / 2);
  let top = Math.round(cy - cropH / 2);
  left = Math.max(0, Math.min(left, srcW - cropW));
  top = Math.max(0, Math.min(top, srcH - cropH));
  return { left, top, width: cropW, height: cropH };
}

async function main() {
  const photos = JSON.parse(readFileSync(photosPath, 'utf8'));
  const filtered = onlyKey ? photos.filter((p) => p.key === onlyKey) : photos;
  if (filtered.length === 0) {
    console.error(`No photo matching --only ${onlyKey}`);
    process.exit(1);
  }

  const widths = onlyWidths || RESPONSIVE_WIDTHS;
  const manifest = { generated: new Date().toISOString(), photos: [] };

  for (const photo of filtered) {
    const srcPath = join(photosDir, `${photo.key}.jpg`);
    const outDir = join(outBase, photo.key);
    mkdirSync(outDir, { recursive: true });

    const variants = [];
    const crops = [];

    // Responsive width variants
    const applicableWidths = widths.filter((w) => w <= photo.width);
    for (const w of applicableWidths) {
      for (const fmt of IMAGE_FORMATS) {
        const fname = `${photo.key}-${w}.${fmt}`;
        const outPath = join(outDir, fname);
        const quality = ENCODE_OPTS[fmt].quality;
        const pipeline = sharp(srcPath).resize(w, undefined, { fit: 'inside', withoutEnlargement: true });
        const buf = await encode(pipeline, fmt, quality).toBuffer();
        writeFileSync(outPath, buf);
        const meta = await sharp(buf).metadata();
        variants.push({ width: meta.width, height: meta.height, format: fmt, path: `${photo.key}/${fname}`, bytes: buf.length });
      }
    }

    // Role crops
    for (const [role, spec] of Object.entries(CROP_SPECS)) {
      for (const fmt of IMAGE_FORMATS) {
        const fname = `${photo.key}-${role}.${fmt}`;
        const outPath = join(outDir, fname);
        const extract = focalExtract(photo.width, photo.height, spec.width, spec.height, photo.focalPoint);
        let quality = ENCODE_OPTS[fmt].quality;
        let buf;

        for (let pass = 0; pass < 4; pass++) {
          const pipeline = sharp(srcPath)
            .extract(extract)
            .resize(spec.width, spec.height, { fit: 'inside', withoutEnlargement: true });
          buf = await encode(pipeline, fmt, quality).toBuffer();
          const sizeKB = buf.length / 1024;
          if (sizeKB <= spec.targetKB || pass >= 3) break;
          const ratio = Math.sqrt(spec.targetKB / sizeKB);
          quality = Math.max(35, Math.round(quality * ratio));
        }

        writeFileSync(outPath, buf);
        const meta = await sharp(buf).metadata();
        crops.push({ role, format: fmt, width: meta.width, height: meta.height, path: `${photo.key}/${fname}`, bytes: buf.length });
      }
    }

    manifest.photos.push({ key: photo.key, variants, crops });
    console.log(`${photo.key}: ${variants.length} variants, ${crops.length / IMAGE_FORMATS.length} crops`);
  }

  // Write manifest
  const manifestDir = process.env.NESTSELF_IMAGES_OUT || join(pkgRoot, 'dist');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest written');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
