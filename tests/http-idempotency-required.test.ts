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

const writeCap = defineCapability({
  name: 'write_item',
  description: 'Writes',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['write'], auditLevel: 'basic' },
  async handler() {
    return { ok: true };
  },
});

describe('createHttpAdapter Idempotency-Key required', () => {
  it('returns 400 IDEMPOTENCY_REQUIRED when header is missing for write capability', async () => {
    const registry = createRegistry().register(writeCap);
    const engine = createEngine({
      registry,
      auditLog: createAuditLog(createInMemoryStorage()),
      approvalGate: autoApprove,
    });
    const adapter = createHttpAdapter(registry, engine, {
      resolveExecutionOptions: () => ({ userId: 'test', permissions: [] }),
    });
    const response = await adapter.fetch(
      new Request('http://localhost/capabilities/write_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'x' }),
      }),
    );
    expect(response!.status).toBe(400);
    const json = (await response!.json()) as { error: { code: string } };
    expect(json.error.code).toBe('IDEMPOTENCY_REQUIRED');
  });
});
