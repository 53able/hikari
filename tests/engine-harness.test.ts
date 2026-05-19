/**
 * 実行: npm test -- tests/engine-harness.test.ts
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  defineCapability,
  autoApprove,
  createHarnessTracer,
} from '../src/index.js';

const echoCap = defineCapability({
  name: 'echo',
  description: 'Echo',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler({ value }) {
    return { result: value.toUpperCase() };
  },
});

describe('createEngine harness integration', () => {
  it('records intent_recorded, plan_recorded, and tool_selected on execute', async () => {
    const registry = createRegistry().register(echoCap);
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const harness = createHarnessTracer(auditLog, { registry });
    const engine = createEngine({
      registry,
      auditLog,
      approvalGate: autoApprove,
      harness,
    });

    await engine.execute('echo', { value: 'hi' }, {
      userId: 'u1',
      permissions: [],
      intent: 'user wants echo',
    });

    const entries = await storage.query({});
    const types = entries.map((e) => e.type);
    expect(types).toContain('intent_recorded');
    expect(types).toContain('plan_recorded');
    expect(types).toContain('tool_selected');
    expect(types).toContain('capability_invoked');
    expect(types).toContain('execution_succeeded');
  });

  it('records only tool_selected when harnessMode is tool-only', async () => {
    const registry = createRegistry().register(echoCap);
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const harness = createHarnessTracer(auditLog, { registry });
    const engine = createEngine({
      registry,
      auditLog,
      approvalGate: autoApprove,
      harness,
      harnessMode: 'tool-only',
    });

    await engine.execute('echo', { value: 'hi' }, {
      userId: 'u1',
      permissions: [],
      intent: 'user wants echo',
    });

    const entries = await storage.query({});
    const types = entries.map((e) => e.type);
    expect(types).not.toContain('intent_recorded');
    expect(types).not.toContain('plan_recorded');
    expect(types).toContain('tool_selected');
  });

  it('records tool_selected without intent when intent is omitted', async () => {
    const registry = createRegistry().register(echoCap);
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const harness = createHarnessTracer(auditLog, { registry });
    const engine = createEngine({
      registry,
      auditLog,
      approvalGate: autoApprove,
      harness,
    });

    await engine.execute('echo', { value: 'x' }, { userId: 'u1', permissions: [] });

    const entries = await storage.query({});
    const types = entries.map((e) => e.type);
    expect(types).not.toContain('intent_recorded');
    expect(types).toContain('plan_recorded');
    expect(types).toContain('tool_selected');
  });
});
