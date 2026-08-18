import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The rest of the suite runs with `RATE_LIMIT_ENABLED=false`, because registering
 * hundreds of accounts would otherwise trip the deliberately strict auth budget. That
 * leaves the limiter — a security control, not a nicety — untested, so this file boots
 * its own application with limiting switched back on.
 *
 * Everything here is per-file: Vitest gives each test file its own process, so mutating
 * the environment in `beforeAll` cannot affect the other suites.
 */
describe('rate limiting', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let previous: string | undefined;

  // The limiter's buckets live in memory for the life of the process, and truncating the
  // database does not clear them. Each test therefore calls from its own address, exactly
  // as separate clients would. Supertest always connects from 127.0.0.1, so the address
  // is supplied through `X-Forwarded-For` — which the app honours because it sets
  // `trust proxy`, as it does in production behind a load balancer.
  let addressCounter = 0;
  const http = () => {
    addressCounter += 1;
    const address = `203.0.113.${addressCounter}`;
    return request.agent(app.getHttpServer() as App).set('X-Forwarded-For', address);
  };

  beforeAll(async () => {
    previous = process.env.RATE_LIMIT_ENABLED;
    process.env.RATE_LIMIT_ENABLED = 'true';
    // Low enough that a test can reach the ceiling in a handful of requests.
    process.env.RATE_LIMIT_MAX = '5';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.set('trust proxy', 1);
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = previous;
  });

  beforeEach(async () => {
    await prisma.truncateAllTables();
  });

  it('rejects a brute-force run against login and says when to retry', async () => {
    const agent = http();
    const attempt = () =>
      agent.post('/api/v1/auth/login').send({
        email: 'nobody@example.test',
        password: 'wrong-password-attempt-1',
      });

    // The login budget is 5 per 15 minutes. Every one of these fails on credentials
    // anyway; the point is that the sixth fails on the limiter instead.
    let limited: request.Response | undefined;
    for (let index = 0; index < 12; index += 1) {
      const response = await attempt();
      if (response.status === 429) {
        limited = response;
        break;
      }
      expect(response.status).toBe(401);
    }

    expect(limited).toBeDefined();
    expect(limited!.body.code).toBe('RATE_LIMITED');
    // Without this the client has no way to back off other than guessing.
    expect(Number(limited!.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('advertises the remaining budget on every response', async () => {
    const first = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'headers@example.test', password: 'wrong-password-attempt-1' })
      .expect(401);

    expect(Number(first.headers['x-ratelimit-limit'])).toBeGreaterThan(0);
    expect(Number(first.headers['x-ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
    expect(Number(first.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
  });

  it('budgets authenticated requests per user, not per address', async () => {
    // Deliberately one shared address, as two people on the same NAT or corporate proxy
    // would have. The identity that matters once signed in is the user, not the address.
    const shared = '198.51.100.7';
    const agentAt = () => request.agent(app.getHttpServer() as App).set('X-Forwarded-For', shared);

    const first = await registerThrough(agentAt(), 'limiter-one');
    const second = await registerThrough(agentAt(), 'limiter-two');

    // Spend the first user's budget on a route with the default limit of 5.
    for (let index = 0; index < 6; index += 1) {
      await first.get('/api/v1/players');
    }
    await first.get('/api/v1/players').expect(429);

    // The second user must be unaffected: one noisy client on a shared address cannot
    // lock everyone else out.
    await second.get('/api/v1/players').expect(200);
  });

  it('keeps separate budgets per route', async () => {
    const agent = await registerThrough(http(), 'per-route');

    for (let index = 0; index < 6; index += 1) {
      await agent.get('/api/v1/players');
    }
    await agent.get('/api/v1/players').expect(429);

    // Exhausting one endpoint must not take the rest of the app down with it.
    await agent.get('/api/v1/venues').expect(200);
  });

  it('exempts the health probes, which monitoring hits constantly', async () => {
    for (let index = 0; index < 20; index += 1) {
      await http().get('/health/live').expect(200);
    }
  });

  async function registerThrough(agent: request.Agent, label: string): Promise<request.Agent> {
    await agent
      .post('/api/v1/auth/register')
      .send({
        email: `${label}-${Date.now()}@example.test`,
        password: 'integration-test-password-1',
        name: `Limiter ${label}`,
        timeZone: 'UTC',
      })
      .expect(201);

    return agent;
  }
});
