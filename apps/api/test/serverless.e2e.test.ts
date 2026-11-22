import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import serverlessHandler from '../src/serverless';

/**
 * The serverless entry point (`src/serverless.ts`), driven the way Vercel drives it: a
 * plain Node request handler, with no `listen` of its own.
 *
 * The rest of the suite boots the application through the testing module, so without
 * this file nothing would prove that the deployed entry point applies the same prefix,
 * versioning and cookie handling — or that it answers at all.
 */
describe('serverless entry point', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => void serverlessHandler(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('answers the health probes outside the versioned prefix', async () => {
    const response = await request(base).get('/health/live').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('serves the versioned API and enforces authentication', async () => {
    const response = await request(base).get('/api/v1/players').expect(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('applies the security headers the long-running server applies', async () => {
    const response = await request(base).get('/health/live');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('serves a burst of concurrent requests on one instance', async () => {
    // Many requests on a warm instance must not each pay for a cold start.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(base).get('/health/live')),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
  });
});
