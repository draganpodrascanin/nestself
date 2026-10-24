/**
 * Unit tests for media processing pipeline: magic-byte sniffing, allowlist,
 * EXIF stripping, rendition generation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { LocalMediaStorage } from './storage/local-media-storage.js';
import { processMediaAsset } from './media-processing.js';

describe('media processing pipeline', () => {
  let baseDir: string;
  let storage: LocalMediaStorage;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'nestself-proc-test-'));
    storage = new LocalMediaStorage(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const quarantine = async (assetId: string, buffer: Buffer, contentType: string) => {
    const key = `quarantine/${assetId}/original`;
    await storage.put(key, Readable.from(buffer), { contentType, contentLength: buffer.length });
  };

  /** Create a minimal valid JPEG with EXIF GPS data using sharp. */
  async function createJpegWithExif(): Promise<Buffer> {
    // Create a test image
    const img = sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    });
    // Write EXIF with GPS data
    return img
      .withMetadata({
        exif: {
          IFD0: { Make: 'TestCamera' },
          IFD3: {
            GPSLatitude: '48/1 51/1 24/1',
            GPSLatitudeRef: 'N',
            GPSLongitude: '2/1 21/1 3/1',
            GPSLongitudeRef: 'E',
          },
        },
      })
      .jpeg()
      .toBuffer();
  }

  async function createPngBuffer(): Promise<Buffer> {
    return sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
  }

  async function createWebpBuffer(): Promise<Buffer> {
    return sharp({
      create: { width: 150, height: 150, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .webp()
      .toBuffer();
  }

  it('accepts a valid JPEG image and strips EXIF/GPS', async () => {
    const jpeg = await createJpegWithExif();
    await quarantine('asset-jpeg', jpeg, 'image/jpeg');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-jpeg',
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('ready');
    expect(result.rejectionCode).toBeNull();
    expect(result.renditions.length).toBe(5); // original, card_webp, card_jpeg, detail_webp, detail_jpeg
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    // Verify EXIF is stripped from original rendition
    const original = result.renditions.find((r) => r.kind === 'original')!;
    const { stream } = await storage.get(original.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const processedBuf = Buffer.concat(chunks);
    const metadata = await sharp(processedBuf).metadata();
    // Sharp's default behavior strips EXIF/ICC/GPS metadata (MED-R-10).
    // The processed output should have no EXIF block at all.
    expect(metadata.exif).toBeUndefined();
  });

  it('accepts a valid PNG image', async () => {
    const png = await createPngBuffer();
    await quarantine('asset-png', png, 'image/png');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-png',
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('ready');
    expect(result.renditions.length).toBe(5);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
  });

  it('accepts a valid WebP image', async () => {
    const webp = await createWebpBuffer();
    await quarantine('asset-webp', webp, 'image/webp');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-webp',
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('ready');
    expect(result.renditions.length).toBe(5);
  });

  it('rejects a PNG file declared as PDF (type mismatch)', async () => {
    const png = await createPngBuffer();
    await quarantine('asset-disguised', png, 'application/pdf');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-disguised',
      kind: 'pdf',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).toBe('type_mismatch');
  });

  it('rejects an SVG file renamed as PNG (not on allowlist)', async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const svgBuf = Buffer.from(svgContent);
    await quarantine('asset-svg', svgBuf, 'image/png');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-svg',
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).toBe('type_mismatch');
  });

  it('rejects an HTML file (not on allowlist)', async () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>hello</body></html>');
    await quarantine('asset-html', html, 'text/html');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-html',
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).toBe('type_mismatch');
  });

  it('rejects an executable (not on allowlist)', async () => {
    // ELF header
    const elfBuf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...Array(100).fill(0)]);
    await quarantine('asset-elf', elfBuf, 'application/octet-stream');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-elf',
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).toBe('type_mismatch');
  });

  it('accepts a valid PDF', async () => {
    // Minimal valid PDF
    const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';
    const pdfBuf = Buffer.from(pdfContent);
    await quarantine('asset-pdf', pdfBuf, 'application/pdf');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-pdf',
      kind: 'pdf',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('ready');
    expect(result.renditions.length).toBe(1);
    expect(result.renditions[0]!.kind).toBe('pdf');
    expect(result.scanStatus).toBe('not_scanned_local');
  });

  it('generates renditions with correct dimensions', async () => {
    // Create a 2000x1000 image (wide)
    const wide = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).jpeg().toBuffer();
    await quarantine('asset-wide', wide, 'image/jpeg');

    const result = await processMediaAsset(storage, {
      assetId: 'asset-wide',
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('ready');
    expect(result.width).toBe(2000);
    expect(result.height).toBe(1000);

    const cardWebp = result.renditions.find((r) => r.kind === 'card_webp')!;
    expect(cardWebp.width).toBe(640);
    expect(cardWebp.height).toBe(360); // 640 * 9/16

    const detailWebp = result.renditions.find((r) => r.kind === 'detail_webp')!;
    expect(detailWebp.width).toBe(1200);
  });
});
