/**
 * @deprecated -- Replaced by `useAuth()` from `./auth`.
 *
 * This file is kept only to document the migration. All call sites now use
 * `useAuth()` which returns `{ principal, effectiveActions, signOut, ... }`
 * instead of `{ session, setRole }`.
 *
 * If the mobile app or another consumer still needs the old Session type,
 * use `SAMPLE_SESSIONS` from `@nestself/sample-data` directly.
 */
export {};
