import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { NestSelfIoAdapter } from './ws/nestself-io.adapter.js';
import { writeFileSync } from 'node:fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService);

  app.use(helmet());

  // Express sends a weak ETag on every JSON response, so a browser revalidates
  // with If-None-Match and gets a bodyless 304. `@nestself/api-client` treats
  // anything outside 2xx as a failure (`if (!response.ok)`), so a refresh turned
  // a live session into an ApiError and bounced the user to /sign-in. Responses
  // here are per-principal and already Cache-Control: no-store; they must never
  // be revalidated by ETag.
  app.getHttpAdapter().getInstance().set('etag', false);

  // Trust proxy for X-Forwarded-For when behind a load balancer
  const trustProxyHops = config.get<number>('TRUST_PROXY_HOPS', 0);
  if (trustProxyHops > 0) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', trustProxyHops);
  }

  // Global exception filter producing the 5.9 error envelope
  app.useGlobalFilters(new ApiExceptionFilter());

  // Socket.IO under /api/ws with session-cookie or single-use-ticket handshake (T-1.11, D-19)
  app.useWebSocketAdapter(new NestSelfIoAdapter(app));

  const allowedOrigins = [
    config.get<string>('MARKETING_URL'),
    config.get<string>('WORKSPACE_URL'),
    config.get<string>('ADMIN_URL'),
  ].filter(Boolean) as string[];

  app.enableCors({
    // No configured origins means no cross-origin access, never a wildcard.
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  app.setGlobalPrefix('api');
  // Request validation is per-route with zod schemas from @nestself/contracts; no class-validator pipe.

  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('NestSelf API')
      .setDescription('NestSelf platform API')
      .setVersion('0.0.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);

    if (process.env.EMIT_OPENAPI === 'true') {
      writeFileSync('openapi.json', JSON.stringify(document, null, 2));
      logger.log('OpenAPI spec written to openapi.json');
      await app.close();
      return;
    }
  }

  const port = config.get<number>('PORT', 4000);
  await app.listen(port);
  logger.log(`Application listening on port ${port}`);
}

bootstrap();
