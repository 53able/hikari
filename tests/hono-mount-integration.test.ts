/**
 * 実行: npm test -- tests/hono-mount-integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  createEngine,
  createAuditLog,
  createInMemoryStorage,
  autoApprove,
  createHttpAdapter,
  createHeaderExecutionOptionsResolver,
  mountHikariHttpAdapter,
  mountHikariCapabilityUi,
} from '../src/index.js';

const echo = defineCapability({
  name: 'echo',
  description: 'Echo filter',
  inputSchema: z.object({ filter: z.string().optional() }),
  outputSchema: z.object({ filter: z.string().optional() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler(input) {
    return { filter: input.filter };
  },
});

describe('mountHikariCapabilityUi + mountHikariHttpAdapter', () => {
  let baseUrl: string;
  let server: http.Server;

  beforeAll(async () => {
    const registry = createRegistry().register(echo);
    const auditLog = createAuditLog(createInMemoryStorage());
    const engine = createEngine({ registry, auditLog, approvalGate: autoApprove });
    const resolveExecutionOptions = createHeaderExecutionOptionsResolver({
      readCookies: true,
    });
    const httpAdapter = createHttpAdapter(registry, engine, {
      basePath: '/api',
      resolveExecutionOptions,
      capabilityResultHtml: { uiBasePath: '/capabilities' },
    });
    const app = mountHikariCapabilityUi(
      mountHikariHttpAdapter(new Hono(), httpAdapter, { basePath: '/api' }),
      { registry, apiBasePath: '/api', uiBasePath: '/capabilities' },
    );
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

  it('POST urlencoded from browser-like Accept returns HTML result page', async () => {
    const res = await fetch(`${baseUrl}/api/capabilities/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/json',
      },
      body: 'filter=hello',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('echo');
    expect(html).toContain('hello');
    expect(html).toContain('/capabilities/echo/form');
  });

  it('POST urlencoded without text/html Accept returns JSON', async () => {
    const res = await fetch(`${baseUrl}/api/capabilities/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'filter=world',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = (await res.json()) as { success: boolean; output: { filter?: string } };
    expect(json.success).toBe(true);
    expect(json.output.filter).toBe('world');
  });
});
