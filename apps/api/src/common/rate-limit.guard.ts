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

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter backed by an in-process map.
 *
 * This is honest about its scope: it protects a single instance, which is the right
 * amount of machinery for one API process and the deployment this project recommends.
 * Behind more than one instance it becomes per-instance rather than global — at that
 * point swap the store for Redis. The interface here does not change when you do,
 * which is the point of keeping it behind a guard.
 *
 * Authenticated requests are keyed by user id so one user on a shared NAT cannot exhaust
 * everyone else's budget — which is why this guard is registered *after* `AuthGuard`,
 * where `request.user` is populated (see the note in `AppModule`). Anonymous requests,
 * meaning the `@Public()` auth routes, fall back to a hashed IP because an address is the
 * only identity they have.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG_TOKEN) private readonly config: Env,
  ) {}

  canActivate(context: ExecutionContext): boolean {
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
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowSeconds * 1000 });
      setRateLimitHeaders(response, options.limit, options.limit - 1, options.windowSeconds);
      return true;
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.limit - bucket.count);
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    setRateLimitHeaders(response, options.limit, remaining, retryAfter);

    if (bucket.count > options.limit) {
      response.setHeader('Retry-After', String(retryAfter));
      throw new RateLimitError(retryAfter);
    }

    return true;
  }

  /** Drops expired buckets occasionally so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
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
