import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
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
  configureApp(app, config);

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
  console.error('Failed to start API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
