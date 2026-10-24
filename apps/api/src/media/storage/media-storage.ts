/**
 * MediaStorage interface — abstracts read, write and delete over local
 * filesystem or S3 (MED-R-01, MED-R-02, 8.1).
 */
import type { Readable } from 'node:stream';

export interface ByteRange {
  start: number;
  end?: number;
}

export interface PutOptions {
  contentType: string;
  contentLength: number;
  kmsKeyArn?: string;
}

export interface MediaStream {
  stream: Readable;
  contentType: string;
  contentLength: number;
  /** Present on range reads: `bytes start-end/total`. */
  contentRange?: string;
}

export interface HeadResult {
  contentLength: number;
  contentType: string;
  metadata: Record<string, string>;
}

export interface MediaStorage {
  put(key: string, stream: Readable, opts: PutOptions): Promise<void>;
  get(key: string, range?: ByteRange): Promise<MediaStream>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  head(key: string): Promise<HeadResult>;
  getTags(key: string): Promise<Record<string, string>>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
