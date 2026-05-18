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
import {
  formUrlEncodedToCapabilityInput,
  fieldsFromCapabilityMeta,
} from '../src/web/cap-form-schema.js';
import { buildCapabilityMeta } from '../src/core/cap-meta.js';

const formCap = defineCapability({
  name: 'submit_form',
  description: 'Form submit test',
  inputSchema: z.object({
    title: z.string(),
    quantity: z.number().int(),
    notify: z.boolean().optional(),
  }),
  outputSchema: z.object({ ok: z.boolean(), title: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler(input) {
    return { ok: true, title: input.title };
  },
});

describe('formUrlEncodedToCapabilityInput', () => {
  it('maps form fields to capability input', () => {
    const meta = buildCapabilityMeta(formCap);
    const fields = fieldsFromCapabilityMeta(meta);
    const input = formUrlEncodedToCapabilityInput(
      fields,
      new URLSearchParams('title=Hello&quantity=2&notify=true'),
    );
    expect(input).toEqual({ title: 'Hello', quantity: 2, notify: true });
  });
});

const makeReq = (method: string, url: string, body: string, contentType: string): IncomingMessage => {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  req.headers['content-type'] = contentType;
  req.push(body);
  req.push(null);
  return req;
};

const makeRes = (): { res: ServerResponse; status: () => number; body: () => string } => {
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
    body: () => Buffer.concat(bodyChunks).toString(),
  };
};

describe('createHttpAdapter form POST', () => {
  const registry = createRegistry().register(formCap);
  const auditLog = createAuditLog(createInMemoryStorage());
  const engine = createEngine({ registry, auditLog, approvalGate: autoApprove });
  const adapter = createHttpAdapter(registry, engine, {
    resolveExecutionOptions: () => ({ userId: 'test', permissions: [] }),
  });

  it('POST application/x-www-form-urlencoded executes capability', async () => {
    const req = makeReq(
      'POST',
      '/capabilities/submit_form',
      'title=Book&quantity=3&notify=true',
      'application/x-www-form-urlencoded',
    );
    const { res, status, body } = makeRes();
    await adapter.handler(req, res);
    expect(status()).toBe(200);
    const json = JSON.parse(body()) as { output: { ok: boolean; title: string } };
    expect(json.output.ok).toBe(true);
    expect(json.output.title).toBe('Book');
  });
});
