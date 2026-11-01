/**
 * The listening API of the admin app: one client over the cookie-mode `api`,
 * used by the questionnaire authoring and client configuration screens.
 */
import { createListeningApi } from '@nestself/api-client';
import type { ListeningApi } from '@nestself/api-client';
import { api } from '../../api';

export const listeningApi: ListeningApi = createListeningApi(api);
export type { ListeningApi };
