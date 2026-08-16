import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { CONFIG_TOKEN, loadEnv, type Env } from './config/env';
import { StructuredLogger, levelsFor } from './common/logger';

async function bootstrap(): Promise<void> {
  // Validate configuration before Nest starts, so a misconfigured process dies with a
  // readable message instead of a stack trace from somewhere in the DI container.
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new StructuredLogger('App', env.LOG_JSON, levelsFor(env.LOG_LEVEL)),
    bufferLogs: true,
  });

  const config = app.get<Env>(CONFIG_TOKEN);

  // Behind exactly one proxy (the platform's load balancer). `true` would let any
  // caller spoof `X-Forwarded-For` and defeat IP-based rate limiting.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // The API returns JSON; the only HTML it serves is Swagger UI, which needs
          // its own inline styles and scripts.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(cookieParser());

  // Bodies are JSON and small; 2 MB is generous for a match and bounded for an import,
  // which posts CSV text inside a JSON field.
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: true });

  // Credentialed CORS demands an explicit origin — `*` is rejected by browsers when
  // cookies are involved, and an origin reflector would be an open door.
  app.enableCors({
    origin: [config.WEB_PUBLIC_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Refresh-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  if (config.ENABLE_SWAGGER) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Badminton Performance API')
        .setDescription(
          'Personal badminton performance tracking and analytics. All endpoints are ' +
            'scoped to the authenticated user; ownership is never taken from a request ' +
            'parameter.',
        )
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'bearer')
        .addCookieAuth('bt_access')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');

  const logger = new StructuredLogger('Bootstrap', config.LOG_JSON, levelsFor(config.LOG_LEVEL));
  logger.log(
    `API listening on port ${config.PORT} (${config.NODE_ENV})` +
      (config.ENABLE_SWAGGER ? ` — docs at ${config.API_PUBLIC_URL}/api/docs` : ''),
  );
}

void bootstrap().catch((error: unknown) => {
  // Nothing is initialised yet, so this is the one place a bare console write is right.
  // eslint-disable-next-line no-console
  console.error('Failed to start API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
