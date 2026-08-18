import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reads `TEST_DATABASE_URL` out of the repository `.env` when it is not already exported.
 *
 * CI passes it as a real environment variable, but a developer running the suite locally
 * has it only in `.env`, and Vitest — unlike the Prisma CLI — does not read that file.
 * Without this the suite fails on a fresh checkout with an error that looks like a
 * misconfiguration rather than a missing export.
 */
function testDatabaseUrl(): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const envFile = resolve(__dirname, '../../../.env');
  if (!existsSync(envFile)) return undefined;

  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*TEST_DATABASE_URL\s*=\s*(.*)$/.exec(line);
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }

  return undefined;
}

/**
 * Prepares the integration-test database once per run.
 *
 * The suite refuses to run unless `TEST_DATABASE_URL` is set and clearly points at a
 * test database. The tests truncate every table between files, so pointing this at a
 * real database would destroy it — a guard here is cheaper than that mistake.
 */
export default function setup(): void {
  const url = testDatabaseUrl();
  if (url) process.env.TEST_DATABASE_URL = url;

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests need their own PostgreSQL database.',
    );
  }
  if (!/test/i.test(url)) {
    throw new Error(
      'Refusing to run: TEST_DATABASE_URL must contain "test" so a real database cannot be truncated.',
    );
  }

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';

  // `migrate deploy` applies committed migrations exactly as production would, so the
  // suite verifies the migrations themselves rather than a `db push` approximation.
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
