/**
 * Runs the maintenance jobs once and exits.
 *
 * For hosting where the API does not stay up between requests — a platform that scales
 * to zero, or a serverless deployment — the in-process timers never fire. Set
 * `BACKGROUND_JOBS_ENABLED=false` on the API and point the platform's scheduler at this
 * instead, every 15 minutes:
 *
 *   node dist/cli/jobs.js              # everything
 *   node dist/cli/jobs.js reminders    # just reminders
 *   node dist/cli/jobs.js cleanup      # just the idempotency purge
 *
 * Runs from the compiled output rather than through `tsx`: the jobs resolve their
 * dependencies through Nest's container, which reads constructor types from decorator
 * metadata that esbuild-based runners do not emit.
 *
 * Safe alongside running API instances and alongside another copy of itself — every job
 * claims its work with a conditional update.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MaintenanceService } from '../jobs/maintenance.service';

type JobName = 'reminders' | 'cleanup';

const ALL_JOBS: JobName[] = ['reminders', 'cleanup'];

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const unknown = requested.filter((name) => !ALL_JOBS.includes(name as JobName));
  if (unknown.length > 0) {
    console.error(`Unknown job: ${unknown.join(', ')}. Expected one of: ${ALL_JOBS.join(', ')}.`);
    process.exitCode = 2;
    return;
  }
  const jobs = requested.length > 0 ? (requested as JobName[]) : ALL_JOBS;

  // This process is the scheduler; it must not also start the in-process timers.
  process.env.BACKGROUND_JOBS_ENABLED = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const maintenance = app.get(MaintenanceService);

    for (const job of jobs) {
      const result =
        job === 'reminders'
          ? await maintenance.runReminders()
          : await maintenance.purgeExpiredIdempotencyKeys();
      console.info(JSON.stringify({ job, ...result }));
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
