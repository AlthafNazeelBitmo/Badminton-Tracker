/**
 * Per-file environment for integration tests.
 *
 * Secrets here are fixed test values and are never used anywhere else; the point is a
 * deterministic environment, not a secure one.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-for-validation-0123456789';
process.env.JWT_REFRESH_SECRET =
  'test-refresh-secret-that-is-long-enough-for-validation-9876543210';
process.env.COOKIE_SECURE = 'false';
process.env.LOG_LEVEL = 'error';
process.env.ENABLE_SWAGGER = 'false';
// The suite registers hundreds of accounts, which the deliberately strict per-route
// auth limits would reject. The limiter itself is covered by rate-limit.e2e.test.ts,
// which boots its own app with limiting switched back on.
process.env.RATE_LIMIT_ENABLED = 'false';
