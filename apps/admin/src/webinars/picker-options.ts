/**
 * The occurrence form's pickers (WBN-30): presenters and the moderator from
 * `GET /ops/webinars/host-candidates`, organisations from `GET /ops/orgs`;
 * the sample principals and `SAMPLE_ORG` in sample mode. `null` means the
 * list could not be loaded: the form then takes ids (the fallback).
 */
import { useQuery } from '@tanstack/react-query';
import { opsOrganizationsQuery, webinarHostCandidatesQuery } from '@nestself/api-client';
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
