/**
 * 実行: npm test -- tests/adapters/pi-harness.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  defineCapability,
  devAutoApprove,
} from '../../src/index.js';
import { createHikariHarness } from '../../src/pi.js';

const echo = defineCapability({
  name: 'echo',
  description: 'Echo input',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ echoed: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler({ value }) {
    return { echoed: value };
  },
});

describe('createHikariHarness', () => {
  it('records intent and plan once per turn, tool_selected per execute', async () => {
    const registry = createRegistry().register(echo);
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const harnessApi = createHikariHarness({
      registry,
      auditLog,
      approvalGate: devAutoApprove,
    });

    const recordIntent = vi.spyOn(harnessApi.harness, 'recordIntent');
    const recordPlan = vi.spyOn(harnessApi.harness, 'recordPlan');
    const recordToolSelected = vi.spyOn(harnessApi.harness, 'recordToolSelected');

    vi.spyOn(harnessApi.agent, 'prompt').mockImplementation(async () => {
      await harnessApi.engine.execute(
        'echo',
        { value: 'from-mock-pi' },
        {
          userId: 'u1',
          traceId: 'trace-harness-1',
          intent: 'mock turn',
          permissions: [],
        },
      );
    });
    vi.spyOn(harnessApi.agent, 'waitForIdle').mockResolvedValue(undefined);

    await harnessApi.runTurn({
      message: 'please echo',
      context: { userId: 'u1', traceId: 'trace-harness-1', intent: 'mock turn' },
    });

    expect(recordIntent).toHaveBeenCalledTimes(1);
    expect(recordPlan).toHaveBeenCalledTimes(1);
    expect(recordToolSelected).toHaveBeenCalledTimes(1);

    const entries = await storage.query({ traceId: 'trace-harness-1' });
    const intentCount = entries.filter((e) => e.type === 'intent_recorded').length;
    const planCount = entries.filter((e) => e.type === 'plan_recorded').length;
    expect(intentCount).toBe(1);
    expect(planCount).toBe(1);
  });
});
