import { describe, it, expect } from 'vitest';
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

const pingCap = defineCapability({
  name: 'ping',
  description: 'Returns pong',
  inputSchema: z.object({}),
  outputSchema: z.object({ pong: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler() {
    return { pong: true };
  },
});

const registry = createRegistry().register(pingCap);
const auditLog = createAuditLog(createInMemoryStorage());
const engine = createEngine({ registry, auditLog, approvalGate: autoApprove });
const adapter = createHttpAdapter(registry, engine, {
  resolveExecutionOptions: () => ({ userId: 'test', permissions: [] }),
});

describe('createHttpAdapter', () => {
  it('GET /capabilities returns manifest list', async () => {
    const response = await adapter.fetch(new Request('http://localhost/capabilities'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    const json = (await response!.json()) as { capabilities: { name: string }[] };
    expect(json.capabilities[0].name).toBe('ping');
  });

  it('GET /capabilities/ping returns single meta', async () => {
    const response = await adapter.fetch(new Request('http://localhost/capabilities/ping'));
    expect(response!.status).toBe(200);
    const json = (await response!.json()) as { name: string };
    expect(json.name).toBe('ping');
  });

  it('POST /capabilities/ping executes capability', async () => {
    const response = await adapter.fetch(
      new Request('http://localhost/capabilities/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response!.status).toBe(200);
    const json = (await response!.json()) as { output: { pong: boolean } };
    expect(json.output.pong).toBe(true);
  });

  it('GET unknown capability returns 404', async () => {
    const response = await adapter.fetch(new Request('http://localhost/capabilities/missing'));
    expect(response!.status).toBe(404);
  });

  it('GET unrelated path returns null', async () => {
    const response = await adapter.fetch(new Request('http://localhost/other'));
    expect(response).toBeNull();
  });

  it('GET /openapi.json returns OpenAPI document', async () => {
    const response = await adapter.fetch(new Request('http://localhost/openapi.json'));
    expect(response!.status).toBe(200);
    const json = (await response!.json()) as { openapi: string };
    expect(json.openapi).toMatch(/^3\./);
  });
});

describe('createHttpAdapter idempotency', () => {
  it('passes Idempotency-Key header to engine', async () => {
    const reg = createRegistry().register(pingCap);
    const eng = createEngine({ registry: reg, auditLog, approvalGate: autoApprove });
    const idemAdapter = createHttpAdapter(reg, eng, {
      resolveExecutionOptions: () => ({ userId: 'test', permissions: [] }),
    });
    const key = 'idem-key-1';
    const reqInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({}),
    } as const;
    const res1 = await idemAdapter.fetch(
      new Request('http://localhost/capabilities/ping', reqInit),
    );
    const res2 = await idemAdapter.fetch(
      new Request('http://localhost/capabilities/ping', reqInit),
    );
    expect(res1!.status).toBe(200);
    expect(res2!.status).toBe(200);
  });
});
