/**
 * Unit tests for media processing pipeline: magic-byte sniffing, allowlist,
 * EXIF stripping, rendition generation, safety limits (I3).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
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

  /** Generate a random UUID for each test to avoid conflicts. */
  const nextId = () => randomUUID();

  const quarantine = async (assetId: string, buffer: Buffer, contentType: string) => {
    const key = `quarantine/${assetId}/original`;
    await storage.put(key, Readable.from(buffer), { contentType, contentLength: buffer.length });
  };

  /** Create a minimal valid JPEG with EXIF GPS data using sharp. */
  async function createJpegWithExif(): Promise<Buffer> {
    const img = sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    });
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
    const id = nextId();
    const jpeg = await createJpegWithExif();
    await quarantine(id, jpeg, 'image/jpeg');

    const result = await processMediaAsset(storage, {
      assetId: id,
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
    expect(metadata.exif).toBeUndefined();
  });

  it('accepts a valid PNG image', async () => {
    const id = nextId();
    const png = await createPngBuffer();
    await quarantine(id, png, 'image/png');

    const result = await processMediaAsset(storage, {
      assetId: id,
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
    const id = nextId();
    const webp = await createWebpBuffer();
    await quarantine(id, webp, 'image/webp');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('ready');
    expect(result.renditions.length).toBe(5);
  });

  it('rejects a PNG file declared as PDF (type mismatch)', async () => {
    const id = nextId();
    const png = await createPngBuffer();
    await quarantine(id, png, 'application/pdf');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'pdf',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).toBe('type_mismatch');
  });

  it('rejects an SVG file renamed as PNG (not on allowlist)', async () => {
    const id = nextId();
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const svgBuf = Buffer.from(svgContent);
    await quarantine(id, svgBuf, 'image/png');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).toBe('type_mismatch');
  });

  it('rejects an HTML file (not on allowlist)', async () => {
    const id = nextId();
    const html = Buffer.from('<!DOCTYPE html><html><body>hello</body></html>');
    await quarantine(id, html, 'text/html');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).toBe('type_mismatch');
  });

  it('rejects an executable (not on allowlist)', async () => {
    const id = nextId();
    const elfBuf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...Array(100).fill(0)]);
    await quarantine(id, elfBuf, 'application/octet-stream');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).toBe('type_mismatch');
  });

  it('accepts a valid PDF', async () => {
    const id = nextId();
    const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';
    const pdfBuf = Buffer.from(pdfContent);
    await quarantine(id, pdfBuf, 'application/pdf');

    const result = await processMediaAsset(storage, {
      assetId: id,
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
    const id = nextId();
    const wide = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).jpeg().toBuffer();
    await quarantine(id, wide, 'image/jpeg');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('ready');
    // Original is capped to MAX_ORIGINAL_LONG_EDGE (4096), but 2000 < 4096
    expect(result.width).toBe(2000);
    expect(result.height).toBe(1000);

    const cardWebp = result.renditions.find((r) => r.kind === 'card_webp')!;
    expect(cardWebp.width).toBe(640);
    expect(cardWebp.height).toBe(360); // 640 * 9/16

    const detailWebp = result.renditions.find((r) => r.kind === 'detail_webp')!;
    expect(detailWebp.width).toBe(1200);
  });

  // ── New tests from security review (I3) ──

  it('reprocessing a non-uploaded asset throws (I2)', async () => {
    const id = nextId();
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer();
    await quarantine(id, jpeg, 'image/jpeg');

    await expect(
      processMediaAsset(storage, {
        assetId: id,
        kind: 'image',
        currentState: 'ready',
        nodeEnv: 'development',
      }),
    ).rejects.toThrow('Cannot process asset');
  });

  it('caps original at 4096px long edge (I3)', async () => {
    const id = nextId();
    // Create a 5000x3000 image
    const big = await sharp({
      create: { width: 5000, height: 3000, channels: 3, background: { r: 50, g: 50, b: 50 } },
    }).jpeg().toBuffer();
    await quarantine(id, big, 'image/jpeg');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('ready');
    // Width should be capped to 4096 (long edge), height proportional
    expect(result.width).toBeLessThanOrEqual(4096);
    expect(result.height).toBeLessThanOrEqual(4096);
    // The long edge should be exactly 4096
    expect(Math.max(result.width!, result.height!)).toBe(4096);
  });

  it('truncated JPEG with valid magic bytes → rejected (I3)', async () => {
    const id = nextId();
    const full = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).jpeg().toBuffer();
    const truncated = full.subarray(0, Math.floor(full.length / 3));
    await quarantine(id, truncated, 'image/jpeg');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    // Should be rejected due to processing error, not stuck
    expect(result.newState).toBe('rejected');
    expect(result.rejectionCode).not.toBeNull();
  });

  it('JPEG polyglot (magic + HTML) → rejected (I3)', async () => {
    const id = nextId();
    const poly = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('<html><script>alert(1)</script></html>'),
    ]);
    await quarantine(id, poly, 'image/jpeg');

    const result = await processMediaAsset(storage, {
      assetId: id,
      kind: 'image',
      currentState: 'uploaded',
      nodeEnv: 'development',
    });

    expect(result.newState).toBe('rejected');
  });
});
