/**
 * In-memory registry of connected WebSocket clients by userId.
 *
 * Used by the invalidation service to find sockets for a particular user.
 *
 * @see T-1.11, SESS-R-24
 */
import { Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';

@Injectable()
export class WsConnectionRegistry {
  private readonly byUser = new Map<string, Set<Socket>>();

  add(userId: string, socket: Socket): void {
    let set = this.byUser.get(userId);
    if (!set) {
      set = new Set();
      this.byUser.set(userId, set);
    }
    set.add(socket);
  }

  remove(userId: string, socket: Socket): void {
    const set = this.byUser.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) {
      this.byUser.delete(userId);
    }
  }

  getSocketsForUser(userId: string): Set<Socket> {
    return this.byUser.get(userId) ?? new Set();
  }

  getAllUsers(): string[] {
    return [...this.byUser.keys()];
  }
}
