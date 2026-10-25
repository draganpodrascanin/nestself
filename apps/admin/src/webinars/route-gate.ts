/**
 * Route guards for the admin webinar routes (guidelines 12.2). A convenience
 * only: the API authorises every route (`event.manage` for the occurrence
 * form, publish and cancel; `event.manage` or `event.moderate` for the list
 * and the attendance; a host of the occurrence for the live routes) and
 * answers 404 to anyone else (D-CW-30).
 */
import { redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import type { Principal } from '@nestself/contracts';
import { resolveRouteAuth } from '../auth';
import type { RouterAuth } from '../auth';
import { isSampleDataMode } from '../data-source';

const has = (principal: Principal | null, effectiveActions: readonly string[], action: string) =>
  !!principal && can(principal, action, undefined, effectiveActions);

/** Create, edit, publish and cancel occurrences (WBN-30 to WBN-32). */
export function canManageWebinars(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return has(principal, effectiveActions, 'event.manage');
}

/** The list and the detail: `GET /ops/webinars` serves managers and moderators. */
export function canListWebinars(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return canManageWebinars(principal, effectiveActions) || has(principal, effectiveActions, 'event.moderate');
}

/** Presenters hold `event.present` only: they see the occurrences they host (`GET /ops/webinars?mine=true`). */
export function canPresentWebinars(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return has(principal, effectiveActions, 'event.present');
}

/** The nav entry and the list: the full list, or the presenter's own. */
export function canSeeWebinars(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return canListWebinars(principal, effectiveActions) || canPresentWebinars(principal, effectiveActions);
}

/** The presenter view and the moderator console (WBN-16 to WBN-29). */
export function canHostWebinars(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return has(principal, effectiveActions, 'event.present') || has(principal, effectiveActions, 'event.moderate');
}

async function guard(auth: RouterAuth, allowed: (principal: Principal, actions: readonly string[]) => boolean): Promise<void> {
  const { principal, effectiveActions } = await resolveRouteAuth(auth);
  // Sample mode fills the session after the first load; the screen checks again.
  if (!principal) {
    if (isSampleDataMode) return;
    throw redirect({ to: '/sign-in' });
  }
  if (!allowed(principal, effectiveActions)) throw redirect({ to: '/' });
}

export const requireWebinarList = (auth: RouterAuth) => guard(auth, canListWebinars);
export const requireWebinarListOrMine = (auth: RouterAuth) => guard(auth, canSeeWebinars);
export const requireWebinarManage = (auth: RouterAuth) => guard(auth, canManageWebinars);
export const requireWebinarHost = (auth: RouterAuth) => guard(auth, canHostWebinars);
/** The occurrence route, whose child is the live view: list holders and hosts. */
export const requireWebinarListOrHost = (auth: RouterAuth) =>
  guard(auth, (principal, actions) => canListWebinars(principal, actions) || canHostWebinars(principal, actions));
