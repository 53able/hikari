/**
 * 実行: npm test -- tests/hono-capability-ui.test.ts
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
} from '../src/index.js';
import { mountHikariCapabilityUi } from '../src/hono.js';

const ping = defineCapability({
  name: 'ping',
  description: 'Returns pong',
  inputSchema: z.object({}),
  outputSchema: z.object({ pong: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler() {
    return { pong: true };
  },
});

const greet = defineCapability({
  name: 'greet',
  description: 'Say hello',
  inputSchema: z.object({ name: z.string() }),
  outputSchema: z.object({ message: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler(input) {
    return { message: `hi ${input.name}` };
  },
});

describe('mountHikariCapabilityUi', () => {
  const registry = createRegistry().register(ping).register(greet);
  const app = mountHikariCapabilityUi(new Hono(), { registry });

  const startServer = async (): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
    const listener = getRequestListener(app.fetch);
    const server = http.createServer(listener);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    };
  };

  it('GET /capabilities returns explorer HTML', async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/capabilities`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Capability Explorer');
      expect(html).toContain('ping');
      expect(html).toContain('greet');
    } finally {
      await close();
    }
  });

  it('GET /capabilities/:name/form returns form HTML', async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/capabilities/greet/form`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('name="name"');
      expect(html).toContain('action="/api/capabilities/greet"');
    } finally {
      await close();
    }
  });

  it('GET /capabilities/dev-session when enableDevSession', async () => {
    const devApp = mountHikariCapabilityUi(new Hono(), {
      registry,
      enableDevSession: true,
    });
    const listener = getRequestListener(devApp.fetch);
    const server = http.createServer(listener);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const res = await fetch(`${baseUrl}/capabilities/dev-session`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Dev session');
      expect(html).toContain('hikari-permissions');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('GET /capabilities/missing/form returns 404', async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/capabilities/missing/form`);
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });
});
