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
  createSlidingWindowRateLimiter,
  createRateLimitGuard,
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

function makeRes(): {
  res: ServerResponse;
  status: () => number;
  body: () => string;
  headers: () => Record<string, string | string[] | undefined>;
} {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  const res = new ServerResponse(req);
  let statusCode = 200;
  let bodyChunks: Buffer[] = [];
  const headers: Record<string, string | string[] | undefined> = {};
  res.writeHead = (code: number, hdrs?: Record<string, string | string[] | undefined>) => {
    statusCode = code;
    if (hdrs) Object.assign(headers, hdrs);
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
    headers: () => headers,
  };
}

describe('rate limiting', () => {
  it('blocks after max requests in sliding window', () => {
    const limiter = createSlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    const third = limiter.check('k');
    expect(third.allowed).toBe(false);
    if (!third.allowed) {
      expect(third.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('HTTP adapter returns 429 with Retry-After when limited', async () => {
    const ping = defineCapability({
      name: 'ping',
      description: 'ping',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
      async handler() {
        return { ok: true };
      },
    });
    const registry = createRegistry().register(ping);
    const engine = createEngine({
      registry,
      auditLog: createAuditLog(createInMemoryStorage()),
      approvalGate: autoApprove,
    });
    const guard = createRateLimitGuard({
      rules: [
        {
          name: 'ip',
          key: (ctx) => ctx.ip,
          limiter: createSlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 }),
        },
      ],
    });
    const adapter = createHttpAdapter(registry, engine, {
      resolveExecutionOptions: () => ({ userId: 'u1', permissions: [] }),
      rateLimitGuard: guard,
    });

    const postInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.1',
      },
      body: '{}',
    } as const;
    const res1 = await adapter.fetch(
      new Request('http://localhost/capabilities/ping', postInit),
    );
    expect(res1!.status).toBe(200);

    const res2 = await adapter.fetch(
      new Request('http://localhost/capabilities/ping', postInit),
    );
    expect(res2!.status).toBe(429);
    expect(res2!.headers.get('Retry-After')).toBeTruthy();
    const json = (await res2!.json()) as { error: { code: string } };
    expect(json.error.code).toBe('RATE_LIMITED');
  });
});
