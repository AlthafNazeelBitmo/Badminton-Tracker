import { z } from 'zod';

/**
 * Environment contract.
 *
 * Configuration is validated once, at boot, and the process refuses to start if
 * anything is missing or nonsensical. A server that boots with a broken config and
 * fails later, under load, in production, is strictly worse than one that never
 * starts — so the checks here are deliberately strict, and stricter still in
 * production where the cost of a mistake is highest.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const MIN_SECRET_LENGTH = 32;

const INSECURE_SECRET_MARKERS = ['replace-me', 'changeme', 'secret', 'password', 'example'];

const secret = z
  .string()
  .min(MIN_SECRET_LENGTH, `Must be at least ${MIN_SECRET_LENGTH} characters.`);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
    TEST_DATABASE_URL: z.string().optional(),

    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    ACCESS_TOKEN_TTL: z.coerce.number().int().min(60).max(86_400).default(900),
    REFRESH_TOKEN_TTL: z.coerce
      .number()
      .int()
      .min(3600)
      .max(365 * 86_400)
      .default(30 * 86_400),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: booleanish.default(false),

    /**
     * Escape hatch for the integration suite, which registers hundreds of accounts and
     * would otherwise trip the deliberately strict per-route auth limits. Production
     * configuration rejects `false` outright (see the guard below), so this cannot be
     * left switched off by accident.
     */
    RATE_LIMIT_ENABLED: booleanish.default(true),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(300),

    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
    LOG_JSON: booleanish.default(false),
    SLOW_REQUEST_MS: z.coerce.number().int().min(1).default(750),
    SENTRY_DSN: z.string().optional(),

    ENABLE_SWAGGER: booleanish.default(true),
    ALLOW_REGISTRATION: booleanish.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Production-only guards. These exist because the most common way to ship an
    // insecure service is to carry a development default into production.
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Access and refresh secrets must differ in production.',
      });
    }

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const value = env[key].toLowerCase();
      if (INSECURE_SECRET_MARKERS.some((marker) => value.includes(marker))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Looks like a placeholder secret. Generate a random value.',
        });
      }
    }

    if (!env.RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RATE_LIMIT_ENABLED'],
        message: 'Rate limiting cannot be disabled in production.',
      });
    }

    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production.',
      });
    }

    if (!env.WEB_PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEB_PUBLIC_URL'],
        message: 'WEB_PUBLIC_URL must use HTTPS in production.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env`, throwing a single readable error listing every
 * problem at once rather than one per restart.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return parsed.data;
}

export const CONFIG_TOKEN = 'APP_CONFIG';
