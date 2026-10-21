import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CONFIG_TOKEN, type Env } from '../config/env';
import { MaintenanceService } from './maintenance.service';

const MINUTE = 60_000;

/**
 * In-process timers for the maintenance jobs.
 *
 * Plain intervals rather than a cron library: there are two jobs, neither cares about
 * wall-clock alignment, and both are safe to run late, early, or twice. Each job also
 * guards against overlapping itself, so a slow run cannot stack up behind the next tick.
 *
 * Timers are `unref`ed so they never hold the process open on shutdown, and the first run
 * waits half a minute so it does not compete with the request traffic of a fresh deploy.
 */
@Injectable()
export class BackgroundJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BackgroundJobsService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(
    @Inject(CONFIG_TOKEN) private readonly config: Env,
    private readonly maintenance: MaintenanceService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.BACKGROUND_JOBS_ENABLED) {
      this.logger.log('Background jobs are disabled; run them with `npm run jobs`.');
      return;
    }

    // Every quarter of an hour: frequent enough that a goal reached on the way home is
    // announced before you are, rare enough to cost nothing.
    this.schedule('reminders', 15 * MINUTE, () => this.maintenance.runReminders());
    this.schedule('idempotency-cleanup', 60 * MINUTE, () =>
      this.maintenance.purgeExpiredIdempotencyKeys(),
    );
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.length = 0;
  }

  private schedule(name: string, everyMs: number, run: () => Promise<unknown>): void {
    const tick = async () => {
      if (this.running.has(name)) return;
      this.running.add(name);
      try {
        await run();
      } catch (error) {
        this.logger.error({
          message: 'Background job failed',
          job: name,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.running.delete(name);
      }
    };

    const first = setTimeout(() => void tick(), 30_000);
    const repeat = setInterval(() => void tick(), everyMs);
    first.unref();
    repeat.unref();
    this.timers.push(first, repeat);
  }
}
