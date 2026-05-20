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

const mockAgentPrompt = async (
  harnessApi: ReturnType<typeof createHikariHarness>,
  promptImpl: () => Promise<void>,
) =>
  runTurnWithMock(harnessApi, promptImpl);

const runTurnWithMock = async (
  harnessApi: ReturnType<typeof createHikariHarness>,
  promptImpl: () => Promise<void>,
  extra?: Parameters<typeof harnessApi.runTurn>[0],
) =>
  harnessApi.runTurn({
    message: 'please echo',
    context: { userId: 'u1', traceId: 'trace-harness-1', intent: 'mock turn' },
    ...extra,
    onAgentReady: (agent) => {
      vi.spyOn(agent, 'prompt').mockImplementation(promptImpl);
      vi.spyOn(agent, 'waitForIdle').mockResolvedValue(undefined);
      extra?.onAgentReady?.(agent);
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

    await mockAgentPrompt(harnessApi, async () => {
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

    expect(recordIntent).toHaveBeenCalledTimes(1);
    expect(recordPlan).toHaveBeenCalledTimes(1);
    expect(recordToolSelected).toHaveBeenCalledTimes(1);

    const entries = await storage.query({ traceId: 'trace-harness-1' });
    const intentCount = entries.filter((e) => e.type === 'intent_recorded').length;
    const planCount = entries.filter((e) => e.type === 'plan_recorded').length;
    expect(intentCount).toBe(1);
    expect(planCount).toBe(1);
  });

  it('passes prior history into the per-turn agent', async () => {
    const registry = createRegistry().register(echo);
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const harnessApi = createHikariHarness({
      registry,
      auditLog,
      approvalGate: devAutoApprove,
    });

    const prior = [
      { role: 'user' as const, content: 'hello', timestamp: new Date(0) },
      { role: 'assistant' as const, content: 'hi', timestamp: new Date(1) },
    ];

    await mockAgentPrompt(
      harnessApi,
      async () => {},
      {
        message: 'follow up',
        history: prior,
        onAgentReady: (agent) => {
          expect(agent.state.messages.length).toBe(2);
        },
      },
    );
  });
});
