import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { writeFileSync } from 'node:fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService);

  app.use(helmet());

  const allowedOrigins = [
    config.get<string>('MARKETING_URL'),
    config.get<string>('WORKSPACE_URL'),
    config.get<string>('ADMIN_URL'),
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

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
