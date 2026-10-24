/**
 * Typed wrappers for the confidential professional-interaction routes
 * (auth-strategy.md section 4.7). The list methods return metadata only; the
 * single-record reads return bodies after the server authorizes the row and
 * may answer 403 `step_up_required` (restricted class).
 */
import {
  ConversationListResponseSchema,
  ConversationResponseSchema,
  IntakeResponseSchema,
} from '@nestself/contracts';
import type { ApiClient } from './client';

const seg = encodeURIComponent;

export function createProfessionalApi(client: ApiClient) {
  return {
    /** GET /professional/me/conversations — the caller's own conversations as participant. */
    listMyConversations: () =>
      client.request('/api/professional/me/conversations', {
        method: 'GET',
        schema: ConversationListResponseSchema,
      }),

    /** GET /professional/conversations — conversations of the caller's assigned cases. */
    listAssignedConversations: () =>
      client.request('/api/professional/conversations', {
        method: 'GET',
        schema: ConversationListResponseSchema,
      }),

    /** GET /professional/conversations/:id — assigned expert read (messages oldest first). */
    getConversation: (id: string) =>
      client.request(`/api/professional/conversations/${seg(id)}`, {
        method: 'GET',
        schema: ConversationResponseSchema,
      }),

    /** GET /professional/me/conversations/:id — participant read. */
    getMyConversation: (id: string) =>
      client.request(`/api/professional/me/conversations/${seg(id)}`, {
        method: 'GET',
        schema: ConversationResponseSchema,
      }),

    /** GET /professional/intake/:id — assigned expert read of the case intake. */
    getIntake: (id: string) =>
      client.request(`/api/professional/intake/${seg(id)}`, {
        method: 'GET',
        schema: IntakeResponseSchema,
      }),
  };
}

export type ProfessionalApi = ReturnType<typeof createProfessionalApi>;
