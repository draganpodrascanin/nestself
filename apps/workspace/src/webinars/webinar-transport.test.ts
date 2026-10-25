/**
 * The api-client's webinar transport and the `@nestself/video` webinar
 * client agree (T-CW-2.4): the same actions, the same routes, and a real
 * `WebinarClient` posts through the transport and shows the coded failure.
 */
import { describe, expect, it } from 'vitest';
import { WEBINAR_TRANSPORT_ACTIONS, WEBINAR_TRANSPORT_ROUTES, createApiClient, createWebinarTransport, createWebinarsApi, noopWebinarRoomClient } from '@nestself/api-client';
import { WEBINAR_ACTIONS, WEBINAR_ACTION_ROUTES, WebinarClient } from '@nestself/video';

describe('webinar transport', () => {
  it('serves exactly the webinar client actions on their routes', () => {
    expect([...WEBINAR_TRANSPORT_ACTIONS]).toEqual([...WEBINAR_ACTIONS]);
    expect(WEBINAR_TRANSPORT_ROUTES).toEqual(WEBINAR_ACTION_ROUTES);
  });

  it('carries a webinar client action to the API and its error code back', async () => {
    const sent: { method: string; url: string; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      sent.push({ method: init?.method ?? 'GET', url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify({ code: 'webinar_not_open', message: 'English' }), { status: 409, headers: { 'content-type': 'application/json' } });
    };
    const api = createWebinarsApi(createApiClient({ baseUrl: '', mode: 'cookie', fetchImpl }));
    const client = new WebinarClient({
      webinarId: 'web_1',
      role: 'attendee',
      participantId: 'part_1',
      transport: createWebinarTransport({ api, rooms: noopWebinarRoomClient, webinarId: 'web_1', userId: 'user_jovan' }),
    });
    await expect(client.raiseHand()).rejects.toMatchObject({ code: 'webinar_not_open' });
    expect(sent).toEqual([{ method: 'POST', url: '/api/webinars/web_1/hand', body: {} }]);
    expect(client.getSnapshot().errors.hand).toMatchObject({ code: 'webinar_not_open' });
  });
});
