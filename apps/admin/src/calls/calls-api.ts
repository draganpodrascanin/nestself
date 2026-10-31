/**
 * The calls API over the admin client (cookie mode, CSRF). The call
 * room's socket lives in `call-room-client.ts`, so pages that only read
 * appointments do not load `socket.io-client`.
 */
import { createCallsApi } from '@nestself/api-client';
import type { CallsApi } from '@nestself/api-client';
import { api } from '../api';

export const callsApi: CallsApi = createCallsApi(api);
