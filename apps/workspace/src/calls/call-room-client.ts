/**
 * The `call:{sessionId}` room client (T-CW-1.6): a Socket.IO connection on
 * `/api/ws`, authenticated by the session cookie (same origin, or the
 * `VITE_API_URL` origin with credentials). Sample mode has no socket.
 */
import { io } from 'socket.io-client';
import { createCallRoomClient, noopCallRoomClient } from '@nestself/api-client';
import type { CallRoomClient, RoomSocket } from '@nestself/api-client';
import { isSampleDataMode } from '../data-source';

const SOCKET_PATH = '/api/ws';

function connectCallSocket(): RoomSocket {
  const options = { path: SOCKET_PATH, withCredentials: true };
  const base = import.meta.env.VITE_API_URL;
  return base ? io(base, options) : io(options);
}

export const callRoomClient: CallRoomClient = isSampleDataMode ? noopCallRoomClient : createCallRoomClient(connectCallSocket);
