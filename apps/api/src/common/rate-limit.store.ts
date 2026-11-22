import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** The state of one window after a request has been counted in it. */
export interface WindowCount {
  /** Requests counted in this window, including the one just made. */
  count: number;
  /** When the window closes, in milliseconds since the epoch. */
  resetAt: number;
}

/**
 * Where the rate limiter keeps its counts.
 *
 * `hit` counts one request against a key and returns the window's state. It must be
 * atomic: two requests counted at once must see two different counts, or a burst of
 * parallel requests could all slip in under the limit.
 */
export interface RateLimitStore {
  hit(key: string, windowSeconds: number, now: number): Promise<WindowCount>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

/**
 * Counts held in this process's memory.
 *
 * Right for a single long-running API process, and the fastest option. Wrong wherever
 * requests are spread over several instances — each instance has its own count, so the
 * effective limit is multiplied by the number of instances.
 */
@Injectable()
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, WindowCount>();
  private lastSweep = Date.now();

  hit(key: string, windowSeconds: number, now: number): Promise<WindowCount> {
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowSeconds * 1000 };
      this.buckets.set(key, fresh);
      return Promise.resolve({ ...fresh });
    }

    bucket.count += 1;
    return Promise.resolve({ ...bucket });
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

/**
 * Counts held in PostgreSQL, shared by every instance.
 *
 * For serverless hosting, where each request may land on a different short-lived
 * instance and an in-memory count would reset on every cold start. One statement per
 * request: an upsert that either starts a new window or increments the current one,
 * decided inside the database so concurrent requests cannot race.
 *
 * Expired rows are left in place — the next request for the same key simply restarts
 * the window — and removed in bulk by the hourly cleanup job.
 */
@Injectable()
export class DatabaseRateLimitStore implements RateLimitStore {
  constructor(private readonly prisma: PrismaService) {}

  async hit(key: string, windowSeconds: number, now: number): Promise<WindowCount> {
    const current = new Date(now);
    const nextReset = new Date(now + windowSeconds * 1000);

    const rows = await this.prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "rate_limit_buckets" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${nextReset})
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "rate_limit_buckets"."resetAt" <= ${current}
                         THEN 1
                         ELSE "rate_limit_buckets"."count" + 1 END,
        "resetAt" = CASE WHEN "rate_limit_buckets"."resetAt" <= ${current}
                         THEN ${nextReset}
                         ELSE "rate_limit_buckets"."resetAt" END
      RETURNING "count", "resetAt"
    `;

    const row = rows[0];
    if (!row) throw new Error('Rate-limit upsert returned no row.');
    return { count: Number(row.count), resetAt: row.resetAt.getTime() };
  }
}
