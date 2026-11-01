/**
 * The listening API of the workspace app: one client over the cookie-mode
 * `api`, shared by the employee survey and the employer screens.
 */
import { createListeningApi } from '@nestself/api-client';
import type { ListeningApi } from '@nestself/api-client';
import { api } from '../../api';

export const listeningApi: ListeningApi = createListeningApi(api);
export type { ListeningApi };
