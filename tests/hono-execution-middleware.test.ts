/**
 * 実行: npm test -- tests/hono-execution-middleware.test.ts
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createHikariExecutionOptionsMiddleware,
  createHeaderExecutionOptionsResolver,
  normalizeExecutionOptions,
  type HikariHonoEnv,
} from '../src/index.js';

describe('createHikariExecutionOptionsMiddleware', () => {
  it('sets userId and permissions on context', async () => {
    const resolve = createHeaderExecutionOptionsResolver();
    const app = new Hono<HikariHonoEnv>()
      .use('*', createHikariExecutionOptionsMiddleware(resolve))
      .get('/whoami', (c) =>
        c.json({
          userId: c.get('userId'),
          permissions: c.get('permissions'),
        }),
      );

    const listener = getRequestListener(app.fetch);
    const server = http.createServer(listener);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const res = await fetch(`${baseUrl}/whoami`, {
        headers: {
          'x-hikari-user-id': 'u1',
          'x-hikari-permissions': 'read,write',
        },
      });
      const json = (await res.json()) as { userId: string; permissions: string[] };
      expect(json.userId).toBe('u1');
      expect(json.permissions).toEqual(['read', 'write']);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

describe('normalizeExecutionOptions', () => {
  it('fills missing permissions with empty array', () => {
    const normalized = normalizeExecutionOptions({ userId: 'u' });
    expect(normalized.permissions).toEqual([]);
  });
});
