import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => request.Agent;
}

/**
 * Boots the real application — the same modules, guards, pipes and exception filter that
 * production uses. Tests that stub the container prove that the stub works; these prove
 * that the application works.
 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    http: () => request.agent(app.getHttpServer() as App),
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.truncateAllTables();
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  agent: request.Agent;
}

let userCounter = 0;

/**
 * Registers a user and returns an agent that carries their session cookies, so tests
 * exercise the same cookie-based auth path a browser does.
 */
export async function registerUser(
  context: TestContext,
  overrides: Partial<{ email: string; password: string; name: string; timeZone: string }> = {},
): Promise<TestUser> {
  userCounter += 1;
  const email = overrides.email ?? `player${userCounter}-${Date.now()}@example.test`;
  const password = overrides.password ?? 'integration-test-password-1';

  const agent = context.http();
  const response = await agent
    .post('/api/v1/auth/register')
    .send({
      email,
      password,
      name: overrides.name ?? `Test Player ${userCounter}`,
      timeZone: overrides.timeZone ?? 'UTC',
    })
    .expect(201);

  return { id: response.body.user.id, email, password, agent };
}

/** Records a match through the public API, defaulting to a straightforward singles win. */
export async function recordMatch(
  user: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, never> & { id: string; derived: { result: string } }> {
  const response = await user.agent
    .post('/api/v1/matches')
    .send({
      discipline: 'SINGLES',
      session: { date: '2026-08-01', sessionType: 'CASUAL' },
      partners: [],
      opponents: [{ name: 'Test Opponent' }],
      games: [
        { myScore: 21, opponentScore: 15 },
        { myScore: 21, opponentScore: 17 },
      ],
      ...overrides,
    })
    .expect(201);

  return response.body;
}
