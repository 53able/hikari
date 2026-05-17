import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  defineCapability,
  createInMemoryStorage,
  createAuditLog,
  createHarnessTracer,
} from '../src/index.js';

describe('createHarnessTracer auditLevel', () => {
  const silentCap = defineCapability({
    name: 'silent',
    description: 'no audit',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'none' },
    handler: async () => ({ ok: true }),
  });

  const registry = createRegistry().register(silentCap);

  it('skips all harness events when default auditLevel is none', async () => {
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const harness = createHarnessTracer(auditLog, { auditLevel: 'none' });

    await harness.recordIntent({ traceId: 't1', userId: 'u1', intent: 'hi' });
    expect(storage.getAll()).toHaveLength(0);
  });

  it('skips tool_selected when capability auditLevel is none', async () => {
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const harness = createHarnessTracer(auditLog, { registry, auditLevel: 'basic' });

    await harness.recordToolSelected({
      traceId: 't2',
      userId: 'u1',
      capabilityName: 'silent',
      toolInput: { secret: true },
    });
    expect(storage.getAll()).toHaveLength(0);
  });

  it('scrubs input on basic auditLevel', async () => {
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const harness = createHarnessTracer(auditLog, { auditLevel: 'basic' });

    await harness.recordPlan({
      traceId: 't3',
      userId: 'u1',
      plan: 'do things',
    });

    const entry = storage.getAll()[0];
    expect(entry.type).toBe('plan_recorded');
    expect(entry.input).toBeUndefined();
    expect(entry.metadata?.harness).toBe(true);
    expect(entry.metadata?.plan).toBe('do things');
  });
});
