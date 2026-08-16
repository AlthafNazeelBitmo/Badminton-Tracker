import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Assigns every request an id, echoes it back as `x-request-id`, and logs a single
 * structured line per request on completion.
 *
 * One line per request (rather than one on entry and one on exit) keeps log volume
 * proportional to traffic and puts the status and duration in the same record as the
 * path. Requests slower than the configured threshold are raised to `warn` so a
 * latency regression is visible without a dashboard.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly slowRequestMs: number) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.header('x-request-id');
    const requestId = isSafeRequestId(incoming) ? incoming : randomUUID();

    (request as Request & { id: string }).id = requestId;
    response.setHeader('x-request-id', requestId);

    const startedAt = process.hrtime.bigint();

    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const entry = {
        message: 'request',
        requestId,
        method: request.method,
        // `route.path` is the pattern (`/matches/:id`), which keeps ids out of logs
        // and makes the lines aggregatable.
        path: request.route?.path ?? request.path,
        status: response.statusCode,
        durationMs: Math.round(durationMs),
      };

      if (durationMs >= this.slowRequestMs) {
        this.logger.warn({ ...entry, message: 'slow request' });
      } else if (response.statusCode < 400) {
        this.logger.log(entry);
      }
      // Failures are logged by the exception filter, which knows the error code.
    });

    next();
  }
}

/** Only echo a caller-supplied id when it is short and boring, to avoid log injection. */
function isSafeRequestId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(value);
}
