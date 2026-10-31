/**
 * LocalMediaStorage — filesystem-backed storage driver (MED-R-01, MED-R-26).
 *
 * Stores files under MEDIA_LOCAL_DIR. Refused when NODE_ENV=production.
 *
 * Key pattern: `^(quarantine|assets)/[0-9a-f-]{36}/[a-z0-9_]+$`
 * Any key that does not match is rejected before touching the filesystem.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, access, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type {
  MediaStorage,
  PutOptions,
  MediaStream,
  HeadResult,
  ByteRange,
} from './media-storage.js';

/** Only these key shapes are allowed — prevents traversal and injection. */
const SAFE_KEY_PATTERN = /^(quarantine|assets)\/[0-9a-f-]{36}\/[a-z0-9_]+$/;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  // Double-check: resolved path must stay inside baseDir (defence in depth).
  // The caller passes baseDir to filePath() which also checks.
}

export class LocalMediaStorage implements MediaStorage {
  private readonly resolvedBase: string;

  constructor(private readonly baseDir: string) {
    this.resolvedBase = resolve(baseDir);
  }

  private filePath(key: string): string {
    assertSafeKey(key);
    const fp = resolve(this.resolvedBase, key);
    // Defence-in-depth: even after the regex, verify containment
    const rel = relative(this.resolvedBase, fp);
    if (rel.startsWith('..') || resolve(this.resolvedBase, rel) !== fp) {
      throw new Error(`Storage key escapes base directory: ${key}`);
    }
    return fp;
  }

  async put(key: string, stream: Readable, opts: PutOptions): Promise<void> {
    const fp = this.filePath(key);
    await mkdir(dirname(fp), { recursive: true });
    const ws = createWriteStream(fp);
    await pipeline(stream, ws);
    // Store content type as a sidecar .meta file
    const metaPath = fp + '.meta';
    const meta = JSON.stringify({
      contentType: opts.contentType,
      contentLength: opts.contentLength,
    });
    await writeFile(metaPath, meta, 'utf-8');
  }

  async get(key: string, range?: ByteRange): Promise<MediaStream> {
    const fp = this.filePath(key);
    const stats = await stat(fp);
    const meta = await this.readMeta(fp);
    const totalSize = stats.size;

    if (range) {
      const start = range.start;
      const end = range.end !== undefined ? Math.min(range.end, totalSize - 1) : totalSize - 1;
      if (start >= totalSize || start < 0 || start > end) {
        throw new RangeError(`Unsatisfiable range: ${start}-${range.end ?? ''} / ${totalSize}`);
      }
      const stream = createReadStream(fp, { start, end });
      return {
        stream,
        contentType: meta.contentType,
        contentLength: end - start + 1,
        contentRange: `bytes ${start}-${end}/${totalSize}`,
      };
    }

    const stream = createReadStream(fp);
    return {
      stream,
      contentType: meta.contentType,
      contentLength: totalSize,
    };
  }

  async delete(key: string): Promise<void> {
    const fp = this.filePath(key);
    await unlink(fp).catch(() => {});
    await unlink(fp + '.meta').catch(() => {});
  }

  async exists(key: string): Promise<boolean> {
    const fp = this.filePath(key);
    try {
      await access(fp);
      return true;
    } catch {
      return false;
    }
  }

  async head(key: string): Promise<HeadResult> {
    const fp = this.filePath(key);
    const stats = await stat(fp);
    const meta = await this.readMeta(fp);
    return {
      contentLength: stats.size,
      contentType: meta.contentType,
      metadata: {},
    };
  }

  /** Local driver returns an empty tag map (MED-R-28). */
  async getTags(_key: string): Promise<Record<string, string>> {
    return {};
  }

  private async readMeta(filePath: string): Promise<{ contentType: string; contentLength: number }> {
    const metaPath = filePath + '.meta';
    try {
      const raw = await readFile(metaPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { contentType: 'application/octet-stream', contentLength: 0 };
    }
  }
}
