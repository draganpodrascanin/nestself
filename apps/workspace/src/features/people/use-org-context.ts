/**
 * The organization an HR screen administers: the signed-in user's single
 * active membership, never a URL or body value. On mount the session is moved
 * into that organization's context once (the access screen pattern), and the
 * API queries stay disabled until the principal is in it.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth';

export interface OrgContextState {
  /** The organization, or `null` when the user has no single active membership. */
  orgId: string | null;
  /** The organization id once the API may be called; `null` in sample mode or before the switch. */
  apiOrgId: string | null;
  /** The failed context switch, if any. */
  switchError: unknown;
}

export function useOrgContext(sampleMode: boolean): OrgContextState {
  const { principal, switchContext } = useAuth();
  const activeMemberships = principal?.memberships.filter((m) => m.status === 'ACTIVE') ?? [];
  const orgId = activeMemberships.length === 1 ? activeMemberships[0]!.orgId : null;
  const inOrgContext =
    orgId !== null && principal?.context.kind === 'organization' && principal.context.orgId === orgId;

  const switchRequested = useRef(false);
  const [switchError, setSwitchError] = useState<unknown>(null);
  useEffect(() => {
    if (sampleMode || orgId === null || inOrgContext || switchRequested.current) return;
    switchRequested.current = true;
    switchContext({ kind: 'organization', orgId }).catch((err: unknown) => {
      setSwitchError(err ?? new Error('context switch failed'));
    });
  }, [sampleMode, orgId, inOrgContext, switchContext]);

  return { orgId, apiOrgId: !sampleMode && inOrgContext ? orgId : null, switchError };
}
