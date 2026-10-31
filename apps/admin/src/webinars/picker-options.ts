/**
 * The occurrence form's pickers (WBN-30): presenters and the moderator from
 * `GET /ops/webinars/host-candidates`, organisations from `GET /ops/orgs`,
 * an organisation's units from `GET /ops/orgs/:orgId/units`;
 * the sample principals and `SAMPLE_ORG` in sample mode. `null` means the
 * list could not be loaded: the form then takes ids (the fallback).
 */
import { useQuery } from '@tanstack/react-query';
import { opsOrganizationUnitsQuery, opsOrganizationsQuery, webinarHostCandidatesQuery } from '@nestself/api-client';
import { SAMPLE_ORG_UNITS } from '@nestself/sample-data';
import type { WebinarHostRole } from '@nestself/contracts';
import { isSampleDataMode } from '../data-source';
import { SAMPLE_MODERATOR_OPTIONS, SAMPLE_ORGANIZATION_OPTIONS, SAMPLE_PRESENTER_OPTIONS } from './sample';
import type { PickerOption } from './sample';
import { webinarsApi } from './webinars-api';

export interface PickerState {
  /** The choices, or null when they could not be loaded (enter ids instead). */
  options: readonly PickerOption[] | null;
  pending: boolean;
}

export function useHostOptions(role: WebinarHostRole): PickerState {
  const query = useQuery({ ...webinarHostCandidatesQuery(webinarsApi, { role }), enabled: !isSampleDataMode });
  if (isSampleDataMode) return { options: role === 'presenter' ? SAMPLE_PRESENTER_OPTIONS : SAMPLE_MODERATOR_OPTIONS, pending: false };
  if (query.status === 'error') return { options: null, pending: false };
  return { options: query.data?.items.map((host) => ({ value: host.userId, label: host.displayName })) ?? [], pending: query.status === 'pending' };
}

export function useOrganizationOptions(): PickerState {
  const query = useQuery({ ...opsOrganizationsQuery(webinarsApi), enabled: !isSampleDataMode });
  if (isSampleDataMode) return { options: SAMPLE_ORGANIZATION_OPTIONS, pending: false };
  if (query.status === 'error') return { options: null, pending: false };
  return { options: query.data?.items.map((org) => ({ value: org.id, label: org.name })) ?? [], pending: query.status === 'pending' };
}

/** Units listed with their depth in the tree, parents first, so the labels can show the hierarchy. */
function byTree(units: readonly { id: string; name: string; parentId: string | null }[]): PickerOption[] {
  const children = new Map<string | null, typeof units[number][]>();
  for (const unit of units) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit]);
  const known = new Set(units.map((unit) => unit.id));
  const out: PickerOption[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const unit of children.get(parentId) ?? []) {
      out.push({ value: unit.id, label: `${'— '.repeat(depth)}${unit.name}` });
      walk(unit.id, depth + 1);
    }
  };
  // Roots: no parent, or a parent outside the list.
  for (const [parentId] of children) if (parentId === null || !known.has(parentId)) walk(parentId, 0);
  return out;
}

/** The units of one organisation; none until an organisation is chosen. */
export function useUnitOptions(orgId: string): PickerState {
  const query = useQuery({ ...opsOrganizationUnitsQuery(webinarsApi, orgId), enabled: !isSampleDataMode && orgId.length > 0 });
  if (!orgId) return { options: [], pending: false };
  if (isSampleDataMode) return { options: byTree(SAMPLE_ORG_UNITS.filter((unit) => unit.orgId === orgId)), pending: false };
  if (query.status === 'error') return { options: null, pending: false };
  return { options: query.data ? byTree(query.data.items) : [], pending: query.status === 'pending' };
}
