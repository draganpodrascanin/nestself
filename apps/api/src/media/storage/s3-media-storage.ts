/**
 * S3MediaStorage — placeholder for the S3 driver (T-C2.09, MED-R-02).
 *
 * The interface is fixed now. The implementation throws at construction when
 * MEDIA_STORAGE=s3 is selected, making it clear that S3 support is deferred.
 */
import type { Readable } from 'node:stream';
import type {
  MediaStorage,
  PutOptions,
  MediaStream,
  HeadResult,
  ByteRange,
} from './media-storage.js';

export class S3MediaStorage implements MediaStorage {
  constructor() {
    throw new Error(
      'S3 media storage is not available until T-C2.09. ' +
      'Use MEDIA_STORAGE=local for development.',
    );
  }

  put(_key: string, _stream: Readable, _opts: PutOptions): Promise<void> {
    throw new Error('Not implemented: T-C2.09');
  }

  get(_key: string, _range?: ByteRange): Promise<MediaStream> {
    throw new Error('Not implemented: T-C2.09');
  }

  delete(_key: string): Promise<void> {
    throw new Error('Not implemented: T-C2.09');
  }

  exists(_key: string): Promise<boolean> {
    throw new Error('Not implemented: T-C2.09');
  }

  head(_key: string): Promise<HeadResult> {
    throw new Error('Not implemented: T-C2.09');
  }

  getTags(_key: string): Promise<Record<string, string>> {
    throw new Error('Not implemented: T-C2.09');
  }
}
