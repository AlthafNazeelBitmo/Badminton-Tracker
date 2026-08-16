import { execSync } from 'node:child_process';

/**
 * Prepares the integration-test database once per run.
 *
 * The suite refuses to run unless `TEST_DATABASE_URL` is set and clearly points at a
 * test database. The tests truncate every table between files, so pointing this at a
 * real database would destroy it — a guard here is cheaper than that mistake.
 */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;

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
