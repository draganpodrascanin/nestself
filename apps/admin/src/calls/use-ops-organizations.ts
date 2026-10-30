/**
 * The client organisations the caller coordinates (`GET /ops/orgs`), for
 * booking, cancelling and the operations filter (CALL-26 to CALL-28).
 * Create and Cancel show only for a `bookings.coordinate` holder with at
 * least one organisation; the API decides either way.
 */
import { useQuery } from '@tanstack/react-query';
import { retryUnlessClientError } from '@nestself/api-client';
import { can } from '@nestself/contracts';
import { SAMPLE_ORG } from '@nestself/sample-data';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';

export interface OpsOrganization {
  id: string;
  name: string;
}

export interface OpsOrganizationsState {
  status: 'pending' | 'error' | 'success';
  items: OpsOrganization[];
  error: unknown;
}

const SAMPLE_ORGANIZATIONS: OpsOrganization[] = [{ id: SAMPLE_ORG.id, name: SAMPLE_ORG.name }];

export function useOpsOrganizations(): OpsOrganizationsState {
  const { principal, effectiveActions } = useAuth();
  const coordinates = !!principal && can(principal, 'bookings.coordinate', undefined, effectiveActions);
  const query = useQuery({
    queryKey: ['ops-orgs'],
    queryFn: () => callsApi.listOpsOrganizations(),
    enabled: coordinates && !isSampleDataMode,
    retry: retryUnlessClientError,
    staleTime: 5 * 60_000,
  });
  if (!coordinates) return { status: 'success', items: [], error: null };
  if (isSampleDataMode) return { status: 'success', items: SAMPLE_ORGANIZATIONS, error: null };
  return { status: query.status, items: query.data?.items ?? [], error: query.error };
}

/** `bookings.coordinate` and at least one organisation to book for. */
export function useCanBook(): boolean {
  const { principal, effectiveActions } = useAuth();
  const organizations = useOpsOrganizations();
  return !!principal && can(principal, 'bookings.coordinate', undefined, effectiveActions) && organizations.items.length > 0;
}
