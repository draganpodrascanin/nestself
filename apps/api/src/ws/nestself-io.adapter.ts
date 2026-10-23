/**
 * NestSelfIoAdapter — custom Socket.IO adapter with handshake
 * authentication and origin validation.
 *
 * Dependencies are resolved from the NestJS application context,
 * following the standard pattern (`app.get(...)`).
 *
 * The adapter is installed in main.ts:
 *   app.useWebSocketAdapter(new NestSelfIoAdapter(app));
 *
 * @see AUTHZ-R-58, AUTHZ-R-60, D-08, T-1.11
 */
import { type INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

import { WsAuthService } from './ws-auth.service.js';
import { WsConnectionRegistry } from './ws-connection-registry.js';

export class NestSelfIoAdapter extends IoAdapter {
  private readonly adapterLogger = new Logger(NestSelfIoAdapter.name);
  private readonly wsAuth: WsAuthService;
  private readonly registry: WsConnectionRegistry;
  private readonly allowedOrigins: string[];

  constructor(app: INestApplicationContext) {
    super(app);
    this.wsAuth = app.get(WsAuthService);
    this.registry = app.get(WsConnectionRegistry);

    const config = app.get(ConfigService);
    this.allowedOrigins = [
      config.get<string>('WORKSPACE_URL'),
      config.get<string>('ADMIN_URL'),
    ].filter(Boolean) as string[];
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const serverOptions: Partial<ServerOptions> = {
      ...options,
      path: '/api/ws',
      cors: {
        origin: this.allowedOrigins.length > 0 ? this.allowedOrigins : false,
        credentials: true,
      },
    };

    const server: Server = super.createIOServer(port, serverOptions as ServerOptions);

    // Handshake middleware (AUTHZ-R-58)
    server.use(async (socket, next) => {
      try {
        const headers = socket.handshake.headers as Record<
          string,
          string | undefined
        >;
        const auth = (socket.handshake.auth ?? {}) as Record<
          string,
          unknown
        >;
        const origin = headers['origin'] ?? null;

        const principal = await this.wsAuth.authenticateHandshake(
          headers,
          auth,
          origin,
          this.allowedOrigins,
        );

        socket.data.principal = principal;
        socket.data.subscriptions = new Map<
          string,
          { action: string; resource: Record<string, unknown> }
        >();

        // Register in the connection registry
        this.registry.add(principal.userId, socket);

        // Remove from registry on disconnect
        socket.on('disconnect', () => {
          this.registry.remove(principal.userId, socket);
        });

        next();
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'unauthorized';
        const code =
          err != null &&
          typeof err === 'object' &&
          'code' in err &&
          typeof (err as Record<string, unknown>).code === 'string'
            ? ((err as Record<string, unknown>).code as string)
            : 'unauthorized';
        this.adapterLogger.warn(`WS handshake rejected: ${code} — ${message}`);
        next(new Error(code));
      }
    });

    return server;
  }
}
