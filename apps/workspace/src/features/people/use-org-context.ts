/**
 * The organization an HR screen administers, never a URL or body value: the
 * organization chosen in the header context picker when the user has an
 * active membership there, otherwise the user's single active membership. On
 * mount the session is moved into that organization's context once (the
 * access screen pattern), and the API queries stay disabled until the
 * principal is in it.
 */
import { useEffect, useRef, useState } from 'react';
import type { Principal } from '@nestself/contracts';
import { useAuth } from '../../auth';

export interface ResolvedOrganization {
  /** The organization, or `null` when none can be chosen for the user. */
  orgId: string | null;
  /** Several active memberships and none chosen: pick one in the header. */
  needsChoice: boolean;
}

/**
 * 1. `principal.context.orgId` when the context is an organization the user
 *    has an ACTIVE membership in;
 * 2. else the single ACTIVE membership;
 * 3. else none (`needsChoice` when there are several to choose from).
 */
export function resolveOrganization(principal: Principal | null | undefined): ResolvedOrganization {
  const active = principal?.memberships.filter((m) => m.status === 'ACTIVE') ?? [];
  const context = principal?.context;
  if (context?.kind === 'organization' && active.some((m) => m.orgId === context.orgId)) {
    return { orgId: context.orgId, needsChoice: false };
  }
  if (active.length === 1) return { orgId: active[0]!.orgId, needsChoice: false };
  return { orgId: null, needsChoice: active.length > 1 };
}

export interface OrgContextState {
  /** The organization, or `null` when none can be chosen (see `resolveOrganization`). */
  orgId: string | null;
  /** Several active memberships and none chosen in the header. */
  needsChoice: boolean;
  /** The organization id once the API may be called; `null` in sample mode or before the switch. */
  apiOrgId: string | null;
  /** The failed context switch, if any. */
  switchError: unknown;
}

export function useOrgContext(sampleMode: boolean): OrgContextState {
  const { principal, switchContext } = useAuth();
  const { orgId, needsChoice } = resolveOrganization(principal);
  const inOrgContext =
    orgId !== null && principal?.context.kind === 'organization' && principal.context.orgId === orgId;

  const switchRequested = useRef(false);
  const [switchError, setSwitchError] = useState<unknown>(null);
  useEffect(() => {
    // Once this mount has seen the organization context it never switches
    // again: a later choice in the header context picker stands.
    if (inOrgContext) switchRequested.current = true;
    if (sampleMode || orgId === null || inOrgContext || switchRequested.current) return;
    switchRequested.current = true;
    switchContext({ kind: 'organization', orgId }).catch((err: unknown) => {
      setSwitchError(err ?? new Error('context switch failed'));
    });
  }, [sampleMode, orgId, inOrgContext, switchContext]);

  return { orgId, needsChoice, apiOrgId: !sampleMode && inOrgContext ? orgId : null, switchError };
}
