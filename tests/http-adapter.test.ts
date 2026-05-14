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
} from '../src/index.js';
import { createHttpAdapter } from '../src/adapters/http.js';

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
  let bodyChunks: Buffer[] = [];
  res.writeHead = (code: number) => { statusCode = code; return res; };
  res.write = (chunk: unknown) => { bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true; };
  res.end = (chunk?: unknown) => {
    if (chunk) bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return res;
  };
  return {
    res,
    status: () => statusCode,
    body: () => Buffer.concat(bodyChunks).toString(),
  };
}

const pingCap = defineCapability({
  name: 'ping',
  description: 'Returns pong',
  inputSchema: z.object({}),
  outputSchema: z.object({ pong: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler() { return { pong: true }; },
});

const registry = createRegistry().register(pingCap);
const auditLog = createAuditLog(createInMemoryStorage());
const engine = createEngine({ registry, auditLog, approvalGate: autoApprove });
const adapter = createHttpAdapter(registry, engine, {
  resolveExecutionOptions: () => ({ userId: 'test', permissions: [] }),
});

describe('createHttpAdapter', () => {
  it('GET /capabilities returns manifest list', async () => {
    const req = makeReq('GET', '/capabilities');
    const { res, status, body } = makeRes();
    const handled = await adapter.handler(req, res);
    expect(handled).toBe(true);
    expect(status()).toBe(200);
    const json = JSON.parse(body()) as { capabilities: { name: string }[] };
    expect(json.capabilities[0].name).toBe('ping');
  });

  it('GET /capabilities/ping returns single meta', async () => {
    const req = makeReq('GET', '/capabilities/ping');
    const { res, status, body } = makeRes();
    await adapter.handler(req, res);
    expect(status()).toBe(200);
    const json = JSON.parse(body()) as { name: string };
    expect(json.name).toBe('ping');
  });

  it('POST /capabilities/ping executes and returns output', async () => {
    const req = makeReq('POST', '/capabilities/ping', '{}');
    req.headers['content-type'] = 'application/json';
    const { res, status, body } = makeRes();
    await adapter.handler(req, res);
    expect(status()).toBe(200);
    const json = JSON.parse(body()) as { output: { pong: boolean } };
    expect(json.output.pong).toBe(true);
  });

  it('GET /capabilities/missing returns 404', async () => {
    const req = makeReq('GET', '/capabilities/missing');
    const { res, status } = makeRes();
    await adapter.handler(req, res);
    expect(status()).toBe(404);
  });

  it('POST /capabilities/missing returns 404', async () => {
    const req = makeReq('POST', '/capabilities/missing', '{}');
    const { res, status } = makeRes();
    await adapter.handler(req, res);
    expect(status()).toBe(404);
  });

  it('returns false for unrecognised paths', async () => {
    const req = makeReq('GET', '/unknown');
    const { res } = makeRes();
    const handled = await adapter.handler(req, res);
    expect(handled).toBe(false);
  });
});
