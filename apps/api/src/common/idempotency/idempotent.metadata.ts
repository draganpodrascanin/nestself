/** Metadata shared by the decorator and the interceptor. */
export const IDEMPOTENT_KEY = 'idempotent';

export interface IdempotentMetadata {
  scope: string;
  required: boolean;
  /** Override the in-flight reservation TTL in seconds (default 60). */
  inFlightTtlSeconds?: number;
}
