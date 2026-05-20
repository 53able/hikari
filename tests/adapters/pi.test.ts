import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  createHarnessTracer,
  defineCapability,
  devAutoApprove,
} from '../../src/index.js';
import { toAgentTools, traceIdFromPiToolResult } from '../../src/pi.js';
import type { Engine, ExecutionResult } from '../../src/core/execution.js';

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

const makeHarness = () => {
  const storage = createInMemoryStorage();
  const auditLog = createAuditLog(storage);
  return { storage, harness: createHarnessTracer(auditLog) };
};

describe('toAgentTools', () => {
  it('maps registry capabilities to Pi tools and delegates execute to the engine', async () => {
    const registry = createRegistry().register(echo);
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const { harness } = makeHarness();
    const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove, harness });

    const contextRef = {
      current: {
        userId: 'user-test',
        traceId: 'trace-fixed',
        intent: 'Echo the greeting',
        permissions: ['read'],
        sessionId: 'session-1',
      },
    };

    const recordToolSelected = vi.spyOn(harness, 'recordToolSelected');
    const executeSpy = vi.spyOn(engine, 'execute');

    const tools = toAgentTools(registry, engine, {
      getContext: () => contextRef.current,
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('echo');

    const result = await tools[0]!.execute('call-1', { value: 'hi' });

    expect(executeSpy).toHaveBeenCalledWith('echo', { value: 'hi' }, {
      userId: 'user-test',
      traceId: 'trace-fixed',
      intent: 'Echo the greeting',
      permissions: ['read'],
      sessionId: 'session-1',
    });
    expect(recordToolSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-fixed',
        userId: 'user-test',
        capabilityName: 'echo',
        intent: 'Echo the greeting',
      }),
    );
    expect(result.details).toEqual({ output: { echoed: 'hi' }, traceId: 'trace-fixed' });
    expect(traceIdFromPiToolResult(result)).toBe('trace-fixed');
  });

  it('returns structured error when engine fails', async () => {
    const registry = createRegistry().register(echo);
    const engine: Engine = {
      execute: vi.fn().mockRejectedValue(new Error('policy denied')),
    };

    const tools = toAgentTools(registry, engine, {
      getContext: () => ({ userId: 'u1', traceId: 't1' }),
    });

    const result = await tools[0]!.execute('call-2', { value: 'x' });
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({
      traceId: 't1',
      error: { code: 'execution_error', message: 'policy denied', retryable: false },
    });
  });

  it('uses engine traceId from execute result in tool details', async () => {
    const registry = createRegistry().register(echo);
    const engine: Engine = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: { echoed: 'ok' },
        traceId: 'engine-trace-99',
      } satisfies ExecutionResult),
    };

    const tools = toAgentTools(registry, engine, {
      getContext: () => ({ userId: 'u1', traceId: 'stale-trace' }),
    });

    const result = await tools[0]!.execute('call-3', { value: 'ok' });
    expect(result.details).toMatchObject({ traceId: 'engine-trace-99' });
  });
});
