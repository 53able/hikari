/**
 * 実行: npm test -- tests/chat-server-dev-session.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  autoApprove,
  createAuditLog,
  createChatServer,
  createEngine,
  createHeaderExecutionOptionsResolver,
  createInMemoryStorage,
  type ChatBackend,
  type ChatStreamEvent,
} from '../src/index.js';
import { createBookstoreEngine } from '../examples/hono-bookstore/engine.js';

const mockBackend: ChatBackend = {
  stream() {
    return (async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'done', traceIds: [] };
    })();
  },
};

describe('createChatServer dev-session parity', () => {
  let baseUrl: string;
  let server: http.Server;

  beforeAll(async () => {
    const { registry, engine } = createBookstoreEngine();
    const chatServer = createChatServer(mockBackend, {
      serveStaticUi: false,
      devtools: { storage: createInMemoryStorage(), registry },
      enableDevSession: true,
      resolveExecutionOptions: createHeaderExecutionOptionsResolver({
        readCookies: true,
      }),
      httpApi: {
        registry,
        engine,
        basePath: '/api',
        capabilityResultHtml: { uiBasePath: '/capabilities' },
      },
    });
    server = http.createServer((req, res) => {
      void chatServer.handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET /capabilities/dev-session returns HTML', async () => {
    const res = await fetch(`${baseUrl}/capabilities/dev-session`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Dev session');
    expect(html).toContain('hikari-permissions');
  });

  it('POST dev-session sets cookies and add_book succeeds with admin', async () => {
    const devSession = await fetch(`${baseUrl}/capabilities/dev-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'userId=admin-user&permissions=admin',
      redirect: 'manual',
    });
    expect(devSession.status).toBe(303);
    const setCookies =
      typeof devSession.headers.getSetCookie === 'function'
        ? devSession.headers.getSetCookie()
        : [devSession.headers.get('set-cookie') ?? ''].filter(Boolean);
    const cookie = setCookies
      .map((line) => line.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ');

    const res = await fetch(`${baseUrl}/api/capabilities/add_book`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        title: 'Chat Server Book',
        author: 'Tester',
        price: 12.5,
        stock: 2,
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);
  });

  it('form POST with Accept text/html returns HTML result page', async () => {
    const storage = createInMemoryStorage();
    const bookstore = createBookstoreEngine();
    const engine = createEngine({
      registry: bookstore.registry,
      auditLog: createAuditLog(storage),
      approvalGate: autoApprove,
      runtime: bookstore.runtime,
    });
    const pingOnly = createChatServer(mockBackend, {
      serveStaticUi: false,
      devtools: { storage, registry: bookstore.registry },
      enableDevSession: true,
      resolveExecutionOptions: createHeaderExecutionOptionsResolver({
        readCookies: true,
      }),
      httpApi: {
        registry: bookstore.registry,
        engine,
        basePath: '/api',
        capabilityResultHtml: { uiBasePath: '/capabilities' },
      },
    });
    const ephemeral = http.createServer((req, res) => {
      void pingOnly.handler(req, res);
    });
    await new Promise<void>((resolve) => ephemeral.listen(0, '127.0.0.1', () => resolve()));
    const port = (ephemeral.address() as AddressInfo).port;
    const ephemeralBase = `http://127.0.0.1:${port}`;

    try {
      const session = await fetch(`${ephemeralBase}/capabilities/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'userId=u1&permissions=admin',
        redirect: 'manual',
      });
      const cookie = (
        typeof session.headers.getSetCookie === 'function'
          ? session.headers.getSetCookie()
          : [session.headers.get('set-cookie') ?? '']
      )
        .map((line) => line.split(';')[0]?.trim())
        .filter(Boolean)
        .join('; ');

      const res = await fetch(`${ephemeralBase}/api/capabilities/list_books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
          cookie,
        },
        body: '',
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Capability execution');
    } finally {
      await new Promise<void>((resolve, reject) => {
        ephemeral.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
