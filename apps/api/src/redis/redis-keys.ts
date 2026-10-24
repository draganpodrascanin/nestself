/**
 * Redis key patterns and TTL constants per Appendix I Part B.
 *
 * @see D-06, D-18, AUTH-R-11
 */

// ---------------------------------------------------------------------------
// TTL constants (seconds)
// ---------------------------------------------------------------------------

/** Session record: TTL = remaining absolute lifetime, set dynamically. */
export const SESSION_TTL_PLACEHOLDER = 0; // computed per session

/** Principal cache: 30 s +/- 5 s jitter. */
export const PRINCIPAL_TTL_BASE = 30;
export const PRINCIPAL_TTL_JITTER = 5;

/** Grants cache: 60 s +/- 10 s jitter. */
export const GRANTS_TTL_BASE = 60;
export const GRANTS_TTL_JITTER = 10;

/** Assignments cache: 60 s. */
export const ASSIGNMENTS_TTL = 60;

/** Org tree cache: 5 min. */
export const ORG_TREE_TTL = 300;

/** OTP record: 10 min. */
export const OTP_TTL = 600;

/** Challenge record: 5 min. */
export const CHALLENGE_TTL = 300;

/** PKCE state: 10 min. */
export const PKCE_TTL = 600;

/** WebSocket ticket: 30 s. */
export const WS_TICKET_TTL = 30;

/** SAML assertion replay cache: 10 min. */
export const SAML_ASSERTION_TTL = 600;

/** Revoked token family: 20 min. */
export const REVOKED_FAMILY_TTL = 1200;

/** Mobile family last-seen: 30 days. */
export const MOBILE_FAMILY_TTL = 30 * 24 * 3600;

/**
 * Denylist TTL for a family the nightly job revokes because it was not seen
 * for MOBILE_FAMILY_TTL (AUTHZ-R-64). The API never holds the device's refresh
 * token, so the denylist must outlive the longest mobile refresh token
 * (90 days, B.4) to be equivalent to revoking it.
 */
export const STALE_FAMILY_DENYLIST_TTL = 90 * 24 * 3600;

/**
 * Bearer step-up record (`stepUpKey(originJti)`): 30 min, the longest step-up
 * class maximum age (administration), after which it can no longer satisfy
 * any class.
 */
export const STEP_UP_BEARER_TTL = 1800;

/** Idempotency key: 24 h. */
export const IDEMPOTENCY_TTL = 86400;

/** Session lock: 5 s. */
export const SESSION_LOCK_TTL = 5;

// ---------------------------------------------------------------------------
// Key functions
// ---------------------------------------------------------------------------

/** `session:{sha256(sessionId)}` */
export function sessionKey(sessionIdHash: string): string {
  return `session:${sessionIdHash}`;
}

/** `user_sessions:{userId}` */
export function userSessionsKey(userId: string): string {
  return `user_sessions:${userId}`;
}

/** `principal:{userId}` */
export function principalKey(userId: string): string {
  return `principal:${userId}`;
}

/**
 * `grants:{userId}:{orgId}`: the subject's grants plus the delegation
 * ancestors of its delegated grants (other users' rows). An ancestor change
 * invalidates this entry through the delegatee's own `invalidateUser` call.
 */
export function grantsKey(userId: string, orgId: string): string {
  return `grants:${userId}:${orgId}`;
}

/** `assignments:{userId}` */
export function assignmentsKey(userId: string): string {
  return `assignments:${userId}`;
}

/** `org_tree:{orgId}` */
export function orgTreeKey(orgId: string): string {
  return `org_tree:${orgId}`;
}

/** `otp:{purpose}:{hash}` */
export function otpKey(purpose: string, hash: string): string {
  return `otp:${purpose}:${hash}`;
}

/** `challenge:{challengeToken}` */
export function challengeKey(challengeToken: string): string {
  return `challenge:${challengeToken}`;
}

/** `pkce:{state}` */
export function pkceKey(state: string): string {
  return `pkce:${state}`;
}

/** `ws_ticket:{hash}` */
export function wsTicketKey(hash: string): string {
  return `ws_ticket:${hash}`;
}

/** `saml_assertion:{assertionId}` */
export function samlAssertionKey(assertionId: string): string {
  return `saml_assertion:${assertionId}`;
}

/** `revoked_family:{originJti}` */
export function revokedFamilyKey(originJti: string): string {
  return `revoked_family:${originJti}`;
}

/** `mobile_family:{originJti}` */
export function mobileFamilyKey(originJti: string): string {
  return `mobile_family:${originJti}`;
}

/** `user_mobile_families:{userId}` */
export function userMobileFamiliesKey(userId: string): string {
  return `user_mobile_families:${userId}`;
}

/** `stepup:{originJti}` */
export function stepUpKey(originJti: string): string {
  return `stepup:${originJti}`;
}

/** `idempotency:{key}` */
export function idempotencyKey(key: string): string {
  return `idempotency:${key}`;
}

/** `throttle:{route}:{key}` */
export function throttleKey(route: string, key: string): string {
  return `throttle:${route}:${key}`;
}

/** `lock:session:{sessionIdHash}` — takes the already-hashed session id. */
export function sessionLockKey(sessionIdHash: string): string {
  return `lock:session:${sessionIdHash}`;
}

// ---------------------------------------------------------------------------
// Pub/sub channels
// ---------------------------------------------------------------------------

/** Channel name for cache invalidation messages. */
export const INVALIDATE_CHANNEL = 'invalidate';
