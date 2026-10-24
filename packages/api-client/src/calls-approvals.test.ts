/**
 * The follow-up approval and policy wrappers (T-CW-1.10, D-CW-37, CALL-41):
 * paths, bodies, the strict response parse and the query keys.
 */
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createApiClient } from './client';
import { createCallsApi } from './calls';
import {
  approvalKeys,
  approvalListQuery,
  approveApprovalMutation,
  followUpPolicyQuery,
  rejectApprovalMutation,
  setFollowUpPolicyMutation,
} from './queries/calls';

const ITEM = {
  id: 'appr_1',
  appointmentId: 'appt_next',
  status: 'pending',
  employeeDisplayName: 'Jovan Petrović',
  description: 'follow-up session with a NestSelf expert',
  startsAt: '2030-01-20T09:00:00.000Z',
  durationMinutes: 50,
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function setup(responseBody: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
  };
  const api = createCallsApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
  return { api, last: () => calls[calls.length - 1]! };
}

describe('approval wrappers', () => {
  it('lists the caller’s items of an organization', async () => {
    const { api, last } = setup({ items: [ITEM] });
    await expect(api.listApprovals('org 1')).resolves.toEqual({ items: [ITEM] });
    expect(last()).toEqual({ url: 'http://x/api/orgs/org%201/appointment-approvals', method: 'GET', body: undefined });
  });

  it('refuses an item carrying anything beyond the four facts', async () => {
    const { api } = setup({ items: [{ ...ITEM, serviceCategory: 'psychological' }] });
    await expect(api.listApprovals('org_1')).rejects.toThrow();
  });

  it('approves with an empty body and rejects with the safe reason', async () => {
    const { api, last } = setup({ ...ITEM, status: 'approved' });
    await expect(api.approveApproval('appr_1')).resolves.toMatchObject({ status: 'approved' });
    expect(last()).toEqual({ url: 'http://x/api/appointment-approvals/appr_1/approve', method: 'POST', body: {} });
    await api.rejectApproval('appr_1', { safeReason: 'Not this month.' });
    expect(last()).toEqual({
      url: 'http://x/api/appointment-approvals/appr_1/reject',
      method: 'POST',
      body: { safeReason: 'Not this month.' },
    });
  });

  it('reads and sets the organization’s follow-up policy', async () => {
    const { api, last } = setup({ policy: 'manager_approval' });
    await expect(api.getFollowUpPolicy('org_1')).resolves.toEqual({ policy: 'manager_approval' });
    expect(last()).toMatchObject({ url: 'http://x/api/orgs/org_1/settings/follow-up-approval', method: 'GET' });
    await api.setFollowUpPolicy('org_1', 'manager_approval');
    expect(last()).toEqual({
      url: 'http://x/api/orgs/org_1/settings/follow-up-approval',
      method: 'PATCH',
      body: { policy: 'manager_approval' },
    });
  });
});

describe('approval queries', () => {
  it('key the list and the policy by organization', () => {
    const { api } = setup({ items: [] });
    expect(approvalListQuery(api, 'org_1').queryKey).toEqual(approvalKeys.list('org_1'));
    expect(approvalKeys.list('org_1')).toEqual(['appointment-approvals', 'org_1']);
    expect(followUpPolicyQuery(api, 'org_1').queryKey).toEqual(['follow-up-policy', 'org_1']);
  });

  it('the mutations call the wrappers', async () => {
    const { api, last } = setup({ ...ITEM, status: 'rejected' });
    const client = new QueryClient();
    await client.getMutationCache().build(client, approveApprovalMutation(api)).execute('appr_1');
    expect(last().url).toBe('http://x/api/appointment-approvals/appr_1/approve');
    await client
      .getMutationCache()
      .build(client, rejectApprovalMutation(api))
      .execute({ approvalId: 'appr_1', safeReason: 'No.' });
    expect(last()).toMatchObject({ url: 'http://x/api/appointment-approvals/appr_1/reject', body: { safeReason: 'No.' } });
    const policy = setup({ policy: 'automatic' });
    await client.getMutationCache().build(client, setFollowUpPolicyMutation(policy.api, 'org_1')).execute('automatic');
    expect(policy.last()).toMatchObject({ method: 'PATCH', body: { policy: 'automatic' } });
  });
});
