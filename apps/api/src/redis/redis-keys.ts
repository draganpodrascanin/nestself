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

/**
 * Time between two NestSelf-sent codes on one challenge: a resend is refused
 * for this long after the last code went out (`otpResendKey`).
 */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Challenge record: 5 min. */
export const CHALLENGE_TTL = 300;

/** PKCE state: 10 min. */
export const PKCE_TTL = 600;

/** Single-use staff test sign-in of a TESTING SSO connection (`sso_test:{nonce}`). */
export const SSO_TEST_TTL = 900;

/**
 * Pending federated binding after an unverified OIDC email (`ssoPendingBindKey`):
 * 15 min, so a user whose code (`CHALLENGE_TTL`) expired asks for a new one
 * without signing in at the identity provider again.
 */
export const SSO_PENDING_BIND_TTL = 900;

/**
 * A refused federated bearer's `auth.sign_in.failed` row: one per connection
 * and pool user in 10 min (`bearerMismatchAuditedKey`). Later refusals in
 * the window are refused without a row.
 */
export const BEARER_MISMATCH_AUDIT_TTL = 600;

/**
 * SSO signing-certificate expiry alert to `OPS_ALERT_EMAIL`: at most one
 * mail per connection in 7 days (`ssoCertAlertKey`). The nightly job audits
 * and logs an expiring certificate every night regardless.
 */
export const SSO_CERT_ALERT_TTL = 7 * 24 * 3600;

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

/** In-flight reservation of an idempotency key: 60 s. */
export const IDEMPOTENCY_IN_FLIGHT_TTL = 60;

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

/**
 * `otp:{purpose}:{hash}`: a code challenge issued by NestSelf (`NestselfOtpService`).
 * `hash` is the sha256 of the challenge token; the record lives for `CHALLENGE_TTL`.
 */
export function otpKey(purpose: string, hash: string): string {
  return `otp:${purpose}:${hash}`;
}

/**
 * `otp_resend:{purpose}:{hash}`: exists while a resend of the code of that
 * challenge is refused. `hash` is the one of the challenge's `otpKey`.
 */
export function otpResendKey(purpose: string, hash: string): string {
  return `otp_resend:${purpose}:${hash}`;
}

/** `challenge:{challengeToken}` */
export function challengeKey(challengeToken: string): string {
  return `challenge:${challengeToken}`;
}

/** `pkce:{state}` */
export function pkceKey(state: string): string {
  return `pkce:${state}`;
}

/** `sso_test:{nonce}` -> `{ connectionId }`, issued by `POST /ops/sso-connections/:id/test`. */
export function ssoTestKey(nonce: string): string {
  return `sso_test:${nonce}`;
}

/**
 * `sso_pending_bind:{hash}`: a federated sign-in waiting for the user to
 * confirm the address with a code (`PendingBindStore`). `hash` is the sha256
 * of the handle on the sign-in URL; the store never holds the handle.
 */
export function ssoPendingBindKey(hash: string): string {
  return `sso_pending_bind:${hash}`;
}

/**
 * `sso_bind_start:{hash}`: exists for `OTP_RESEND_COOLDOWN_SECONDS` after a
 * code went out for the pending binding `sso_pending_bind:{hash}`; until it
 * expires, another `bind/start` for that binding is refused.
 */
export function ssoBindStartKey(hash: string): string {
  return `sso_bind_start:${hash}`;
}

/**
 * `bearer_mismatch_audited:{connectionId}:{subHash}`: the bearer of this pool
 * user (`subHash`: sha256 hex of the access token's `sub`) was refused for
 * this connection and audited; for `BEARER_MISMATCH_AUDIT_TTL` further
 * refusals write no row.
 */
export function bearerMismatchAuditedKey(connectionId: string, subHash: string): string {
  return `bearer_mismatch_audited:${connectionId}:${subHash}`;
}

/**
 * `sso_cert_alert:{connectionId}`: the certificate-expiry alert for this SSO
 * connection was mailed; while the key lives (`SSO_CERT_ALERT_TTL`) the
 * nightly job mails no other. Deleted again when the mail could not be sent.
 */
export function ssoCertAlertKey(connectionId: string): string {
  return `sso_cert_alert:${connectionId}`;
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

/**
 * `idempotency:{scope}:{userId}:{key}`. The scope separates unrelated
 * endpoints; the user id keeps one user's key from ever matching another's.
 */
export function idempotencyKey(scope: string, userId: string, key: string): string {
  return `idempotency:${scope}:${userId}:${key}`;
}

/** `throttle:{route}:{key}` */
export function throttleKey(route: string, key: string): string {
  return `throttle:${route}:${key}`;
}

/** `lock:session:{sessionIdHash}` — takes the already-hashed session id. */
export function sessionLockKey(sessionIdHash: string): string {
  return `lock:session:${sessionIdHash}`;
}

/** Available-context extras cache: same TTL as principal (30 s). */
export const CONTEXT_EXTRAS_TTL_BASE = 30;
export const CONTEXT_EXTRAS_TTL_JITTER = 5;

/** `ctx_extras:{userId}` */
export function contextExtrasKey(userId: string): string {
  return `ctx_extras:${userId}`;
}

/** Org names cache: short TTL (60 s). */
export const ORG_NAMES_TTL_BASE = 60;
export const ORG_NAMES_TTL_JITTER = 10;

/** `org_names:{orgId1},{orgId2},...` — sorted ids for stable cache key. */
export function orgNamesKey(orgIds: string[]): string {
  return `org_names:${[...orgIds].sort().join(',')}`;
}

// ---------------------------------------------------------------------------
// Availability version keys (ACC-R-20, 5.9.5)
// ---------------------------------------------------------------------------

/** `availability_version:{orgId}` — per-org availability version counter. */
export function availabilityVersionKey(orgId: string): string {
  return `availability_version:${orgId}`;
}

/** `availability_version_global` — global availability version counter (separate prefix to avoid collision with org id "global"). */
export function availabilityVersionGlobalKey(): string {
  return 'availability_version_global';
}

/**
 * `call:{sessionId}:create`: the lock that serialises concurrent first joins
 * of a call session (D-CW-07, CW-R-12).
 */
export function callCreateLockKey(sessionId: string): string {
  return `call:${sessionId}:create`;
}

/**
 * `call:{sessionId}:participant:{participantId}`: the participant's cached
 * `{ meeting, attendee }` join credentials, kept until the room closes
 * (D-CW-08). The only place a join token is stored.
 */
export function callParticipantCredentialsKey(sessionId: string, participantId: string): string {
  return `call:${sessionId}:participant:${participantId}`;
}

// ---------------------------------------------------------------------------
// Pub/sub channels
// ---------------------------------------------------------------------------

/** Channel name for cache invalidation messages. */
export const INVALIDATE_CHANNEL = 'invalidate';

/**
 * Channel of the Socket.IO room events (T-CW-1.6): `RoomEmitter` publishes
 * `{ room, event, payload }` from the API and the worker, and the
 * `RoomEventRelay` of every API task emits it to its own sockets.
 */
export const ROOM_EVENTS_CHANNEL = 'room_events';
