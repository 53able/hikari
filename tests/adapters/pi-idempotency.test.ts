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
import { toAgentTools } from '../../src/pi.js';
import type { Engine } from '../../src/core/execution.js';

const writeEcho = defineCapability({
  name: 'write_echo',
  description: 'Write side effect echo',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ echoed: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['write'], auditLevel: 'basic' },
  async handler({ value }) {
    return { echoed: value };
  },
});

describe('toAgentTools idempotency auto-key', () => {
  it('passes traceId:toolCallId idempotencyKey for write capabilities', async () => {
    const registry = createRegistry().register(writeEcho);
    const storage = createInMemoryStorage();
    const auditLog = createAuditLog(storage);
    const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove });
    const executeSpy = vi.spyOn(engine, 'execute');

    const tools = toAgentTools(registry, engine, {
      getContext: () => ({
        userId: 'user-test',
        traceId: 'trace-fixed',
        intent: 'Write echo',
        permissions: [],
      }),
    });

    await tools[0]!.execute('call-write-1', { value: 'hi' });

    expect(executeSpy).toHaveBeenCalledWith(
      'write_echo',
      { value: 'hi' },
      expect.objectContaining({
        userId: 'user-test',
        traceId: 'trace-fixed',
        idempotencyKey: 'trace-fixed:call-write-1',
      }),
    );
  });

  it('does not add idempotencyKey for read capabilities', async () => {
    const readCap = defineCapability({
      name: 'read_echo',
      description: 'Read only',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ echoed: z.string() }),
      policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
      async handler({ value }) {
        return { echoed: value };
      },
    });
    const registry = createRegistry().register(readCap);
    const engine: Engine = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: { echoed: 'ok' },
        traceId: 't1',
      }),
    };

    const tools = toAgentTools(registry, engine, {
      getContext: () => ({ userId: 'u1', traceId: 't1' }),
    });

    await tools[0]!.execute('call-read-1', { value: 'x' });

    expect(engine.execute).toHaveBeenCalledWith(
      'read_echo',
      { value: 'x' },
      expect.not.objectContaining({ idempotencyKey: expect.anything() }),
    );
  });

  it('preserves explicit idempotencyKey from context', async () => {
    const registry = createRegistry().register(writeEcho);
    const engine: Engine = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: { echoed: 'ok' },
        traceId: 't1',
      }),
    };

    const tools = toAgentTools(registry, engine, {
      getContext: () => ({
        userId: 'u1',
        traceId: 't1',
        idempotencyKey: 'custom-key',
      }),
    });

    await tools[0]!.execute('call-1', { value: 'x' });

    expect(engine.execute).toHaveBeenCalledWith(
      'write_echo',
      { value: 'x' },
      expect.objectContaining({ idempotencyKey: 'custom-key' }),
    );
  });
});
