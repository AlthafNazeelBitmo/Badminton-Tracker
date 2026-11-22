import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';
import { trustedProxyMiddleware } from './common/trusted-proxy';

/**
 * Everything that turns a bare Nest application into this API: security headers,
 * cookies, body limits, CORS, the URL prefix and versioning, and the docs.
 *
 * Shared by the long-running server (`main.ts`) and the serverless entry point
 * (`serverless.ts`), so the two cannot drift — a header set in one and forgotten in the
 * other is exactly the kind of difference nobody notices until it matters.
 */
export function configureApp(app: NestExpressApplication, config: Env): void {
  // Behind exactly one proxy (the platform's load balancer). `true` would let any
  // caller spoof `X-Forwarded-For` and defeat IP-based rate limiting.
  app.set('trust proxy', 1);

  // Before anything reads `request.ip`. See trusted-proxy.ts.
  app.use(trustedProxyMiddleware(config.TRUSTED_PROXY_SECRET));

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
      hsts:
        config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
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
}
