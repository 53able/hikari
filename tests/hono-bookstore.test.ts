/**
 * 実行: npm test -- tests/hono-bookstore.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { createApp } from '../examples/hono-bookstore/app.js';
import { createBookstoreEngine } from '../examples/hono-bookstore/engine.js';
describe('examples/hono-bookstore', () => {
  let baseUrl: string;
  let server: http.Server;

  beforeAll(async () => {
    const { engine, registry, auditStorage, approvalApi } = createBookstoreEngine();
    const app = createApp({ engine, registry, auditStorage, approvalApi });
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

  const request = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${baseUrl}${path}`, init);

  it('GET /health returns service metadata', async () => {
    const res = await request('/health');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      service: string;
      capabilities: number;
      chat: { enabled: boolean; provider?: string };
    };
    expect(json.status).toBe('ok');
    expect(json.service).toBe('hono-bookstore');
    expect(json.capabilities).toBeGreaterThan(0);
    expect(json.chat.enabled).toBe(false);
  });

  it('POST /api/chat returns 503 when no LLM API key is set', async () => {
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    const savedOpenai = process.env.OPENAI_API_KEY;
    const savedProvider = process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;

    const { engine, registry, auditStorage, approvalApi } = createBookstoreEngine();
    const chatApp = createApp({ engine, registry, auditStorage, approvalApi });
    const chatListener = getRequestListener(chatApp.fetch);
    const chatServer = http.createServer(chatListener);
    await new Promise<void>((resolve) => chatServer.listen(0, '127.0.0.1', () => resolve()));
    const chatAddress = chatServer.address() as AddressInfo;
    const chatBase = `http://127.0.0.1:${chatAddress.port}`;

    try {
      const res = await fetch(`${chatBase}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hikari-user-id': 'test-user',
        },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe('MISSING_API_KEY');
      expect(json.error.message).toContain('OPENAI_API_KEY');
    } finally {
      await new Promise<void>((resolve, reject) => {
        chatServer.close((err) => (err ? reject(err) : resolve()));
      });
      if (savedAnthropic === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = savedAnthropic;
      }
      if (savedOpenai === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = savedOpenai;
      }
      if (savedProvider === undefined) {
        delete process.env.LLM_PROVIDER;
      } else {
        process.env.LLM_PROVIDER = savedProvider;
      }
    }
  });

  it('GET /capabilities returns capability explorer HTML', async () => {
    const res = await request('/capabilities');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Capability Explorer');
    expect(html).toContain('list_books');
    expect(html).toContain('purchase_book');
  });

  it('GET /api/capabilities lists bookstore capabilities', async () => {
    const res = await request('/api/capabilities', {
      headers: { 'x-hikari-user-id': 'test-user', 'x-hikari-permissions': '' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { capabilities: { name: string }[] };
    const names = json.capabilities.map((cap) => cap.name);
    expect(names).toContain('list_books');
    expect(names).toContain('purchase_book');
  });

  it('GET /traces returns audit trace HTML after capability runs', async () => {
    await request('/api/capabilities/list_books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hikari-user-id': 'test-user',
      },
      body: JSON.stringify({}),
    });
    const res = await request('/traces');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('list_books');
  });

  it('GET /approvals returns approval queue HTML', async () => {
    const res = await request('/approvals');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Approval');
  });

  it('POST add_book succeeds when admin permission cookie is set', async () => {
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
        title: 'Test Book',
        author: 'Author',
        price: 9.99,
        stock: 1,
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);
  });

  it('POST /api/capabilities/list_books executes via Hikari engine', async () => {
    const res = await request('/api/capabilities/list_books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hikari-user-id': 'test-user',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      output: { title: string }[];
    };
    expect(json.success).toBe(true);
    expect(json.output.length).toBeGreaterThan(0);
    expect(json.output[0]?.title).toBeTruthy();
  });
});
