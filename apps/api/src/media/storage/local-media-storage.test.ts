/**
 * Unit tests for LocalMediaStorage driver.
 *
 * Keys must match the safe pattern: (quarantine|assets)/<uuid>/<kind>
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { LocalMediaStorage } from './local-media-storage.js';

/** A valid UUID for test keys. */
const UUID = '00000000-0000-0000-0000-000000000001';

describe('LocalMediaStorage', () => {
  let baseDir: string;
  let storage: LocalMediaStorage;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'nestself-media-test-'));
    storage = new LocalMediaStorage(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const putFile = async (key: string, content: string, contentType = 'text/plain') => {
    const buf = Buffer.from(content);
    await storage.put(key, Readable.from(buf), {
      contentType,
      contentLength: buf.length,
    });
  };

  it('put and get round-trip', async () => {
    const key = `quarantine/${UUID}/original`;
    await putFile(key, 'hello world');

    const { stream, contentType, contentLength } = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks).toString();

    expect(data).toBe('hello world');
    expect(contentType).toBe('text/plain');
    expect(contentLength).toBe(11);
  });

  it('get with range returns partial content', async () => {
    const key = `assets/${UUID}/original`;
    await putFile(key, 'abcdefghij');

    const { stream, contentLength, contentRange } = await storage.get(key, { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks).toString();

    expect(data).toBe('cdef');
    expect(contentLength).toBe(4);
    expect(contentRange).toBe('bytes 2-5/10');
  });

  it('get with open-ended range returns to end of file', async () => {
    const key = `assets/${UUID}/card_webp`;
    await putFile(key, 'abcdefghij');

    const { stream, contentLength, contentRange } = await storage.get(key, { start: 7 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks).toString();

    expect(data).toBe('hij');
    expect(contentLength).toBe(3);
    expect(contentRange).toBe('bytes 7-9/10');
  });

  it('get with unsatisfiable range throws RangeError', async () => {
    const key = `assets/${UUID}/original`;
    await putFile(key, 'short');

    await expect(
      storage.get(key, { start: 100 }),
    ).rejects.toThrow(RangeError);
  });

  it('head returns metadata without body', async () => {
    const key = `quarantine/${UUID}/original`;
    await putFile(key, 'test content', 'text/html');

    const result = await storage.head(key);
    expect(result.contentLength).toBe(12);
    expect(result.contentType).toBe('text/html');
    expect(result.metadata).toEqual({});
  });

  it('getTags returns empty map', async () => {
    const key = `assets/${UUID}/original`;
    await putFile(key, 'content');
    const tags = await storage.getTags(key);
    expect(tags).toEqual({});
  });

  it('exists returns true for existing files', async () => {
    const key = `assets/${UUID}/original`;
    await putFile(key, 'content');
    expect(await storage.exists(key)).toBe(true);
  });

  it('exists returns false for non-existing files', async () => {
    expect(await storage.exists(`assets/${UUID}/original`)).toBe(false);
  });

  it('delete removes the file and meta', async () => {
    const key = `quarantine/${UUID}/original`;
    await putFile(key, 'content');
    expect(await storage.exists(key)).toBe(true);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('delete of non-existent file does not throw', async () => {
    await expect(storage.delete(`quarantine/${UUID}/original`)).resolves.not.toThrow();
  });

  // ── Path containment tests (M11) ──

  it('rejects key with path traversal (../)', async () => {
    await expect(
      storage.get(`quarantine/../../../etc/passwd`),
    ).rejects.toThrow('Invalid storage key');
  });

  it('rejects key with NUL byte', async () => {
    await expect(
      storage.head(`assets/${UUID}/orig\u0000inal`),
    ).rejects.toThrow('Invalid storage key');
  });

  it('rejects key outside known prefixes', async () => {
    await expect(
      storage.get(`secrets/${UUID}/original`),
    ).rejects.toThrow('Invalid storage key');
  });

  it('rejects absolute-ish key', async () => {
    await expect(
      storage.exists(`/../../../etc/passwd`),
    ).rejects.toThrow('Invalid storage key');
  });
});
