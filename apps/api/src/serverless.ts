import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { CONFIG_TOKEN, loadEnv, type Env } from './config/env';
import { StructuredLogger, levelsFor } from './common/logger';

/**
 * Entry point for serverless platforms (Vercel): a request handler instead of a server.
 *
 * The application is built once per instance and reused for every request that instance
 * serves. Building it is the slow part — module graph, Prisma client, route table — so a
 * warm instance answers at normal speed and only a cold start pays for it.
 *
 * Concurrent requests that arrive during a cold start share the same in-flight build
 * rather than each starting their own.
 */

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let handler: Promise<Handler> | null = null;

async function build(): Promise<Handler> {
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new StructuredLogger('App', env.LOG_JSON, levelsFor(env.LOG_LEVEL)),
    bufferLogs: true,
  });

  configureApp(app, app.get<Env>(CONFIG_TOKEN));
  await app.init();

  return app.getHttpAdapter().getInstance() as Handler;
}

export default async function serverlessHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!handler) {
    handler = build().catch((error: unknown) => {
      // A failed build must not be cached, or one bad cold start (a database that was
      // briefly unreachable) would fail every request this instance ever serves.
      handler = null;
      throw error;
    });
  }

  let app: Handler;
  try {
    app = await handler;
  } catch (error) {
    console.error('Failed to start API:', error instanceof Error ? error.message : error);
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'The service is starting up. Try again shortly.' },
      }),
    );
    return;
  }

  // Resolve only once the response is done. Express answers asynchronously, and a
  // platform that treats the returned promise as "finished" could freeze the instance
  // with the database query still in flight.
  await new Promise<void>((resolve) => {
    response.once('finish', resolve);
    response.once('close', resolve);
    app(request, response);
  });
}
