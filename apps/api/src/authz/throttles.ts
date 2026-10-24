/**
 * Per-route throttles for access-administration writes (API-R-22): grant,
 * approval-authority and emergency-access writes allow 10 per minute.
 */
export const WRITE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
