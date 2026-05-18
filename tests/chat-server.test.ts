import { describe, it, expect } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
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
} from '../src/index.js';

function makeReq(method: string, url: string, body = ''): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  if (body) {
    req.push(body);
    req.push(null);
  } else {
    req.push(null);
  }
  return req;
}

function makeRes(): { res: ServerResponse; status: () => number; body: () => string } {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  const res = new ServerResponse(req);
  let statusCode = 200;
  const bodyChunks: Buffer[] = [];
  res.writeHead = (code: number) => {
    statusCode = code;
    return res;
  };
  res.write = (chunk: unknown) => {
    bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  };
  res.end = (chunk?: unknown) => {
    if (chunk) bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return res;
  };
  return {
    res,
    status: () => statusCode,
    body: () => Buffer.concat(bodyChunks).toString('utf8'),
  };
}

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
    const { res, status, body } = makeRes();
    await server.handler(makeReq('GET', '/traces'), res);
    expect(status()).toBe(200);
    expect(body()).toContain('<!DOCTYPE html>');
    expect(body()).toContain('Hikari Trace Viewer');
  });

  it('GET /capabilities returns explorer HTML', async () => {
    const { res, status, body } = makeRes();
    await server.handler(makeReq('GET', '/capabilities'), res);
    expect(status()).toBe(200);
    expect(body()).toContain('Capability Explorer');
    expect(body()).toContain('ping');
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
    const { res, status, body } = makeRes();
    await formServer.handler(makeReq('GET', '/capabilities/greet/form'), res);
    expect(status()).toBe(200);
    expect(body()).toContain('<!DOCTYPE html>');
    expect(body()).toContain('name="name"');
    expect(body()).toContain('action="/api/capabilities/greet"');
  });

  it('GET /api/capabilities lists registry', async () => {
    const { res, status, body } = makeRes();
    await server.handler(makeReq('GET', '/api/capabilities'), res);
    expect(status()).toBe(200);
    const json = JSON.parse(body()) as { capabilities: { name: string }[] };
    expect(json.capabilities.some((c) => c.name === 'ping')).toBe(true);
  });

  it('GET /api/openapi.json exports OpenAPI document', async () => {
    const { res, status, body } = makeRes();
    await server.handler(makeReq('GET', '/api/openapi.json'), res);
    expect(status()).toBe(200);
    const doc = JSON.parse(body()) as { openapi: string; paths: Record<string, unknown> };
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
    const { res, status, body } = makeRes();
    await approvalServer.handler(makeReq('GET', '/approvals'), res);
    expect(status()).toBe(200);
    expect(body()).toContain('Hikari Approvals');
    expect(body()).toContain('<!DOCTYPE html>');
  });

  it('persists traceIds on assistant session message when stream completes', async () => {
    const sessions = createSessionManager();
    const session = sessions.createSession('tester');
    const chatServer = createChatServer(mockBackend, {
      serveStaticUi: false,
      sessions,
      resolveExecutionOptions: () => ({ userId: 'tester', permissions: [] }),
    });

    const start = makeRes();
    await chatServer.handler(
      makeReq('POST', '/chat', JSON.stringify({ message: 'hi', sessionId: session.id })),
      start.res,
    );
    const { requestId } = JSON.parse(start.body()) as { requestId: string };

    const sse = makeRes();
    await chatServer.handler(makeReq('GET', `/events?requestId=${requestId}`), sse.res);

    const messages = sessions.getMessages(session.id);
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('pong');
    expect(assistant?.traceIds).toEqual(['trace-xyz']);
  });
});
