/**
 * Unit tests for LocalMediaStorage driver.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { LocalMediaStorage } from './local-media-storage.js';

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
    await putFile('test/file.txt', 'hello world');

    const { stream, contentType, contentLength } = await storage.get('test/file.txt');
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
    await putFile('test/range.txt', 'abcdefghij');

    const { stream, contentLength, contentRange } = await storage.get('test/range.txt', { start: 2, end: 5 });
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
    await putFile('test/open.txt', 'abcdefghij');

    const { stream, contentLength, contentRange } = await storage.get('test/open.txt', { start: 7 });
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
    await putFile('test/unsatisfiable.txt', 'short');

    await expect(
      storage.get('test/unsatisfiable.txt', { start: 100 }),
    ).rejects.toThrow(RangeError);
  });

  it('head returns metadata without body', async () => {
    await putFile('test/head.txt', 'test content', 'text/html');

    const result = await storage.head('test/head.txt');
    expect(result.contentLength).toBe(12);
    expect(result.contentType).toBe('text/html');
    expect(result.metadata).toEqual({});
  });

  it('getTags returns empty map', async () => {
    await putFile('test/tags.txt', 'content');
    const tags = await storage.getTags('test/tags.txt');
    expect(tags).toEqual({});
  });

  it('exists returns true for existing files', async () => {
    await putFile('test/exists.txt', 'content');
    expect(await storage.exists('test/exists.txt')).toBe(true);
  });

  it('exists returns false for non-existing files', async () => {
    expect(await storage.exists('test/nope.txt')).toBe(false);
  });

  it('delete removes the file and meta', async () => {
    await putFile('test/del.txt', 'content');
    expect(await storage.exists('test/del.txt')).toBe(true);
    await storage.delete('test/del.txt');
    expect(await storage.exists('test/del.txt')).toBe(false);
  });

  it('delete of non-existent file does not throw', async () => {
    await expect(storage.delete('test/missing.txt')).resolves.not.toThrow();
  });
});
