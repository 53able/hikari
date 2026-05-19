import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  createEngine,
  createAuditLog,
  createInMemoryStorage,
  autoApprove,
  createChatServer,
  createSessionManager,
  createInMemoryApprovalStore,
  createApprovalApi,
  backendFromOpenAi,
  type ChatBackend,
  type ChatStreamEvent,
  type OpenAiAdapter,
  type ChatServer,
} from '../src/index.js';

const fetchChatServer = (
  server: ChatServer,
  method: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return server.app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      method,
      headers,
    }),
  );
};

const ping = defineCapability({
  name: 'ping',
  description: 'ping',
  inputSchema: z.object({}),
  outputSchema: z.object({ pong: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  handler: async () => ({ pong: true }),
});

describe('backendFromOpenAi', () => {
  it('streams text_delta and done from adapter.chat', async () => {
    const mockAdapter: OpenAiAdapter = {
      getTools: () => [],
      chat: async () => ({ content: 'hello from openai', traceIds: ['trace-openai'] }),
    };
    const backend = backendFromOpenAi(mockAdapter);
    const events: ChatStreamEvent[] = [];
    for await (const event of backend.stream('hi', [], {
      userId: 'user-1',
      permissions: [],
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'text_delta', delta: 'hello from openai' },
      { type: 'done', traceIds: ['trace-openai'] },
    ]);
  });
});

describe('createChatServer devtools routes', () => {
  const registry = createRegistry().register(ping);
  const storage = createInMemoryStorage();
  const auditLog = createAuditLog(storage);
  const engine = createEngine({ registry, auditLog, approvalGate: autoApprove });

  const mockBackend: ChatBackend = {
    stream() {
      return (async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: 'text_delta', delta: 'pong' };
        yield { type: 'done', traceIds: ['trace-xyz'] };
      })();
    },
  };

  const server = createChatServer(mockBackend, {
    serveStaticUi: false,
    sessions: createSessionManager(),
    devtools: { storage, registry },
    httpApi: { registry, engine, basePath: '/api' },
    resolveExecutionOptions: () => ({ userId: 'tester', permissions: [] }),
  });

  it('GET /traces returns HTML', async () => {
    const response = await fetchChatServer(server, 'GET', '/traces');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<!DOCTYPE html>');
    expect(body).toContain('Hikari Trace Viewer');
  });

  it('GET /capabilities returns explorer HTML', async () => {
    const response = await fetchChatServer(server, 'GET', '/capabilities');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Capability Explorer');
    expect(body).toContain('ping');
  });

  it('GET /capabilities/:name/form returns input form HTML', async () => {
    const withForm = defineCapability({
      name: 'greet',
      description: 'Say hello',
      inputSchema: z.object({ name: z.string() }),
      outputSchema: z.object({ message: z.string() }),
      policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
      handler: async (input) => ({ message: `hi ${input.name}` }),
    });
    const formRegistry = createRegistry().register(ping).register(withForm);
    const formServer = createChatServer(mockBackend, {
      serveStaticUi: false,
      devtools: { storage, registry: formRegistry },
      httpApi: {
        registry: formRegistry,
        engine: createEngine({
          registry: formRegistry,
          auditLog,
          approvalGate: autoApprove,
        }),
        basePath: '/api',
      },
      resolveExecutionOptions: () => ({ userId: 'tester', permissions: [] }),
    });
    const response = await fetchChatServer(formServer, 'GET', '/capabilities/greet/form');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<!DOCTYPE html>');
    expect(body).toContain('name="name"');
    expect(body).toContain('action="/api/capabilities/greet"');
  });

  it('GET /api/capabilities lists registry', async () => {
    const response = await fetchChatServer(server, 'GET', '/api/capabilities');
    expect(response.status).toBe(200);
    const json = (await response.json()) as { capabilities: { name: string }[] };
    expect(json.capabilities.some((c) => c.name === 'ping')).toBe(true);
  });

  it('GET /api/openapi.json exports OpenAPI document', async () => {
    const response = await fetchChatServer(server, 'GET', '/api/openapi.json');
    expect(response.status).toBe(200);
    const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.paths['/api/capabilities/ping']).toBeDefined();
  });

  it('GET /approvals returns HTML console when approvals enabled', async () => {
    const store = createInMemoryApprovalStore();
    const approvalServer = createChatServer(mockBackend, {
      serveStaticUi: false,
      approvals: createApprovalApi(store),
      resolveExecutionOptions: () => ({ userId: 'tester', permissions: [] }),
    });
    const response = await fetchChatServer(approvalServer, 'GET', '/approvals');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Hikari Approvals');
    expect(body).toContain('<!DOCTYPE html>');
  });

  it('persists traceIds on assistant session message when stream completes', async () => {
    const sessions = createSessionManager();
    const session = sessions.createSession('tester');
    const chatServer = createChatServer(mockBackend, {
      serveStaticUi: false,
      sessions,
      resolveExecutionOptions: () => ({ userId: 'tester', permissions: [] }),
    });

    const start = await fetchChatServer(
      chatServer,
      'POST',
      '/chat',
      { body: JSON.stringify({ message: 'hi', sessionId: session.id }) },
    );
    expect(start.status).toBe(200);
    const { requestId } = (await start.json()) as { requestId: string };

    const sse = await fetchChatServer(chatServer, 'GET', `/events?requestId=${requestId}`);
    expect(sse.status).toBe(200);
    await sse.text();

    const messages = sessions.getMessages(session.id);
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('pong');
    expect(assistant?.traceIds).toEqual(['trace-xyz']);
  });
});
