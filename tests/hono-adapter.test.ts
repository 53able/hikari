/**
 * 実行: npm test -- tests/hono-adapter.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import {
  createRegistry,
  defineCapability,
  createEngine,
  createAuditLog,
  createInMemoryStorage,
  autoApprove,
  createHttpAdapter,
  createHeaderExecutionOptionsResolver,
} from '../src/index.js';
import { mountHikariHttpAdapter } from '../src/hono.js';

const pingCap = defineCapability({
  name: 'ping',
  description: 'Returns pong',
  inputSchema: z.object({}),
  outputSchema: z.object({ pong: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler() {
    return { pong: true };
  },
});

describe('mountHikariHttpAdapter', () => {
  let baseUrl: string;
  let server: http.Server;

  beforeAll(async () => {
    const registry = createRegistry().register(pingCap);
    const auditLog = createAuditLog(createInMemoryStorage());
    const engine = createEngine({ registry, auditLog, approvalGate: autoApprove });
    const httpAdapter = createHttpAdapter(registry, engine, {
      basePath: '/api',
      resolveExecutionOptions: createHeaderExecutionOptionsResolver(),
    });
    const app = mountHikariHttpAdapter(new Hono(), httpAdapter, { basePath: '/api' });
    const listener = getRequestListener(app.fetch);
    server = http.createServer(listener);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET /api/capabilities returns manifest', async () => {
    const res = await fetch(`${baseUrl}/api/capabilities`, {
      headers: { 'x-hikari-user-id': 'test-user' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { capabilities: { name: string }[] };
    expect(json.capabilities[0]?.name).toBe('ping');
  });

  it('GET /api/openapi.json returns OpenAPI document', async () => {
    const res = await fetch(`${baseUrl}/api/openapi.json`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { openapi: string };
    expect(json.openapi).toMatch(/^3\./);
  });
});
