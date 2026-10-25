/**
 * The webinars API over the workspace client (cookie mode, CSRF). The room
 * socket lives in `webinar-room-client.ts`, so the list and detail pages do
 * not load `socket.io-client`.
 */
import { createWebinarsApi } from '@nestself/api-client';
import type { WebinarsApi } from '@nestself/api-client';
import { api } from '../api';

export const webinarsApi: WebinarsApi = createWebinarsApi(api);
