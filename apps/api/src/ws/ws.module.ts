/**
 * WsModule — Socket.IO authentication and authorization (T-1.11, 4.6.7).
 *
 * Provides:
 *   - WsAuthService: handshake authentication (cookie + ticket paths)
 *   - SubscriptionAuthorizer: per-subscription grant check
 *   - WsInvalidationService: real-time revocation via invalidate channel
 *   - WsConnectionRegistry: userId → socket set
 *   - EventsGateway: subscribe/unsubscribe event handlers
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

@Module({
  imports: [AuthModule, SessionModule],
  providers: [
    WsAuthService,
    SubscriptionAuthorizer,
    WsInvalidationService,
    WsConnectionRegistry,
    EventsGateway,
  ],
  exports: [WsAuthService, WsConnectionRegistry],
})
export class WsModule {}
