import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Observable, concatMap, from, of, switchMap } from 'rxjs';
import type { Request, Response } from 'express';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_RETENTION_HOURS,
  idempotencyKeySchema,
} from '@badminton/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from './errors';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Marks a route as safely retryable with an `Idempotency-Key` header.
 *
 * Apply to any write the mobile app can queue while offline.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

/**
 * Replay protection for queued writes.
 *
 * The mobile app records matches at the side of a court and drains its outbox when the
 * connection returns. The dangerous case is not a failed request — it is a *successful*
 * request whose response never arrived: the client cannot tell the difference and will
 * retry, and without this the retry creates a second match.
 *
 * On a first call the response is stored against the client's key. On a replay the
 * stored response is returned verbatim, including the ids the client is waiting for, and
 * the handler never runs again.
 *
 * Three rules make it trustworthy rather than merely convenient:
 *
 *  - **Scoped to the user.** Keys are namespaced per account, so one client cannot
 *    replay or observe another's response.
 *  - **Bound to the request.** The body is hashed. The same key with different content
 *    is a client bug and returns 409 rather than the wrong stored answer.
 *  - **Only successes are stored.** A failed request leaves no record, so a genuine
 *    retry after a transient error is allowed to succeed.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id: string } }>();
    const response = http.getResponse<Response>();

    const rawKey = request.header(IDEMPOTENCY_KEY_HEADER);
    // The header is optional: the web client does not send one and does not need to.
    if (!rawKey) return next.handle();

    const parsed = idempotencyKeySchema.safeParse(rawKey);
    if (!parsed.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_IDEMPOTENCY_KEY',
        parsed.error.issues[0]?.message ?? 'Invalid idempotency key.',
      );
    }

    const userId = request.user?.id;
    if (!userId) return next.handle();

    const key = parsed.data;
    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;
    const requestHash = hashBody(request.body);

    return from(
      this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } }),
    ).pipe(
      switchMap((stored) => {
        if (stored) {
          if (stored.endpoint !== endpoint || stored.requestHash !== requestHash) {
            throw new AppException(
              HttpStatus.CONFLICT,
              'IDEMPOTENCY_KEY_REUSED',
              'This idempotency key was already used for a different request.',
            );
          }

          // A replay: answer exactly as before, and say so, so the client can
          // distinguish "created" from "already created" in its own log.
          response.setHeader('Idempotency-Replayed', 'true');
          response.status(stored.statusCode);
          return of(stored.responseBody);
        }

        const statusCode = this.successStatusOf(context);

        return next.handle().pipe(
          // `concatMap` rather than `tap`: the record is written before the response is
          // sent, so a client that retries the instant it reconnects cannot slip past an
          // unfinished write and create a duplicate.
          concatMap(async (body) => {
            await this.remember(userId, key, endpoint, requestHash, statusCode, body);
            return body;
          }),
        );
      }),
    );
  }

  /**
   * The status code this route answers with on success.
   *
   * Read from metadata rather than from `response.statusCode`, which is still Express's
   * default at this point: Nest applies the real code after the interceptor chain
   * resolves. Reading it too early would replay a created match as `200 OK`, and a client
   * that keys its outbox off `201` would never mark the entry as done.
   */
  private successStatusOf(context: ExecutionContext): number {
    const explicit = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );
    if (typeof explicit === 'number') return explicit;

    const method = context.switchToHttp().getRequest<Request>().method;
    return method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
  }

  /**
   * Records the response for future replays.
   *
   * Failure-tolerant on purpose: the write has already succeeded, and refusing to return
   * that success because a bookkeeping row could not be written would turn a working
   * request into a failed one. The worst case of losing the record is a duplicate on
   * retry — the same risk as not having the feature at all.
   */
  private async remember(
    userId: string,
    key: string,
    endpoint: string,
    requestHash: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    if (statusCode >= HttpStatus.BAD_REQUEST) return;

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          userId,
          key,
          endpoint,
          requestHash,
          statusCode,
          responseBody: (body ?? null) as never,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_HOURS * 3600 * 1000),
        },
      });
    } catch (error) {
      // A unique-constraint violation here means two retries raced. Both did the same
      // thing, one recorded it, and that is the correct outcome.
      this.logger.warn({
        message: 'Could not record idempotency key',
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Stable digest of a request body.
 *
 * Object keys are sorted so a client that serialises fields in a different order on a
 * retry is still recognised as sending the same request.
 */
export function hashBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableStringify(entryValue)}`);

  return `{${entries.join(',')}}`;
}
