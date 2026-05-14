import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  defineCapability,
  autoApprove,
} from '../src/index.js';
import { PolicyViolationError } from '../src/core/policy.js';
import { ValidationError, CapabilityNotFoundError } from '../src/core/execution.js';
import { ApprovalDeniedError } from '../src/core/approval.js';
import type { ApprovalGate } from '../src/core/approval.js';

function makeEngine(approvalGate?: ApprovalGate) {
  const registry = createRegistry();
  const storage = createInMemoryStorage();
  const auditLog = createAuditLog(storage);
  const engine = createEngine({ registry, auditLog, approvalGate });
  return { registry, storage, engine };
}

const echoCapability = defineCapability({
  name: 'echo',
  description: 'Echo',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  policy: { requiredPermissions: [], sideEffects: ['read'], auditLevel: 'basic' },
  async handler({ value }) { return { result: value.toUpperCase() }; },
});

const protectedCapability = defineCapability({
  name: 'protected',
  description: 'Requires admin',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  policy: { requiredPermissions: ['admin'], sideEffects: ['read'], auditLevel: 'basic' },
  async handler({ value }) { return { result: value }; },
});

const financialCapability = defineCapability({
  name: 'pay',
  description: 'Make payment',
  inputSchema: z.object({ amount: z.number() }),
  outputSchema: z.object({ success: z.boolean() }),
  policy: { requiredPermissions: [], sideEffects: ['financial'], auditLevel: 'full' },
  async handler() { return { success: true }; },
});

describe('createEngine / execute', () => {
  it('executes a capability and returns output', async () => {
    const { registry, engine } = makeEngine();
    registry.register(echoCapability);
    const result = await engine.execute('echo', { value: 'hello' }, { userId: 'u1' });
    expect(result.output).toEqual({ result: 'HELLO' });
    expect(result.success).toBe(true);
    expect(result.traceId).toBeTruthy();
  });

  it('throws CapabilityNotFoundError for unknown capabilities', async () => {
    const { engine } = makeEngine();
    await expect(engine.execute('unknown', {}, { userId: 'u1' })).rejects.toThrow(
      CapabilityNotFoundError,
    );
  });

  it('throws ValidationError on invalid input', async () => {
    const { registry, engine } = makeEngine();
    registry.register(echoCapability);
    await expect(
      engine.execute('echo', { value: 123 }, { userId: 'u1' }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws PolicyViolationError when missing permissions', async () => {
    const { registry, engine } = makeEngine();
    registry.register(protectedCapability);
    await expect(
      engine.execute('protected', { value: 'x' }, { userId: 'u1', permissions: [] }),
    ).rejects.toThrow(PolicyViolationError);
  });

  it('passes when user has required permissions', async () => {
    const { registry, engine } = makeEngine();
    registry.register(protectedCapability);
    const result = await engine.execute(
      'protected',
      { value: 'hello' },
      { userId: 'u1', permissions: ['admin'] },
    );
    expect(result.output).toEqual({ result: 'hello' });
  });

  it('records audit log entries for successful execution', async () => {
    const { registry, storage, engine } = makeEngine();
    registry.register(echoCapability);
    await engine.execute('echo', { value: 'test' }, { userId: 'u1' });
    const entries = storage.getAll();
    expect(entries.some((e) => e.type === 'capability_invoked')).toBe(true);
    expect(entries.some((e) => e.type === 'execution_succeeded')).toBe(true);
  });

  it('records policy_denied in audit log', async () => {
    const { registry, storage, engine } = makeEngine();
    registry.register(protectedCapability);
    await expect(
      engine.execute('protected', { value: 'x' }, { userId: 'u1' }),
    ).rejects.toThrow();
    expect(storage.getAll().some((e) => e.type === 'policy_denied')).toBe(true);
  });

  it('calls the approval gate for financial operations', async () => {
    const gate = vi.fn(autoApprove);
    const { registry, storage, engine } = makeEngine(gate);
    registry.register(financialCapability);

    const result = await engine.execute('pay', { amount: 100 }, { userId: 'u1' });
    expect(result.output).toEqual({ success: true });
    expect(gate).toHaveBeenCalledOnce();

    const entries = storage.getAll();
    expect(entries.some((e) => e.type === 'approval_requested')).toBe(true);
    expect(entries.some((e) => e.type === 'approval_granted')).toBe(true);
  });

  it('throws ApprovalDeniedError when gate rejects', async () => {
    const gate: ApprovalGate = async (_req) => ({
      approved: false,
      rejectedBy: 'test',
      rejectedAt: new Date(),
      reason: 'denied in test',
    });
    const { registry, engine } = makeEngine(gate);
    registry.register(financialCapability);

    await expect(
      engine.execute('pay', { amount: 100 }, { userId: 'u1' }),
    ).rejects.toThrow(ApprovalDeniedError);
  });

  it('throws if financial capability is called without an approval gate', async () => {
    const { registry, engine } = makeEngine(); // no gate
    registry.register(financialCapability);
    await expect(
      engine.execute('pay', { amount: 100 }, { userId: 'u1' }),
    ).rejects.toThrow('no ApprovalGate is configured');
  });

  it('propagates traceId into audit entries', async () => {
    const { registry, storage, engine } = makeEngine();
    registry.register(echoCapability);
    const traceId = 'my-trace-123';
    await engine.execute('echo', { value: 'x' }, { userId: 'u1', traceId });
    const entries = storage.getAll();
    expect(entries.every((e) => e.traceId === traceId)).toBe(true);
  });
});
