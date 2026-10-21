# @nestself/assets

Fonts, photographs, icons and the responsive image pipeline for NestSelf.

## Asset policy

- **Lifestyle photography only.** Stock people are never labelled as customers, experts or endorsers.
- **No attribution required.** The Pexels licence and generated images need no attribution. Photographer and source metadata stay in `photos.json` for provenance.
- **Focal points.** Each photo declares a normalised focal point (0..1) used for responsive crops. Preserve faces and gestures at every breakpoint.
- **No beige filter.** Photos are delivered as-is; no overlays, heavy colour grades or skin-tone manipulation.

## Adding a photo

1. Place the source JPEG in `photos/`.
2. Append an entry to `photos.json` with the key, Pexels ID, author, source URL, licence, dimensions (from `sips -g pixelWidth -g pixelHeight`), focal point and credit metadata.
3. Run `pnpm --filter @nestself/assets build` to generate responsive variants and crops.
4. Verify the entry in `photos.json` is complete (the data is kept for provenance).

## Fonts

Web fonts (woff2) are in `fonts/`. Native TTFs for React Native are in `fonts/native/` (Onest 2.001, OFL 1.1, three weights: Regular 400, SemiBold 600, Bold 700).

Import `fonts/fonts.css` for all `@font-face` declarations. Onest has three upright faces (400/600/700). Commissioner, Nunito Sans, Fira Sans and Lato each add an italic face.

## Image pipeline

`scripts/build-images.mjs` reads `photos.json` and produces responsive width variants and focal-point role crops in AVIF, WebP and JPEG under `dist/images/`. A `dist/manifest.json` records every generated file with its dimensions and byte size.

Flags: `--only <key>` processes a single photo; `--widths 480` limits width variants.

`scripts/sync-images.mjs <targetDir>` copies `dist/images/` to any directory (e.g. an app's `public/images`).

## Scripts

| Script | Purpose |
| --- | --- |
| `build-images.mjs` | Generate responsive variants and role crops |
| `sync-images.mjs` | Copy built images to a target directory |
