/**
 * @deprecated -- Replaced by `useAuth()` from `./auth`.
 *
 * This file is kept only to document the migration. All call sites now use
 * `useAuth()` which returns `{ principal, effectiveActions, signOut, ... }`
 * instead of `{ session, setRole }`.
 *
 * The sample-mode role switcher lives in `SampleAuthProvider` and is
 * accessed via `useSampleAuth()` from `./auth`.
 */
export {};
