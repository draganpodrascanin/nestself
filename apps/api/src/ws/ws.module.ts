/**
 * WsModule — Socket.IO authentication and authorization (T-1.11, 4.6.7).
 *
 * Provides:
 *   - WsAuthService: handshake authentication (cookie + ticket paths)
 *   - SubscriptionAuthorizer: per-subscription grant check
 *   - WsInvalidationService: real-time revocation via invalidate channel
 *   - WsConnectionRegistry: userId → socket set
 *   - EventsGateway: subscribe/unsubscribe event handlers
 *   - RoomEmitter: server-side emits to a room, payloads checked, published on
 *     the room events channel (exported; the worker emits through it too)
 *   - RoomEventRelay: delivers the room events channel to this task's sockets
 *   - RoomAccessRegistry: per-kind room resolvers registered by feature modules (exported)
 *   - WebinarRoomResolvers: registers the webinar room resolvers once the
 *     application has started (T-CW-2.3; `WebinarsModule` imports this module,
 *     so the resolvers look its providers up through `ModuleRef`)
 *
 * The NestSelfIoAdapter is installed in main.ts, not here.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SessionModule } from '../session/session.module.js';
import { WsAuthService } from './ws-auth.service.js';
import { SubscriptionAuthorizer } from './subscription-authorizer.js';
import { WsInvalidationService } from './ws-invalidation.service.js';
import { WsConnectionRegistry } from './ws-connection-registry.js';
import { EventsGateway } from './events.gateway.js';
import { RoomEmitter } from './room-emitter.js';
import { RoomAccessRegistry } from './room-access.registry.js';
import { RoomEventRelay } from './room-event-relay.js';
import { WebinarRoomResolvers } from './webinar-room-access.js';

@Module({
  imports: [AuthModule, SessionModule],
  providers: [
    WsAuthService,
    SubscriptionAuthorizer,
    WsInvalidationService,
    WsConnectionRegistry,
    EventsGateway,
    RoomEmitter,
    RoomEventRelay,
    RoomAccessRegistry,
    WebinarRoomResolvers,
  ],
  exports: [WsAuthService, WsConnectionRegistry, RoomEmitter, RoomAccessRegistry],
})
export class WsModule {}
