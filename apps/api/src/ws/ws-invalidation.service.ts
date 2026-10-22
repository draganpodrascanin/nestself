/**
 * WsInvalidationService — subscribes to the `invalidate` Redis channel
 * and enforces real-time session/grant revocation on connected sockets.
 *
 * When a user is suspended/deactivated, their sockets are disconnected.
 * When grants change, their subscriptions are re-evaluated and revoked
 * if no longer allowed.
 *
 * @see SESS-R-24, DR-15, AUTHZ-R-59, T-1.11
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import { INVALIDATE_CHANNEL } from '../redis/redis-keys.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WsConnectionRegistry } from './ws-connection-registry.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SubscriptionAuthorizer } from './subscription-authorizer.js';

interface InvalidationMessage {
  keys?: string[];
  reason?: string;
  userId?: string;
}

@Injectable()
export class WsInvalidationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WsInvalidationService.name);
  private unsubscribe: (() => Promise<void>) | null = null;

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    private readonly registry: WsConnectionRegistry,
    private readonly principalLoader: PrincipalLoader,
    private readonly authorizer: SubscriptionAuthorizer,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.store.subscribe(
        INVALIDATE_CHANNEL,
        (message) => {
          this.handleMessage(message).catch((err) => {
            this.logger.warn(
              `Error handling invalidation: ${String(err)}`,
            );
          });
        },
      );
      this.logger.log('WS invalidation subscriber active');
    } catch (err) {
      this.logger.warn(
        `Failed to subscribe to invalidation channel: ${String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.unsubscribe) {
      await this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async handleMessage(raw: string): Promise<void> {
    let data: InvalidationMessage;
    try {
      data = JSON.parse(raw) as InvalidationMessage;
    } catch {
      this.logger.warn('Failed to parse invalidation message');
      return;
    }

    const { userId } = data;
    if (!userId) return;

    const sockets = this.registry.getSocketsForUser(userId);
    if (sockets.size === 0) return;

    // Reload the principal from the database
    const loaded = await this.principalLoader.load(userId);

    for (const socket of sockets) {
      // Disconnect if user is now suspended, deactivated or missing
      if (!loaded || loaded.isSuspended || loaded.isDeactivated) {
        this.logger.log(
          `Disconnecting socket ${socket.id} for user ${userId}: ` +
            `${!loaded ? 'user not found' : loaded.isSuspended ? 'suspended' : 'deactivated'}`,
        );
        socket.emit('session:revoked', {
          reason: !loaded
            ? 'user_not_found'
            : loaded.isSuspended
              ? 'suspended'
              : 'deactivated',
        });
        socket.disconnect(true);
        continue;
      }

      // Update the principal on the socket with fresh data
      const currentPrincipal = socket.data.principal;
      if (currentPrincipal) {
        socket.data.principal = {
          ...currentPrincipal,
          memberships: loaded.memberships,
          staffTemplates: loaded.staffTemplates,
          expert: loaded.expert,
        };
      }

      // Re-evaluate all subscriptions
      const revoked = await this.authorizer.reauthorizeAll(socket);
      if (revoked.length > 0) {
        this.logger.debug(
          `Revoked ${revoked.length} subscription(s) for user ${userId}: ${revoked.join(', ')}`,
        );
      }
    }
  }
}
