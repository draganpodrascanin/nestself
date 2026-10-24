import { describe, it, expect } from 'vitest';
import { createApiClient } from './client';
import { createProfessionalApi } from './professional';

interface Call {
  url: string;
  method: string;
}

function setup(responseBody: unknown) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const api = createProfessionalApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
  return { api, last: () => calls[calls.length - 1]! };
}

const SUMMARY = {
  id: 'conv_1',
  caseId: 'case_1',
  orgId: 'org_1',
  employeeUserId: 'user_jovan',
  expertUserId: 'user_milica',
  createdAt: '2026-10-01T09:00:00.000Z',
  messageCount: 2,
};

const CONVERSATION = {
  id: 'conv_1',
  caseId: 'case_1',
  orgId: 'org_1',
  messages: [{ id: 'm1', authorUserId: 'user_jovan', body: 'Sample (fixture)', createdAt: '2026-10-01T09:00:00.000Z' }],
};

describe('createProfessionalApi', () => {
  it('lists my conversations', async () => {
    const { api, last } = setup({ items: [SUMMARY] });
    await expect(api.listMyConversations()).resolves.toEqual({ items: [SUMMARY] });
    expect(last()).toEqual({ url: 'http://x/api/professional/me/conversations', method: 'GET' });
  });

  it('lists assigned conversations', async () => {
    const { api, last } = setup({ items: [] });
    await expect(api.listAssignedConversations()).resolves.toEqual({ items: [] });
    expect(last()).toEqual({ url: 'http://x/api/professional/conversations', method: 'GET' });
  });

  it('strips any body a list row might carry', async () => {
    const { api } = setup({ items: [{ ...SUMMARY, messages: CONVERSATION.messages }] });
    const res = await api.listAssignedConversations();
    expect(res.items[0]).not.toHaveProperty('messages');
  });

  it('reads an assigned conversation, encoding the id', async () => {
    const { api, last } = setup(CONVERSATION);
    await expect(api.getConversation('conv/1')).resolves.toEqual(CONVERSATION);
    expect(last()).toEqual({ url: 'http://x/api/professional/conversations/conv%2F1', method: 'GET' });
  });

  it('reads my conversation', async () => {
    const { api, last } = setup(CONVERSATION);
    await api.getMyConversation('conv_1');
    expect(last()).toEqual({ url: 'http://x/api/professional/me/conversations/conv_1', method: 'GET' });
  });

  it('reads an intake record', async () => {
    const intake = { id: 'in_1', caseId: 'case_1', orgId: 'org_1', body: 'Sample (fixture)', createdAt: '2026-10-01T08:55:00.000Z' };
    const { api, last } = setup(intake);
    await expect(api.getIntake('in_1')).resolves.toEqual(intake);
    expect(last()).toEqual({ url: 'http://x/api/professional/intake/in_1', method: 'GET' });
  });

  it('rejects a list row without messageCount', async () => {
    const { messageCount: _omit, ...withoutCount } = SUMMARY;
    const { api } = setup({ items: [withoutCount] });
    await expect(api.listMyConversations()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('surfaces step_up_required from a single read as an ApiError', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ status: 403, code: 'step_up_required', message: 'x', details: { stepUpClass: 'restricted' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    const api = createProfessionalApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
    await expect(api.getConversation('conv_1')).rejects.toMatchObject({ status: 403, code: 'step_up_required' });
  });
});
