/**
 * The `webinar:{id}`, `webinar:{id}:moderation` and `user:{userId}` rooms (T-CW-2.4): a Socket.IO
 * connection on `/api/ws`, authenticated by the session cookie, like the call
 * room. Sample mode has no socket.
 */
import { io } from 'socket.io-client';
import { createWebinarRoomClient, noopWebinarRoomClient } from '@nestself/api-client';
import type { RoomSocket, WebinarRoomClient } from '@nestself/api-client';
import { isSampleDataMode } from '../data-source';

const SOCKET_PATH = '/api/ws';

function connectWebinarSocket(): RoomSocket {
  const options = { path: SOCKET_PATH, withCredentials: true };
  const base = import.meta.env.VITE_API_URL;
  return base ? io(base, options) : io(options);
}

export const webinarRoomClient: WebinarRoomClient = isSampleDataMode ? noopWebinarRoomClient : createWebinarRoomClient(connectWebinarSocket);
