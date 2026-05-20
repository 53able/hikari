/**
 * 実行: npm test -- tests/adapters/pi-turn.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  defineCapability,
  devAutoApprove,
} from '../../src/index.js';
import { runPiAgentTurn } from '../../src/adapters/pi-turn.js';

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

describe('runPiAgentTurn', () => {
  it('records plan after waitForIdle via harness', async () => {
    const registry = createRegistry().register(echo);
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove });

    const recordPlan = vi.fn();
    const harness = {
      recordIntent: vi.fn(),
      recordPlan,
      recordToolSelected: vi.fn(),
    };

    await runPiAgentTurn({
      registry,
      engine,
      message: 'echo please',
      context: { userId: 'u1', traceId: 'trace-turn-1' },
      harness,
      onAgentReady: (agent) => {
        vi.spyOn(agent, 'prompt').mockImplementation(async () => {
          await engine.execute('echo', { value: 'x' }, {
            userId: 'u1',
            traceId: 'trace-turn-1',
            permissions: [],
          });
        });
        vi.spyOn(agent, 'waitForIdle').mockResolvedValue(undefined);
      },
    });

    expect(recordPlan).toHaveBeenCalledTimes(1);
  });

  it('does not call engine when tool input fails Zod preflight', async () => {
    const registry = createRegistry().register(echo);
    const auditLog = createAuditLog(createInMemoryStorage());
    const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove });
    const executeSpy = vi.spyOn(engine, 'execute');

    await runPiAgentTurn({
      registry,
      engine,
      message: 'bad input',
      context: { userId: 'u1', traceId: 'trace-preflight' },
      onAgentReady: (agent) => {
        vi.spyOn(agent, 'prompt').mockImplementation(async () => {
          const tools = agent.state.tools;
          await tools[0]!.execute('call-bad', { value: 123 });
        });
        vi.spyOn(agent, 'waitForIdle').mockResolvedValue(undefined);
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
  });
});
