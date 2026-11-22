import { Controller, Get, Headers, Inject, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/current-user.decorator';
import { SkipRateLimit } from '../common/rate-limit.guard';
import { NotFoundError, UnauthorizedError, ValidationError } from '../common/errors';
import { CONFIG_TOKEN, type Env } from '../config/env';
import { MaintenanceService } from './maintenance.service';

type JobName = 'reminders' | 'cleanup';
const ALL_JOBS: JobName[] = ['reminders', 'cleanup'];

/**
 * Runs the maintenance jobs when a platform scheduler asks: the serverless counterpart
 * of the in-process timers and of `node dist/cli/jobs.js`.
 *
 * Vercel Cron calls this with `GET` and `Authorization: Bearer $CRON_SECRET`. Without a
 * configured secret the route answers 404, so a deployment that does not use it exposes
 * nothing. The comparison is constant-time, and both sides are hashed first so their
 * lengths always match.
 *
 * Safe to call more often than scheduled, or twice at once: every job claims its work
 * with a conditional update, exactly as when two API instances run the timers.
 */
@ApiExcludeController()
@Controller('internal')
export class CronController {
  constructor(
    private readonly maintenance: MaintenanceService,
    @Inject(CONFIG_TOKEN) private readonly config: Env,
  ) {}

  @Public()
  @SkipRateLimit()
  @Get('cron')
  async run(
    @Headers('authorization') authorization: string | undefined,
    @Query('jobs') jobsParam: string | undefined,
  ): Promise<{ ran: Array<Record<string, unknown>> }> {
    const secret = this.config.CRON_SECRET;
    if (!secret) throw new NotFoundError('Route');
    if (!matches(authorization ?? '', `Bearer ${secret}`)) throw new UnauthorizedError();

    const requested = jobsParam ? jobsParam.split(',').map((job) => job.trim()) : ALL_JOBS;
    const unknown = requested.filter((job) => !ALL_JOBS.includes(job as JobName));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown job: ${unknown.join(', ')}.`);
    }

    const ran: Array<Record<string, unknown>> = [];
    for (const job of requested as JobName[]) {
      const result =
        job === 'reminders'
          ? await this.maintenance.runReminders()
          : await this.maintenance.runCleanup();
      ran.push({ job, ...result });
    }
    return { ran };
  }
}

function matches(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
