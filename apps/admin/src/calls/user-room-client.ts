/**
 * The `user:{userId}` room client (T-CW-1.9): the same Socket.IO connection
 * settings as the call room. Sample mode has no socket.
 */
import { io } from 'socket.io-client';
import { createUserRoomClient, noopUserRoomClient } from '@nestself/api-client';
import type { RoomSocket, UserRoomClient } from '@nestself/api-client';
import { isSampleDataMode } from '../data-source';

const SOCKET_PATH = '/api/ws';

function connectUserSocket(): RoomSocket {
  const options = { path: SOCKET_PATH, withCredentials: true };
  const base = import.meta.env.VITE_API_URL;
  return base ? io(base, options) : io(options);
}

export const userRoomClient: UserRoomClient = isSampleDataMode ? noopUserRoomClient : createUserRoomClient(connectUserSocket);
