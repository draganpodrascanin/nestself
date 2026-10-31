/** Metadata shared by the decorator and the interceptor. */
export const IDEMPOTENT_KEY = 'idempotent';

export interface IdempotentMetadata {
  scope: string;
  required: boolean;
  /** Override the in-flight reservation TTL in seconds (default 60). */
  inFlightTtlSeconds?: number;
  /**
   * Header names (lowercase) whose values are included in the request
   * fingerprint.  For the media upload route the `content-digest` header
   * ties the idempotency key to the exact payload without buffering the
   * body for hashing.
   */
  fingerprintHeaders?: string[];
}
