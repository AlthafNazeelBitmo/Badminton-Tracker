import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { CONFIG_TOKEN, type Env } from '../config/env';
import { RateLimitError } from './errors';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit.store';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

/** Applies a tighter budget to a route than the global default. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/** Marks a route as exempt (health checks, which monitoring hits constantly). */
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

/**
 * Fixed-window rate limiter.
 *
 * Where the counts live is configuration (`RATE_LIMIT_STORE`): in this process's memory
 * for a single long-running API, or in PostgreSQL where requests are spread over many
 * short-lived instances — serverless hosting — and a per-instance count would hand an
 * attacker a fresh budget with every cold start. See `rate-limit.store.ts`.
 *
 * Authenticated requests are keyed by user id so one user on a shared NAT cannot exhaust
 * everyone else's budget — which is why this guard is registered *after* `AuthGuard`,
 * where `request.user` is populated (see the note in `AppModule`). Anonymous requests,
 * meaning the `@Public()` auth routes, fall back to a hashed IP because an address is the
 * only identity they have.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG_TOKEN) private readonly config: Env,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.RATE_LIMIT_ENABLED) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? {
      limit: this.config.RATE_LIMIT_MAX,
      windowSeconds: this.config.RATE_LIMIT_WINDOW_SECONDS,
    };

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id: string } }>();
    const response = http.getResponse<Response>();

    const identity = request.user?.id ?? `ip:${hashIp(clientIp(request))}`;
    const routeKey = `${request.method}:${request.route?.path ?? request.path}`;
    const key = `${identity}|${routeKey}|${options.limit}`;

    const now = Date.now();
    const window = await this.store.hit(key, options.windowSeconds, now);

    const remaining = Math.max(0, options.limit - window.count);
    const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    setRateLimitHeaders(response, options.limit, remaining, retryAfter);

    if (window.count > options.limit) {
      response.setHeader('Retry-After', String(retryAfter));
      throw new RateLimitError(retryAfter);
    }

    return true;
  }
}

function setRateLimitHeaders(
  response: Response,
  limit: number,
  remaining: number,
  resetSeconds: number,
): void {
  response.setHeader('X-RateLimit-Limit', String(limit));
  response.setHeader('X-RateLimit-Remaining', String(remaining));
  response.setHeader('X-RateLimit-Reset', String(resetSeconds));
}

export function clientIp(request: Request): string {
  // `request.ip` already honours `trust proxy`, which main.ts configures.
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

/** IP addresses are personal data; the limiter and audit log only ever see a digest. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}
